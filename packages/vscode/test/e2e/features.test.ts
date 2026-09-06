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
 * commands route: `openFeature` opens the set's panel and the feature's managed
 * detail modal, `openFeatureSource` opens the raw `.feature` file, and
 * `copyRef` copies the reference to it.
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

function countTabs(predicate: (tab: vscode.Tab) => boolean): number {
  let count = 0;
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (predicate(tab)) {
        count += 1;
      }
    }
  }
  return count;
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

  test('a feature column expands to feature nodes bound to the managed open', () => {
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

  test('a feature set declares the Gherkin affordances and none of the card ones', () => {
    // BoardPanel.postData sends `source.capabilities` straight to the webview,
    // so this IS the payload the feature panel renders from.
    const features = new FeatureSetSource(api.store, SET);
    assert.deepStrictEqual(features.capabilities, {
      comments: false,
      fields: false,
      checklist: false,
      checklistAdd: false,
      addColumn: false,
      // Editable: the title (the `Feature:` line), the prose under it, and the
      // scenarios. Everything else belongs to a card board.
      meta: true,
      description: true,
      gateEvidence: false,
      scenarios: true,
    });
    const cards = new CardBoardSource(api.store, BOARD);
    assert.strictEqual(cards.capabilities.comments, true, 'a card board keeps every capability');
    assert.strictEqual(cards.capabilities.fields, true);
    assert.strictEqual(cards.capabilities.checklist, true);
    assert.strictEqual(cards.capabilities.addColumn, true);
    assert.strictEqual(cards.capabilities.scenarios, false, 'cards are markdown, not Gherkin');

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
    assert.strictEqual(
      card?.desc,
      'A card may not enter a column whose enter gates fail.',
      'the description is the feature prose alone — it is editable, so it holds no rendered list',
    );
    assert.deepStrictEqual(
      card?.scenarios,
      [
        {
          name: 'The move is refused',
          tags: [],
          keyword: 'Scenario',
          steps: ['Then it stays put'],
        },
      ],
      'scenarios reach the webview as data it can edit',
    );
  });

  test('repodoc.openFeature opens the set panel and its modal, not the .feature file', async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');

    await vscode.commands.executeCommand('repodoc.openFeature', SET, 'gates-block-a-move');
    await waitFor(() =>
      findTab((t) => t.input instanceof vscode.TabInputWebview && t.label === 'Spec Set'),
    );

    // The feature panel is the surface that got the request: the bounce
    // channel only answers for a panel keyed `features:<set>`.
    assert.strictEqual(
      await vscode.commands.executeCommand<boolean>(
        'repodoc.bounceWebviewMessage',
        SET,
        { type: 'ready' },
        'features',
      ),
      true,
      'a feature-set panel is open for the set',
    );

    // The raw source stays shut: that is now `repodoc.openFeatureSource`.
    await delay(500);
    assert.strictEqual(
      findTab(
        (t) =>
          t.input instanceof vscode.TabInputText && t.label.endsWith('gates-block-a-move.feature'),
      ),
      undefined,
      'the .feature file is not opened by the managed route',
    );

    // Invoked again it reveals the same panel rather than opening a second tab.
    await vscode.commands.executeCommand('repodoc.openFeature', SET, 'untagged');
    await delay(500);
    assert.strictEqual(
      countTabs((t) => t.input instanceof vscode.TabInputWebview && t.label === 'Spec Set'),
      1,
      'the open panel is reused',
    );
  });

  test('repodoc.openFeatureSource opens the .feature file itself in an editor', async () => {
    await vscode.commands.executeCommand('repodoc.openFeatureSource', SET, 'gates-block-a-move');
    const opened = await waitFor(() => {
      const active = vscode.window.activeTextEditor?.document.uri.fsPath;
      return active?.endsWith('gates-block-a-move.feature') ? active : undefined;
    });
    assert.ok(opened.startsWith(setDir), 'the file opened is the one inside the feature set');
  });

  test('repodoc.openFeatureSource also takes the tree node itself', async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    const columns = tree.getChildren(setNode());
    const specified = columns.find((c) => c.kind === 'featureColumn' && c.columnId === 'specified');
    assert.ok(specified);
    const feature = tree.getChildren(specified)[0];
    assert.ok(feature && feature.kind === 'feature');

    await vscode.commands.executeCommand('repodoc.openFeatureSource', feature);
    const opened = await waitFor(() => {
      const active = vscode.window.activeTextEditor?.document.uri.fsPath;
      return active?.endsWith('gates-block-a-move.feature') ? active : undefined;
    });
    assert.ok(opened.startsWith(setDir));
  });

  test('repodoc.openFeature / openFeatureSource with an unknown feature do nothing', async () => {
    await vscode.commands.executeCommand('repodoc.openFeature', SET, 'does-not-exist');
    await vscode.commands.executeCommand('repodoc.openFeature', undefined, undefined);
    await vscode.commands.executeCommand('repodoc.openFeatureSource', SET, 'does-not-exist');
    await vscode.commands.executeCommand('repodoc.openFeatureSource', undefined, undefined);
    await vscode.commands.executeCommand('repodoc.openFeatureSource', { kind: 'board' });
    assert.ok(true, 'reaching here without an exception is the assertion');
  });

  /**
   * Panels are keyed by kind AND id, so a board and a feature set sharing an id
   * never collide: the feature route must land on the `features:` panel even
   * when a card board with the same id already has one open.
   */
  test('a feature set and a board sharing an id open separate panels', async function () {
    this.timeout(30000);
    const sharedBoard = path.join(root, 'boards', 'shared');
    fs.mkdirSync(sharedBoard, { recursive: true });
    fs.writeFileSync(
      path.join(sharedBoard, '.config.json'),
      JSON.stringify({
        name: 'Shared Board',
        columns: [{ id: 'todo', name: 'To Do', color: '#4c8bf5' }],
        labels: {},
        fields: [],
      }),
    );
    const sharedSet = path.join(root, 'features', 'shared');
    fs.mkdirSync(sharedSet, { recursive: true });
    fs.writeFileSync(
      path.join(sharedSet, '.config.json'),
      JSON.stringify({
        name: 'Shared Set',
        columns: [{ id: 'proposed', name: 'Proposed', color: '#7d828b' }],
        labels: {},
        fields: [],
      }),
    );
    fs.writeFileSync(path.join(sharedSet, 'shared-one.feature'), 'Feature: Shared one\n');
    await waitFor(() => api.store.getFeature('shared', 'shared-one')?.title === 'Shared one');

    await vscode.commands.executeCommand('repodoc.openBoard', 'shared');
    await waitFor(() =>
      findTab((t) => t.input instanceof vscode.TabInputWebview && t.label === 'Shared Board'),
    );

    await vscode.commands.executeCommand('repodoc.openFeature', 'shared', 'shared-one');
    await waitFor(() =>
      findTab((t) => t.input instanceof vscode.TabInputWebview && t.label === 'Shared Set'),
    );
    assert.ok(
      findTab((t) => t.input instanceof vscode.TabInputWebview && t.label === 'Shared Board'),
      'the card board panel is still open — the set did not take its tab over',
    );
    assert.strictEqual(
      await vscode.commands.executeCommand<boolean>(
        'repodoc.bounceWebviewMessage',
        'shared',
        { type: 'ready' },
        'features',
      ),
      true,
      'the panel that answers under the features key is the one that opened',
    );
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

  /**
   * Managed editing end to end: every message is posted through the REAL
   * webview->host channel (the extension bounces it back through the feature
   * panel's webview) and asserted against the bytes on disk. The fixture below
   * is deliberately full of Gherkin RepoDoc does not model — a comment, feature
   * tags, a `Background:`, a `Rule:`, scenario tags, a doc string, an
   * `Examples:` table — because the promise being tested is that none of it
   * moves when one construct is edited.
   */
  suite('managed edits', () => {
    const MANAGED = [
      '# language: en',
      '@status:specified @core',
      'Feature: Managed editing',
      '',
      '  Prose under the feature.',
      '',
      '  Background:',
      '    Given a board',
      '',
      '  @slow',
      '  Scenario: The first one',
      '    When I edit it',
      '    Then only it changes',
      '',
      '  Rule: A rule survives',
      '',
      '    Scenario Outline: The second one',
      '      When I move with a <kind> gate',
      '      Examples:',
      '        | kind   |',
      '        | script |',
      '',
    ].join('\n');

    /**
     * What the store holds now — the value a managed editor would have been
     * opened over, and the `base` / `baseTitle` a save must carry to be taken.
     */
    const storedTitle = (id: string): string => api.store.getFeature(SET, id)?.title ?? '';
    const storedDesc = (id: string): string => api.store.getFeature(SET, id)?.description ?? '';

    /** Bounce a webview->host message through the feature panel's channel. */
    const bounce = (message: unknown): Thenable<boolean> =>
      vscode.commands.executeCommand<boolean>(
        'repodoc.bounceWebviewMessage',
        SET,
        message,
        'features',
      );

    /**
     * Post a message with a known effect and wait for it. The channel preserves
     * order, so once the fence has landed, every message posted before it has
     * been handled — that is how "nothing happened" is asserted without sleeping.
     */
    let fenceCount = 0;
    const fence = async (): Promise<void> => {
      const marker = `Fence ${++fenceCount}`;
      assert.strictEqual(
        await bounce({
          type: 'updateMeta',
          cardId: 'fence',
          patch: { title: marker },
          baseTitle: storedTitle('fence'),
        }),
        true,
      );
      await waitFor(() => api.store.getFeature(SET, 'fence')?.title === marker);
    };

    suiteSetup(async function () {
      this.timeout(30000);
      fs.writeFileSync(path.join(setDir, 'managed.feature'), MANAGED);
      fs.writeFileSync(path.join(setDir, 'fence.feature'), '@status:proposed\nFeature: Fence\n');
      // The panel must be open for the bounce channel to exist.
      await vscode.commands.executeCommand('repodoc.openBoard', setNode());
      await waitFor(() =>
        findTab((t) => t.input instanceof vscode.TabInputWebview && t.label === 'Spec Set'),
      );
      await waitFor(() => api.store.getFeature(SET, 'managed')?.title === 'Managed editing');
    });

    test('updateMeta rewrites the Feature line and nothing else', async () => {
      assert.strictEqual(
        await bounce({
          type: 'updateMeta',
          cardId: 'managed',
          patch: { title: 'Managed editing works' },
          baseTitle: storedTitle('managed'),
        }),
        true,
      );
      await waitFor(() => api.store.getFeature(SET, 'managed')?.title === 'Managed editing works');
      assert.strictEqual(
        featureFile('managed'),
        MANAGED.replace('Feature: Managed editing', 'Feature: Managed editing works'),
      );
    });

    test('setDescription rewrites the prose under Feature: and nothing else', async () => {
      const before = featureFile('managed');
      assert.strictEqual(
        await bounce({
          type: 'setDescription',
          cardId: 'managed',
          text: 'Rewritten prose.',
          base: storedDesc('managed'),
        }),
        true,
      );
      await waitFor(() => api.store.getFeature(SET, 'managed')?.description === 'Rewritten prose.');
      assert.strictEqual(
        featureFile('managed'),
        before.replace('  Prose under the feature.', '  Rewritten prose.'),
      );
    });

    test('setScenario rewrites one scenario, leaving Rule, Background and siblings alone', async () => {
      const before = featureFile('managed');
      assert.strictEqual(
        await bounce({
          type: 'setScenario',
          cardId: 'managed',
          index: 0,
          name: 'The first one, renamed',
          steps: ['When I edit it', 'Then only it changes', 'And nothing else does'],
        }),
        true,
      );
      await waitFor(
        () => api.store.getFeature(SET, 'managed')?.scenarios[0]?.name === 'The first one, renamed',
      );
      assert.strictEqual(
        featureFile('managed'),
        before
          .replace('Scenario: The first one', 'Scenario: The first one, renamed')
          .replace(
            '    Then only it changes\n',
            '    Then only it changes\n    And nothing else does\n',
          ),
      );
      const text = featureFile('managed');
      assert.ok(text.includes('  @slow\n'), 'the scenario keeps its tags');
      assert.ok(text.includes('  Background:\n    Given a board'), 'the Background is untouched');
      assert.ok(text.includes('  Rule: A rule survives'), 'the Rule is untouched');
      assert.ok(
        text.includes('        | script |'),
        'the sibling outline keeps its Examples table',
      );
    });

    test('addScenario appends, and removeScenario takes it back out', async () => {
      const before = featureFile('managed');
      assert.strictEqual(
        await bounce({
          type: 'addScenario',
          cardId: 'managed',
          name: 'A third one',
          steps: ['Given a new scenario', 'Then it is appended'],
        }),
        true,
      );
      await waitFor(() => api.store.getFeature(SET, 'managed')?.scenarios.length === 3);
      assert.strictEqual(
        featureFile('managed'),
        `${before.trimEnd()}\n\n  Scenario: A third one\n    Given a new scenario\n    Then it is appended\n`,
      );

      assert.strictEqual(
        await bounce({ type: 'removeScenario', cardId: 'managed', index: 2 }),
        true,
      );
      await waitFor(() => api.store.getFeature(SET, 'managed')?.scenarios.length === 2);
      assert.strictEqual(
        featureFile('managed'),
        before,
        'removing what was added gives the file back byte for byte',
      );
    });

    test('an invalid scenario message writes nothing', async () => {
      const before = featureFile('managed');
      await bounce({ type: 'setScenario', cardId: 'managed', index: -1, name: 'X', steps: [] });
      await bounce({ type: 'setScenario', cardId: 'managed', index: 1.5, name: 'X', steps: [] });
      await bounce({ type: 'setScenario', cardId: 'managed', index: 0, name: '   ', steps: [] });
      await bounce({ type: 'setScenario', cardId: 'managed', index: 0, name: 'X', steps: 'nope' });
      await bounce({ type: 'setScenario', cardId: 'managed', index: 99, name: 'X', steps: [] });
      await bounce({ type: 'addScenario', cardId: 'managed', name: '', steps: [] });
      await bounce({ type: 'removeScenario', cardId: 'managed', index: 99 });
      await bounce({ type: 'removeScenario', cardId: 'nope', index: 0 });
      await fence();
      assert.strictEqual(featureFile('managed'), before);
    });

    test('a title arriving with newlines cannot forge Gherkin', async () => {
      assert.strictEqual(
        await bounce({
          type: 'updateMeta',
          cardId: 'managed',
          patch: { title: 'Sneaky\n@status:proposed\nScenario: forged' },
          baseTitle: storedTitle('managed'),
        }),
        true,
      );
      await waitFor(() => (api.store.getFeature(SET, 'managed')?.title ?? '').startsWith('Sneaky'));
      const feature = api.store.getFeature(SET, 'managed');
      assert.strictEqual(feature?.title, 'Sneaky @status:proposed Scenario: forged');
      assert.strictEqual(feature?.status, 'specified', 'the forged status tag never took effect');
      assert.strictEqual(feature?.scenarios.length, 2, 'no forged scenario was written');
    });

    /**
     * The reproduction from the PR #1 review: type a description in the modal,
     * let `repodoc feature describe` (or any other author) write the file, then
     * press Save. The draft must NOT win by default — nothing is written, and
     * the webview is told what the file says so a human can choose.
     */
    test('setDescription over prose that changed on disk writes nothing', async () => {
      const openedOver = storedDesc('managed');
      const external = 'External author description must survive';
      fs.writeFileSync(
        path.join(setDir, 'managed.feature'),
        featureFile('managed').replace(openedOver, external),
      );
      await waitFor(() => storedDesc('managed') === external);

      const before = featureFile('managed');
      assert.strictEqual(
        await bounce({
          type: 'setDescription',
          cardId: 'managed',
          text: 'The stale draft.',
          base: openedOver,
        }),
        true,
      );
      // A save that cannot say what it was typed over is refused outright.
      await bounce({ type: 'setDescription', cardId: 'managed', text: 'No base at all.' });
      await fence();
      assert.strictEqual(featureFile('managed'), before, 'the external prose survives');

      // "Keep mine": the same draft, re-sent over what the file says now.
      await bounce({
        type: 'setDescription',
        cardId: 'managed',
        text: 'The stale draft.',
        base: storedDesc('managed'),
      });
      await waitFor(() => storedDesc('managed') === 'The stale draft.');
      assert.strictEqual(featureFile('managed'), before.replace(external, 'The stale draft.'));
    });

    test('updateMeta over a Feature: line that changed on disk writes nothing', async () => {
      const openedOver = storedTitle('managed');
      fs.writeFileSync(
        path.join(setDir, 'managed.feature'),
        featureFile('managed').replace(`Feature: ${openedOver}`, 'Feature: Renamed elsewhere'),
      );
      await waitFor(() => storedTitle('managed') === 'Renamed elsewhere');

      const before = featureFile('managed');
      await bounce({
        type: 'updateMeta',
        cardId: 'managed',
        patch: { title: 'The stale title' },
        baseTitle: openedOver,
      });
      await bounce({ type: 'updateMeta', cardId: 'managed', patch: { title: 'No base at all' } });
      await fence();
      assert.strictEqual(featureFile('managed'), before, 'the external title survives');

      await bounce({
        type: 'updateMeta',
        cardId: 'managed',
        patch: { title: 'The stale title' },
        baseTitle: storedTitle('managed'),
      });
      await waitFor(() => storedTitle('managed') === 'The stale title');
    });
  });
});
