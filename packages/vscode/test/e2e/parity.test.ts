import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { RepoDocApi } from '../../src/extension';
import { type BoardsNode, BoardsTreeProvider } from '../../src/trees';

/**
 * Parity between what the webview can do and what the CLI can do. Every board
 * action here is posted through the REAL webview->host channel (the extension
 * bounces it back through the webview, as `uiActions.test.ts` does) and is
 * asserted against the bytes on disk, so a UI path that writes a weaker record
 * than `repodoc card …` shows up as a failure.
 *
 * Also covers the tree-side commands: `repodoc.copyRef`,
 * `repodoc.openCardFile` and `repodoc.setDecisionStatus`.
 */

const EXTENSION_ID = 'flying-dice.repodoc';
const BOARD = 'parity-board';

function workspaceRoot(): string {
  const folders = vscode.workspace.workspaceFolders;
  assert.ok(folders && folders.length > 0, 'a fixture workspace must be open');
  return folders[0]!.uri.fsPath; // non-empty, proven by the assertion above
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor<T>(fn: () => T | undefined | false, timeoutMs = 8000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = fn();
    if (value) {
      return value as T;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor timed out');
    }
    await delay(120);
  }
}

/** True when this environment has a working clipboard (headless hosts may not). */
async function clipboardWorks(): Promise<boolean> {
  const probe = `repodoc-clipboard-probe-${Date.now()}`;
  try {
    await vscode.env.clipboard.writeText(probe);
    return (await vscode.env.clipboard.readText()) === probe;
  } catch {
    return false;
  }
}

suite('RepoDoc webview/CLI parity e2e', () => {
  let api: RepoDocApi;
  let root: string;
  let cardsDir: string;
  let tree: BoardsTreeProvider;
  let fenceCount = 0;

  const cardFiles = (): string[] =>
    fs.readdirSync(cardsDir).filter((n) => !n.startsWith('.') && n.endsWith('.md'));

  const cardFile = (slug: string): string | undefined =>
    cardFiles().find((n) => n.replace(/^\d+-/, '').replace(/\.md$/, '') === slug);

  const readCard = (slug: string): string => {
    const file = cardFile(slug);
    assert.ok(file, `card file for "${slug}" should exist, saw ${cardFiles().join(', ')}`);
    return fs.readFileSync(path.join(cardsDir, file), 'utf8');
  };

  /** Bounce a webview->host message through the real channel, once. */
  const bounce = (message: unknown): Thenable<boolean> =>
    vscode.commands.executeCommand<boolean>('repodoc.bounceWebviewMessage', BOARD, message);

  /**
   * Post a message with a known effect and wait for it. The channel preserves
   * order, so once the fence has landed every message posted before it has been
   * handled — that is how "nothing happened" is asserted without sleeping.
   */
  const fence = async (): Promise<void> => {
    const marker = `fence-${++fenceCount}`;
    await bounce({ type: 'setField', cardId: 'fence', fieldId: 'note', value: marker });
    await waitFor(() => api.store.getBoard(BOARD)?.cards['fence']?.custom?.['note'] === marker);
  };

  /** The Boards-tree node for a card, exactly as the tree hands it to a command. */
  const cardNode = (cardId: string): BoardsNode => {
    const board = tree.getChildren().find((n) => n.kind === 'board' && n.ref.id === BOARD);
    assert.ok(board, `the Boards tree should list ${BOARD}`);
    for (const column of tree.getChildren(board)) {
      const found = tree.getChildren(column).find((n) => n.kind === 'card' && n.cardId === cardId);
      if (found) {
        return found;
      }
    }
    throw new Error(`no tree node for card ${cardId}`);
  };

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
        name: 'Parity Board',
        columns: [
          { id: 'backlog', name: 'Backlog', color: '#7d828b' },
          {
            id: 'review',
            name: 'In Review',
            color: '#d99a30',
            enter: [{ id: 'tests', label: 'Tests pass', script: 'bun run test' }],
          },
          {
            id: 'done',
            name: 'Done',
            color: '#3fb27f',
            enter: [{ id: 'signoff', label: 'Approved', field: 'approved', check: '= true' }],
          },
        ],
        labels: { bug: { name: 'bug', color: '#e5534b' } },
        fields: [
          { id: 'note', label: 'Note', type: 'text' },
          { id: 'approved', label: 'Approved', type: 'boolean' },
        ],
      }),
    );
    fs.writeFileSync(
      path.join(cardsDir, '01-alpha.md'),
      '---\ncolumn: backlog\n---\n# Alpha\n\nOriginal description.\n\n## Gates\n\n- [x] seeded — kept\n',
    );
    fs.writeFileSync(path.join(cardsDir, '02-beta.md'), '---\ncolumn: backlog\n---\n# Beta\n');
    // A card touched only by `fence()`, so the other tests can assert that a
    // refused action left their card byte-identical.
    fs.writeFileSync(path.join(cardsDir, '03-fence.md'), '---\ncolumn: backlog\n---\n# Fence\n');

    const ext = vscode.extensions.getExtension<RepoDocApi>(EXTENSION_ID);
    assert.ok(ext, `extension ${EXTENSION_ID} should be installed`);
    api = await ext.activate();
    tree = new BoardsTreeProvider(api.store);

    await vscode.commands.executeCommand('repodoc.openBoard', BOARD);

    // Warm-up: idempotently probe the real channel until it takes effect, so
    // the webview's message listener is proven live before the action tests.
    const start = Date.now();
    for (;;) {
      await bounce({ type: 'setField', cardId: 'fence', fieldId: 'note', value: 'ready' });
      await delay(250);
      if (api.store.getBoard(BOARD)?.cards['fence']?.custom?.['note'] === 'ready') {
        break;
      }
      if (Date.now() - start > 30000) {
        throw new Error('webview channel never became live');
      }
    }
  });

  test('updateMeta writes the title, priority and labels the CLI would write', async () => {
    await bounce({
      type: 'updateMeta',
      cardId: 'alpha',
      patch: { title: 'Alpha Renamed', priority: 'high', labels: ['bug', 'infra'] },
    });
    await waitFor(() => api.store.getBoard(BOARD)?.cards['alpha']?.priority === 'high');

    const content = readCard('alpha');
    assert.match(content, /priority:\s*high/);
    assert.match(content, /labels:\s*\[bug, infra\]/);
    assert.ok(content.includes('# Alpha Renamed\n'), 'the title is the body heading');
    assert.ok(content.includes('Original description.'), 'the description is untouched');
    assert.ok(content.includes('- [x] seeded — kept'), 'the gates section is untouched');
  });

  test('updateMeta with live true then null adds and then removes the key', async () => {
    await bounce({ type: 'updateMeta', cardId: 'alpha', patch: { live: true } });
    await waitFor(() => api.store.getBoard(BOARD)?.cards['alpha']?.live === true);
    assert.match(readCard('alpha'), /live:\s*true/);

    await bounce({ type: 'updateMeta', cardId: 'alpha', patch: { live: null } });
    await waitFor(() => api.store.getBoard(BOARD)?.cards['alpha']?.live === undefined);
    assert.ok(!/live:/.test(readCard('alpha')), 'null clears the key, as `--live false` does');
  });

  test('updateMeta with nothing usable in the patch leaves the card byte-identical', async () => {
    const before = readCard('alpha');
    await bounce({
      type: 'updateMeta',
      cardId: 'alpha',
      patch: { priority: 'urgent', labels: [1, 2], progress: 'lots', nonsense: true },
    });
    await bounce({ type: 'updateMeta', cardId: 'alpha', patch: {} });
    await fence();
    assert.strictEqual(readCard('alpha'), before, 'an unusable patch must not even stamp the card');
  });

  test('updateMeta cannot forge frontmatter keys through a title or status', async () => {
    await bounce({
      type: 'updateMeta',
      cardId: 'alpha',
      patch: { status: 'busy\ncolumn: done', title: 'Alpha\nForged' },
    });
    await waitFor(() => (api.store.getBoard(BOARD)?.cards['alpha']?.status ?? '') !== '');
    const content = readCard('alpha');
    assert.strictEqual(
      content.split('\n').filter((l) => l.startsWith('column:')).length,
      1,
      `only one column key may exist, file is:\n${content}`,
    );
    assert.match(content, /column:\s*backlog/);
    assert.strictEqual(
      content.split('\n').filter((l) => l.startsWith('# ')).length,
      1,
      'the title stays a single heading line',
    );
  });

  test('recordGatePass records evidence that satisfies the script gate', async () => {
    const blockedBefore = api.store
      .evaluateMove(BOARD, 'beta', 'review')
      .filter((r) => !r.satisfied);
    assert.strictEqual(blockedBefore.length, 1, 'the tests gate blocks a move into review');

    await bounce({
      type: 'recordGatePass',
      cardId: 'beta',
      gateId: 'tests',
      result: '124 pass, 0 fail',
    });
    await waitFor(() => (api.store.getBoard(BOARD)?.cards['beta']?.gates?.length ?? 0) > 0);

    const content = readCard('beta');
    assert.match(content, /## Gates/);
    assert.match(content, /- \[x\] tests — 124 pass, 0 fail \(.+, .+\)/);
    assert.deepStrictEqual(
      api.store.evaluateMove(BOARD, 'beta', 'review').filter((r) => !r.satisfied),
      [],
      'the recorded run satisfies the gate, exactly as `repodoc card gate-pass` does',
    );
  });

  test('recordGatePass with a blank result is ignored', async () => {
    const before = readCard('beta');
    await bounce({ type: 'recordGatePass', cardId: 'beta', gateId: 'tests', result: '   ' });
    await fence();
    assert.strictEqual(readCard('beta'), before);
  });

  test('moveCard past a failing gate is refused when no reason is given', async () => {
    const before = readCard('beta');
    await bounce({ type: 'moveCard', cardId: 'beta', toColumn: 'done', index: 0, override: true });
    await bounce({
      type: 'moveCard',
      cardId: 'beta',
      toColumn: 'done',
      index: 0,
      override: true,
      reason: '   ',
    });
    await fence();
    assert.strictEqual(
      readCard('beta'),
      before,
      'a reasonless override must neither move the card nor journal anything',
    );
    assert.ok(!readCard('beta').includes('OVERRIDDEN'));
  });

  test('moveCard with an override and a reason journals the bypass and moves the card', async () => {
    await bounce({
      type: 'moveCard',
      cardId: 'beta',
      toColumn: 'done',
      index: 0,
      override: true,
      reason: 'shipping the hotfix; review follows',
    });
    await waitFor(() => {
      const board = api.store.getBoard(BOARD);
      return !!board && !!board.columns.find((c) => c.id === 'done')?.cardIds.includes('beta');
    });
    const content = readCard('beta');
    assert.match(content, /column:\s*done/);
    assert.match(
      content,
      /- \[x\] signoff — OVERRIDDEN \(.+\): shipping the hotfix; review follows/,
    );
    assert.match(content, /- \[x\] tests — /, 'the earlier gate evidence is still there');
  });

  test('addChecklistItem creates the Checklist section above Gates', async () => {
    await bounce({ type: 'addChecklistItem', cardId: 'alpha', text: '  first  item  ' });
    await waitFor(() => (api.store.getBoard(BOARD)?.cards['alpha']?.checklist?.length ?? 0) === 1);

    const content = readCard('alpha');
    assert.ok(
      content.indexOf('## Checklist') < content.indexOf('## Gates'),
      `Checklist must precede Gates, file is:\n${content}`,
    );
    assert.match(content, /- \[ \] first item/, 'whitespace is collapsed, as the CLI does');

    await bounce({ type: 'addChecklistItem', cardId: 'alpha', text: '   ' });
    await fence();
    assert.strictEqual(
      api.store.getBoard(BOARD)?.cards['alpha']?.checklist?.length,
      1,
      'a blank item is ignored',
    );
  });

  test('toggleCheck flips the box the checklist item was written with', async () => {
    await bounce({ type: 'toggleCheck', cardId: 'alpha', index: 0 });
    await waitFor(() => api.store.getBoard(BOARD)?.cards['alpha']?.checklist?.[0]?.done === true);
    assert.match(readCard('alpha'), /- \[x\] first item/);
  });

  test('setDescription replaces only the description, keeping checklist and gates', async () => {
    await bounce({ type: 'setDescription', cardId: 'alpha', text: 'Rewritten.\n\nSecond para.' });
    await waitFor(
      () => !!api.store.getBoard(BOARD)?.cards['alpha']?.desc?.startsWith('Rewritten.'),
    );

    const content = readCard('alpha');
    assert.ok(!content.includes('Original description.'), 'the old description is gone');
    assert.ok(content.includes('Rewritten.\n\nSecond para.'));
    assert.ok(content.includes('- [x] first item'), 'the checklist survives');
    assert.ok(content.includes('- [x] seeded — kept'), 'the gates section survives');
  });

  test('setDescription with an empty string clears the description', async () => {
    await bounce({ type: 'setDescription', cardId: 'alpha', text: '' });
    await waitFor(() => api.store.getBoard(BOARD)?.cards['alpha']?.desc === undefined);
    const content = readCard('alpha');
    assert.ok(!content.includes('Rewritten.'));
    assert.ok(content.includes('## Checklist'), 'the sections are still there');
  });

  test('the copyRef message puts the same reference on the clipboard as the store builds', async function () {
    if (!(await clipboardWorks())) {
      this.skip();
    }
    const expected = api.store.cardRef(BOARD, 'alpha');
    assert.ok(expected, 'the store can build a ref for alpha');
    await vscode.env.clipboard.writeText('not the ref yet');

    await bounce({ type: 'copyRef', cardId: 'alpha' });
    let copied = '';
    const start = Date.now();
    while (copied !== expected) {
      copied = await vscode.env.clipboard.readText();
      if (Date.now() - start > 8000) {
        assert.fail(`clipboard never received the ref; it holds "${copied}"`);
      }
      await delay(120);
    }
    assert.strictEqual(copied, expected);
    assert.match(copied, /^parity-board\/alpha — .+ \(boards\/parity-board\/\d+-alpha\.md\)$/);
  });

  test('repodoc.copyRef on a card tree node copies the same reference', async function () {
    if (!(await clipboardWorks())) {
      this.skip();
    }
    await vscode.commands.executeCommand('repodoc.copyRef', cardNode('beta'));
    assert.strictEqual(await vscode.env.clipboard.readText(), api.store.cardRef(BOARD, 'beta'));
  });

  test('repodoc.copyRef with a node it does not understand does nothing', async () => {
    await vscode.commands.executeCommand('repodoc.copyRef', { kind: 'column' });
    await vscode.commands.executeCommand('repodoc.copyRef', undefined);
    assert.ok(true, 'reaching here without an exception is the assertion');
  });

  test('repodoc.openCardFile opens the markdown file behind a card node', async () => {
    await vscode.commands.executeCommand('repodoc.openCardFile', cardNode('alpha'));
    const opened = await waitFor(() => {
      const active = vscode.window.activeTextEditor?.document.uri.fsPath;
      return active?.endsWith('-alpha.md') ? active : undefined;
    });
    assert.strictEqual(opened, path.join(cardsDir, cardFile('alpha') ?? ''));
  });

  test('repodoc.openCardFile ignores nodes that are not cards', async () => {
    await vscode.commands.executeCommand('repodoc.openCardFile', { kind: 'board' });
    await vscode.commands.executeCommand('repodoc.openCardFile', undefined);
    assert.ok(true, 'reaching here without an exception is the assertion');
  });

  test('repodoc.setDecisionStatus writes the picked status and preserves the body', async function () {
    this.timeout(45000);
    const file = path.join(root, 'decisions', '01-a-choice.md');
    const body = '# Decision 01 — A Choice\n\nBody with a --- inside.\n';
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `---\nstatus: Superseded\n---\n${body}`);

    const picking = vscode.commands.executeCommand('repodoc.setDecisionStatus', '01-a-choice');
    // 'Proposed' is the first item of the pick, so accepting the selection is
    // enough; the pick may need a moment to take focus, hence the retry.
    const start = Date.now();
    for (;;) {
      try {
        await vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
      } catch {
        // The quick pick is not focused yet — try again below.
      }
      await delay(250);
      if (fs.readFileSync(file, 'utf8').includes('status: Proposed')) {
        break;
      }
      if (Date.now() - start > 25000) {
        await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
        throw new Error('the decision status quick pick never accepted an item');
      }
    }
    await picking;
    assert.strictEqual(fs.readFileSync(file, 'utf8'), `---\nstatus: Proposed\n---\n${body}`);
  });

  test('repodoc.setDecisionStatus without an id shows no picker and changes nothing', async () => {
    const file = path.join(root, 'decisions', '01-a-choice.md');
    const before = fs.readFileSync(file, 'utf8');
    await vscode.commands.executeCommand('repodoc.setDecisionStatus', undefined);
    await vscode.commands.executeCommand('repodoc.setDecisionStatus', {});
    assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
  });
});
