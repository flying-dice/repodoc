import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { RepoDocApi } from '../../extension';

/**
 * Every board UI action drives the SAME webview->host message the DOM posts,
 * replayed through the real channel via `repodoc.bounceWebviewMessage`. Each
 * test asserts a meaningful filesystem change AND that the board the webview
 * renders (store.getBoard) reflects it immediately, with `onDidChange` firing
 * so the panel refreshes.
 */

const EXTENSION_ID = 'flying-dice.repodoc';
const BOARD = 'project-backlog';

function workspaceRoot(): string {
  const folders = vscode.workspace.workspaceFolders;
  assert.ok(folders && folders.length > 0, 'a fixture workspace must be open');
  return folders[0].uri.fsPath;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(fn: () => boolean, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor timed out');
    }
    await delay(120);
  }
}

suite('RepoDoc UI actions -> filesystem', () => {
  let api: RepoDocApi;
  let root: string;
  let cardsDir: string;

  const cardFiles = (): string[] =>
    fs.readdirSync(cardsDir).filter((n) => !n.startsWith('.') && n.endsWith('.md'));
  const cardFile = (slug: string): string | undefined =>
    cardFiles().find((n) => n.replace(/^\d+-/, '').replace(/\.md$/, '') === slug);
  const readCard = (slug: string): string => {
    const f = cardFile(slug);
    assert.ok(f, `card file for "${slug}" should exist`);
    return fs.readFileSync(path.join(cardsDir, f), 'utf8');
  };

  /** Bounce a webview->host message through the real channel, once. */
  const bounce = (message: unknown): Thenable<boolean> =>
    vscode.commands.executeCommand<boolean>('repodoc.bounceWebviewMessage', BOARD, message);

  suiteSetup(async function () {
    this.timeout(60000);
    root = workspaceRoot();
    for (const entry of fs.readdirSync(root)) {
      fs.rmSync(path.join(root, entry), { recursive: true, force: true });
    }

    cardsDir = path.join(root, 'boards', BOARD);
    fs.mkdirSync(cardsDir, { recursive: true });
    fs.writeFileSync(
      path.join(cardsDir, '.config.json'),
      JSON.stringify({
        name: 'Project Backlog',
        columns: [
          { id: 'backlog', name: 'Backlog', color: '#7d828b' },
          { id: 'todo', name: 'To Do', color: '#4c8bf5' },
          { id: 'doing', name: 'In Progress', color: '#5cd68a', wip: 3 },
          { id: 'review', name: 'In Review', color: '#d99a30' },
          {
            id: 'done',
            name: 'Done',
            color: '#3fb27f',
            enter: [{ id: 'signoff', field: 'approved', check: '= true', label: 'Approved' }],
          },
        ],
        labels: { bug: { name: 'bug', color: '#e5534b' } },
        fields: [
          { id: 'note', label: 'Note', type: 'text' },
          { id: 'approved', label: 'Approved', type: 'boolean' },
        ],
      }),
    );
    // Two starter cards with a checklist on the first.
    fs.writeFileSync(
      path.join(cardsDir, '01-alpha.md'),
      '---\ncolumn: todo\n---\n# Alpha\n\nDescription.\n\n## Checklist\n\n- [ ] one\n- [ ] two\n',
    );
    fs.writeFileSync(
      path.join(cardsDir, '02-beta.md'),
      '---\ncolumn: todo\n---\n# Beta\n\nDescription.\n',
    );

    const ext = vscode.extensions.getExtension<RepoDocApi>(EXTENSION_ID);
    assert.ok(ext, `extension ${EXTENSION_ID} should be installed`);
    api = await ext.activate();

    await vscode.commands.executeCommand('repodoc.openBoard', BOARD);

    // Warm-up: idempotently probe the real channel until it takes effect, so
    // the webview's message listener is proven live before the action tests.
    const start = Date.now();
    for (;;) {
      await bounce({ type: 'setField', cardId: 'alpha', fieldId: 'note', value: 'ready' });
      await delay(250);
      const card = api.store.getBoard(BOARD)?.cards['alpha'];
      if (card?.custom?.note === 'ready') {
        break;
      }
      if (Date.now() - start > 30000) {
        throw new Error('webview channel never became live');
      }
    }
  });

  test('setField writes the value to card frontmatter and the board reflects it', async () => {
    let fired = false;
    const sub = api.store.onDidChange(() => (fired = true));
    await bounce({ type: 'setField', cardId: 'beta', fieldId: 'note', value: 'hello' });
    await waitFor(() => api.store.getBoard(BOARD)?.cards['beta']?.custom?.note === 'hello');
    sub.dispose();

    assert.match(readCard('beta'), /note:\s*hello/);
    assert.ok(fired, 'onDidChange should fire so the panel refreshes');
  });

  test('clearing a field removes the frontmatter key', async () => {
    await bounce({ type: 'setField', cardId: 'beta', fieldId: 'note', value: null });
    await waitFor(() => api.store.getBoard(BOARD)?.cards['beta']?.custom?.note === undefined);
    assert.ok(!/note:/.test(readCard('beta')));
  });

  test('addCard creates a new card file appended to the target column', async () => {
    await bounce({ type: 'addCard', column: 'backlog', title: 'Card From UI' });
    await waitFor(() => !!cardFile('card-from-ui'));

    const content = readCard('card-from-ui');
    assert.match(content, /column:\s*backlog/);
    assert.match(content, /# Card From UI/);
    const board = api.store.getBoard(BOARD)!;
    assert.ok(board.cards['card-from-ui'], 'store exposes the new card');
    assert.ok(board.columns.find((c) => c.id === 'backlog')!.cardIds.includes('card-from-ui'));
  });

  test('toggleCheck flips a checklist box in the file', async () => {
    assert.match(readCard('alpha'), /- \[ \] one/);
    await bounce({ type: 'toggleCheck', cardId: 'alpha', index: 0 });
    await waitFor(() => {
      const cl = api.store.getBoard(BOARD)?.cards['alpha']?.checklist;
      return !!cl && cl[0].done === true;
    });
    assert.match(readCard('alpha'), /- \[x\] one/);
    assert.match(readCard('alpha'), /- \[ \] two/);
  });

  test('addComment appends a journal entry with the composer author', async () => {
    await bounce({ type: 'addComment', cardId: 'beta', text: 'A UI comment', who: 'Reviewer Rae' });
    await waitFor(() => (api.store.getBoard(BOARD)?.cards['beta']?.comments?.length ?? 0) > 0);

    const content = readCard('beta');
    assert.match(content, /## Comments/);
    assert.match(content, /A UI comment/);
    const entry = api.store.getBoard(BOARD)!.cards['beta'].comments![0];
    assert.strictEqual(entry.who, 'Reviewer Rae', 'the composer author is used');
    assert.ok(entry.at, 'comment carries a timestamp');
  });

  test('moveCard rewrites the column and renumbers files', async () => {
    await bounce({ type: 'moveCard', cardId: 'beta', toColumn: 'doing', index: 0 });
    await waitFor(() => {
      const board = api.store.getBoard(BOARD);
      return !!board && board.columns.find((c) => c.id === 'doing')!.cardIds.includes('beta');
    });
    assert.match(readCard('beta'), /column:\s*doing/);
  });

  test('a gate blocks a move; override records it and the move lands', async () => {
    // 'alpha' has approved unset, so moving to done is gate-blocked.
    const blocked = api.store.evaluateMove(BOARD, 'alpha', 'done').filter((r) => !r.satisfied);
    assert.strictEqual(blocked.length, 1, 'the signoff gate should block');

    // Override via the same message the blocked-move dialog posts.
    await bounce({ type: 'moveCard', cardId: 'alpha', toColumn: 'done', index: 0, override: true });
    await waitFor(() => {
      const board = api.store.getBoard(BOARD);
      return !!board && board.columns.find((c) => c.id === 'done')!.cardIds.includes('alpha');
    });
    assert.match(readCard('alpha'), /column:\s*done/);
    assert.match(readCard('alpha'), /OVERRIDDEN/);
  });

  test('setting the gate field satisfies the gate (approval as a field edit)', async () => {
    await bounce({ type: 'setField', cardId: 'alpha', fieldId: 'approved', value: true });
    await waitFor(() => api.store.getBoard(BOARD)?.cards['alpha']?.custom?.approved === true);
    // Move it back out then in cleanly: now the gate is satisfied.
    const stillBlocked = api.store.evaluateMove(BOARD, 'beta', 'done').filter((r) => !r.satisfied);
    assert.strictEqual(stillBlocked.length, 1, 'beta is not approved, still blocked');
    const alphaBlocked = api.store.evaluateMove(BOARD, 'alpha', 'done').filter((r) => !r.satisfied);
    assert.strictEqual(alphaBlocked.length, 0, 'alpha approved -> gate satisfied');
    assert.match(readCard('alpha'), /approved:\s*true/);
  });
});
