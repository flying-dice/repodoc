import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { RepoDocApi } from '../../src/extension';
import { CardBoardSource, FeatureSetSource } from '../../src/panels/boardSource';
import { type BoardsNode, BoardsTreeProvider } from '../../src/trees';

/**
 * Feature sets end to end: the Boards tree renders set → columns → features,
 * `repodoc.openBoard` opens the same kanban panel for a set, the surface
 * declares none of the card-board editing capabilities, and the feature
 * commands (`openFeature`, `copyRef`) act on the real `.feature` files.
 *
 * The tree provider and the board sources are constructed here over the SAME
 * store the extension exposes: they are the objects the extension registers
 * (`extension.ts`) and the panel reads capabilities from (`boardPanel.ts`
 * `postData`), so asserting on them asserts what the webview is told.
 */

const EXTENSION_ID = 'flying-dice.repodoc';
const SET = 'spec-set';
const BOARD = 'card-board';

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

function findTab(predicate: (tab: vscode.Tab) => boolean): vscode.Tab | undefined {
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (predicate(tab)) {
        return tab;
      }
    }
  }
  return undefined;
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

suite('RepoDoc feature sets e2e', () => {
  let api: RepoDocApi;
  let root: string;
  let setDir: string;
  let tree: BoardsTreeProvider;

  const featureFile = (name: string): string =>
    fs.readFileSync(path.join(setDir, `${name}.feature`), 'utf8');

  /** Root nodes of the Boards tree, as VS Code would ask for them. */
  const rootNodes = (): BoardsNode[] => tree.getChildren();

  const setNode = (): BoardsNode => {
    const node = rootNodes().find((n) => n.kind === 'featureSet' && n.ref.id === SET);
    assert.ok(node, `the Boards tree should list the ${SET} feature set`);
    return node;
  };

  suiteSetup(async function () {
    this.timeout(60000);
    root = workspaceRoot();
    for (const entry of fs.readdirSync(root)) {
      fs.rmSync(path.join(root, entry), { recursive: true, force: true });
    }

    // A card board so the tree has both kinds and their order can be asserted.
    const boardDir = path.join(root, 'boards', BOARD);
    fs.mkdirSync(boardDir, { recursive: true });
    fs.writeFileSync(
      path.join(boardDir, '.config.json'),
      JSON.stringify({
        name: 'A Card Board',
        columns: [{ id: 'todo', name: 'To Do', color: '#4c8bf5' }],
        labels: {},
        fields: [],
      }),
    );
    fs.writeFileSync(path.join(boardDir, '01-a-card.md'), '---\ncolumn: todo\n---\n# A Card\n');

    setDir = path.join(root, 'features', SET);
    fs.mkdirSync(setDir, { recursive: true });
    fs.writeFileSync(
      path.join(setDir, '.config.json'),
      JSON.stringify({
        name: 'Spec Set',
        columns: [
          { id: 'proposed', name: 'Proposed', color: '#7d828b' },
          { id: 'specified', name: 'Specified', color: '#4c8bf5' },
          { id: 'verified', name: 'Verified', color: '#3fb27f' },
        ],
        labels: {},
        fields: [],
      }),
    );
    fs.writeFileSync(
      path.join(setDir, 'gates-block-a-move.feature'),
      [
        '@status:specified @core',
        'Feature: Gates block a move',
        '  A card may not enter a column whose enter gates fail.',
        '',
        '  Scenario: The move is refused',
        '    Then it stays put',
        '',
      ].join('\n'),
    );
    fs.writeFileSync(path.join(setDir, 'untagged.feature'), 'Feature: Untagged\n\n  Scenario: S\n');

    const ext = vscode.extensions.getExtension<RepoDocApi>(EXTENSION_ID);
    assert.ok(ext, `extension ${EXTENSION_ID} should be installed`);
    api = await ext.activate();
    assert.ok(api?.store, 'activate() should return the store api');
    tree = new BoardsTreeProvider(api.store);
  });

  test('the Boards tree lists feature sets after boards, with their feature count', () => {
    const nodes = rootNodes();
    assert.deepStrictEqual(
      nodes.map((n) => n.kind),
      ['board', 'featureSet'],
      'boards come first, then feature sets',
    );
    const set = setNode();
    assert.strictEqual(set.kind, 'featureSet');
    assert.strictEqual(set.ref.name, 'Spec Set');
    assert.strictEqual(set.ref.featureCount, 2, '.config.json is not counted as a feature');
  });

  test('a feature set expands to its configured columns with per-column counts', () => {
    const columns = tree.getChildren(setNode());
    assert.deepStrictEqual(
      columns.map((c) => (c.kind === 'featureColumn' ? [c.columnId, c.count] : c.kind)),
      [
        ['proposed', 1],
        ['specified', 1],
        ['verified', 0],
      ],
      'an untagged feature falls into the first column',
    );
  });

  test('a feature column expands to feature nodes that open the .feature file', () => {
    const columns = tree.getChildren(setNode());
    const specified = columns.find((c) => c.kind === 'featureColumn' && c.columnId === 'specified');
    assert.ok(specified, 'the specified column is present');
    const features = tree.getChildren(specified);
    assert.strictEqual(features.length, 1);
    const feature = features[0];
    assert.ok(feature && feature.kind === 'feature');
    assert.strictEqual(feature.featureId, 'gates-block-a-move');
    assert.strictEqual(feature.title, 'Gates block a move', 'the title comes from Feature:');

    const item = tree.getTreeItem(feature);
    assert.strictEqual(item.contextValue, 'repodoc.feature');
    assert.strictEqual(item.command?.command, 'repodoc.openFeature');
    assert.deepStrictEqual(item.command?.arguments, [SET, 'gates-block-a-move']);
  });

  test('a feature set surface declares none of the card-board editing capabilities', () => {
    // BoardPanel.postData sends `source.capabilities` straight to the webview,
    // so this IS the payload the feature panel renders from.
    const features = new FeatureSetSource(api.store, SET);
    assert.deepStrictEqual(features.capabilities, {
      comments: false,
      fields: false,
      checklist: false,
      checklistAdd: false,
      addColumn: false,
      meta: false,
      description: false,
      gateEvidence: false,
    });
    const cards = new CardBoardSource(api.store, BOARD);
    assert.strictEqual(cards.capabilities.comments, true, 'a card board keeps every capability');
    assert.strictEqual(cards.capabilities.fields, true);
    assert.strictEqual(cards.capabilities.checklist, true);
    assert.strictEqual(cards.capabilities.addColumn, true);

    // The feature surface also refuses to gate a move (no gates on features).
    assert.deepStrictEqual(features.evaluateMove(), []);
    assert.strictEqual(features.displayPath(), `features/${SET}/`);
  });

  test('repodoc.openBoard on a feature-set tree node opens a board panel for the set', async () => {
    await vscode.commands.executeCommand('repodoc.openBoard', setNode());
    const tab = await waitFor(() =>
      findTab((t) => t.input instanceof vscode.TabInputWebview && t.label === 'Spec Set'),
    );
    assert.strictEqual(tab.label, 'Spec Set');

    // The panel renders the set as board data: columns from the config, one
    // card per feature, features never in two columns at once.
    const board = api.store.getFeatureSet(SET);
    assert.ok(board);
    assert.deepStrictEqual(
      board.columns.map((c) => c.id),
      ['proposed', 'specified', 'verified'],
    );
    assert.deepStrictEqual(Object.keys(board.cards).sort(), ['gates-block-a-move', 'untagged']);
    const card = board.cards['gates-block-a-move'];
    assert.deepStrictEqual(card?.labels, ['@core'], 'the @status: tag is not shown as a label');
    assert.ok(card?.desc?.includes('## Scenarios'), 'scenarios are listed on the card');
  });

  test('repodoc.openFeature opens the .feature file itself in an editor', async () => {
    await vscode.commands.executeCommand('repodoc.openFeature', SET, 'gates-block-a-move');
    const opened = await waitFor(() => {
      const active = vscode.window.activeTextEditor?.document.uri.fsPath;
      return active?.endsWith('gates-block-a-move.feature') ? active : undefined;
    });
    assert.ok(opened.startsWith(setDir), 'the file opened is the one inside the feature set');
  });

  test('repodoc.openFeature with an unknown feature does nothing', async () => {
    await vscode.commands.executeCommand('repodoc.openFeature', SET, 'does-not-exist');
    await vscode.commands.executeCommand('repodoc.openFeature', undefined, undefined);
    assert.ok(true, 'reaching here without an exception is the assertion');
  });

  test('repodoc.copyRef on a feature node copies the pasteable reference', async function () {
    if (!(await clipboardWorks())) {
      this.skip();
    }
    const columns = tree.getChildren(setNode());
    const specified = columns.find((c) => c.kind === 'featureColumn' && c.columnId === 'specified');
    assert.ok(specified);
    const feature = tree.getChildren(specified)[0];
    assert.ok(feature && feature.kind === 'feature');

    await vscode.commands.executeCommand('repodoc.copyRef', feature);
    const copied = await vscode.env.clipboard.readText();
    assert.strictEqual(
      copied,
      'spec-set/gates-block-a-move — Gates block a move (features/spec-set/gates-block-a-move.feature)',
    );
    assert.strictEqual(copied, api.store.featureRef(SET, 'gates-block-a-move'));
  });

  test('moving a feature rewrites only its @status: tag and never renames the file', () => {
    const before = featureFile('gates-block-a-move');
    const moved = api.store.moveFeature(SET, 'gates-block-a-move', 'verified');
    assert.deepStrictEqual(moved, { ok: true });
    assert.strictEqual(
      featureFile('gates-block-a-move'),
      before.replace('@status:specified', '@status:verified'),
      'every other byte of the file must survive the move',
    );
    assert.deepStrictEqual(fs.readdirSync(setDir).sort(), [
      '.config.json',
      'gates-block-a-move.feature',
      'untagged.feature',
    ]);

    const columns = tree.getChildren(setNode());
    assert.deepStrictEqual(
      columns.map((c) => (c.kind === 'featureColumn' ? c.count : -1)),
      [1, 0, 1],
      'the tree follows the tag',
    );
  });

  test('a feature file with no Feature: line is still visible in the tree', () => {
    // A stray file keeps the tags it declares (its `@status:` among them), so
    // it shows under the column the tag names, titled by its file name — the
    // board agrees with the tag a move would rewrite.
    fs.writeFileSync(path.join(setDir, 'stray.feature'), '@status:verified\njust prose\n');
    const columns = tree.getChildren(setNode());
    const verified = columns.find((c) => c.kind === 'featureColumn' && c.columnId === 'verified');
    assert.ok(verified, 'the set has a verified column');
    const titles = tree.getChildren(verified).map((n) => (n.kind === 'feature' ? n.title : ''));
    assert.ok(titles.includes('stray'), `the file name stands in for the title, saw ${titles}`);
  });
});
