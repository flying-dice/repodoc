import { describe, expect, test } from 'bun:test';
import * as assert from 'node:assert';
import { makeStore } from './helpers';

const CONFIG = JSON.stringify({
  name: 'RepoDoc',
  columns: [
    { id: 'proposed', name: 'Proposed', color: '#7d828b' },
    { id: 'specified', name: 'Specified', color: '#4c8bf5', prompt: 'Write the scenarios.' },
    { id: 'implemented', name: 'Implemented', color: '#5cd68a' },
  ],
});

const GATES_FEATURE = [
  '# a leading comment',
  '@status:specified @core',
  'Feature: Gates block a move',
  '',
  '  A move into a gated column is refused until every gate passes.',
  '',
  '  @slow',
  '  Scenario: The move is refused',
  '    Given a failing gate',
  '    Then the move is refused',
  '',
].join('\n');

function seeded(): ReturnType<typeof makeStore> {
  return makeStore({
    'features/repodoc/.config.json': CONFIG,
    'features/repodoc/gates.feature': GATES_FEATURE,
    'features/repodoc/untagged.feature': 'Feature: No status tag\n',
    'features/repodoc/unknown-column.feature': '@status:nowhere\nFeature: Unknown column\n',
  });
}

describe('feature sets', () => {
  test('listFeatureSets names each set and counts its .feature files', () => {
    const { store } = seeded();
    assert.deepStrictEqual(store.listFeatureSets(), [
      { id: 'repodoc', name: 'RepoDoc', featureCount: 3 },
    ]);
  });

  test('isInitialized is true for a repo that only has features/', () => {
    const { store } = makeStore({ 'features/repodoc/.config.json': CONFIG });
    assert.strictEqual(store.isInitialized(), true);
  });

  test('getFeatureSet buckets by @status: and falls back to the first column', () => {
    const { store } = seeded();
    const board = store.getFeatureSet('repodoc');
    assert.ok(board);
    assert.strictEqual(board.name, 'RepoDoc');
    assert.deepStrictEqual(
      board.columns.map((c) => [c.id, c.cardIds]),
      [
        // Missing and unknown status tags both land in the first column.
        ['proposed', ['unknown-column', 'untagged']],
        ['specified', ['gates']],
        ['implemented', []],
      ],
    );
    assert.strictEqual(board.columns[1]?.prompt, 'Write the scenarios.');
  });

  test('a feature card carries its non-status tags, its prose and its scenarios', () => {
    const { store } = seeded();
    const card = store.getFeatureSet('repodoc')?.cards['gates'];
    assert.deepStrictEqual(card, {
      id: 'gates',
      title: 'Gates block a move',
      labels: ['@core'],
      // The description is the feature's free text ALONE: it is editable, and a
      // rendered scenario list in it would be written back as prose.
      desc: 'A move into a gated column is refused until every gate passes.',
      scenarios: [
        {
          name: 'The move is refused',
          tags: ['@slow'],
          keyword: 'Scenario',
          steps: ['Given a failing gate', 'Then the move is refused'],
        },
      ],
    });
  });

  test('getFeatureSet / getFeature return undefined for unknown ids', () => {
    const { store } = seeded();
    assert.strictEqual(store.getFeatureSet('nope'), undefined);
    assert.strictEqual(store.getFeature('repodoc', 'nope'), undefined);
    assert.strictEqual(store.getFeature('nope', 'gates'), undefined);
  });

  test('getFeature exposes the parsed record', () => {
    const { store } = seeded();
    assert.deepStrictEqual(store.getFeature('repodoc', 'gates'), {
      id: 'gates',
      file: 'gates.feature',
      title: 'Gates block a move',
      description: 'A move into a gated column is refused until every gate passes.',
      tags: ['@core'],
      status: 'specified',
      scenarios: [
        {
          name: 'The move is refused',
          tags: ['@slow'],
          keyword: 'Scenario',
          steps: ['Given a failing gate', 'Then the move is refused'],
        },
      ],
    });
  });

  test('createFeatureSet writes a config with the default columns', () => {
    const { store, fs } = makeStore();
    const id = store.createFeatureSet('Payments Spec');
    assert.strictEqual(id, 'payments-spec');
    const config = JSON.parse(fs.readFile('features/payments-spec/.config.json') as string);
    assert.strictEqual(config.name, 'Payments Spec');
    assert.deepStrictEqual(
      (config.columns as Array<{ id: string }>).map((c) => c.id),
      ['proposed', 'specified', 'implemented', 'verified'],
    );
  });
});

describe('createFeature', () => {
  test('writes <slug>.feature with a status tag, suffixing a taken slug', () => {
    const { store, fs } = seeded();
    const first = store.createFeature('repodoc', 'Gates', 'implemented');
    assert.deepStrictEqual(first, { ok: true, cardId: 'gates-2' });
    assert.strictEqual(
      fs.readFile('features/repodoc/gates-2.feature'),
      '@status:implemented\nFeature: Gates\n',
    );
    const second = store.createFeature('repodoc', 'Gates');
    assert.deepStrictEqual(second, { ok: true, cardId: 'gates-3' });
    // No column given → the set's first column.
    assert.strictEqual(
      fs.readFile('features/repodoc/gates-3.feature'),
      '@status:proposed\nFeature: Gates\n',
    );
  });

  test('refuses an unknown set or column', () => {
    const { store } = seeded();
    assert.deepStrictEqual(store.createFeature('nope', 'X'), {
      ok: false,
      error: { code: 'unknown-board', boardId: 'nope' },
    });
    assert.deepStrictEqual(store.createFeature('repodoc', 'X', 'nowhere'), {
      ok: false,
      error: { code: 'unknown-column', columnId: 'nowhere' },
    });
  });
});

describe('moveFeature', () => {
  test('rewrites only the @status: tag, leaving every other byte alone', () => {
    const { store, fs } = seeded();
    assert.deepStrictEqual(store.moveFeature('repodoc', 'gates', 'implemented'), { ok: true });
    const after = fs.readFile('features/repodoc/gates.feature') as string;
    assert.strictEqual(after, GATES_FEATURE.replace('@status:specified', '@status:implemented'));
    assert.strictEqual(store.getFeature('repodoc', 'gates')?.status, 'implemented');
  });

  test('inserts a tag line above Feature: when the file has no status tag', () => {
    const { store, fs } = makeStore({
      'features/s/.config.json': CONFIG,
      'features/s/plain.feature': '# note\n@core\nFeature: Plain\n\n  Scenario: One\n',
    });
    assert.deepStrictEqual(store.moveFeature('s', 'plain', 'specified'), { ok: true });
    assert.strictEqual(
      fs.readFile('features/s/plain.feature'),
      '# note\n@core\n@status:specified\nFeature: Plain\n\n  Scenario: One\n',
    );
  });

  test('never renames the file', () => {
    const { store, fs } = seeded();
    store.moveFeature('repodoc', 'gates', 'implemented');
    assert.ok(fs.exists('features/repodoc/gates.feature'));
  });

  test('refuses an unknown set, feature or column', () => {
    const { store } = seeded();
    assert.deepStrictEqual(store.moveFeature('nope', 'gates', 'proposed'), {
      ok: false,
      error: { code: 'unknown-board', boardId: 'nope' },
    });
    assert.deepStrictEqual(store.moveFeature('repodoc', 'nope', 'proposed'), {
      ok: false,
      error: { code: 'unknown-card', cardId: 'nope' },
    });
    assert.deepStrictEqual(store.moveFeature('repodoc', 'gates', 'nowhere'), {
      ok: false,
      error: { code: 'unknown-column', columnId: 'nowhere' },
    });
  });

  test('mutations fire onDidChange; refusals do not', () => {
    const { store } = seeded();
    let fired = 0;
    store.onDidChange(() => {
      fired++;
    });
    store.createFeatureSet('Other');
    store.createFeature('repodoc', 'New one');
    store.moveFeature('repodoc', 'gates', 'implemented');
    expect(fired).toBe(3);
    store.moveFeature('repodoc', 'gates', 'nowhere');
    expect(fired).toBe(3);
  });
});

/**
 * Managed editing: the UI and the CLI change a feature's title, description and
 * scenarios without opening the file. The store's job is to write the right
 * file and to leave everything it was not asked about exactly as it was.
 */
describe('managed feature edits', () => {
  test('updateFeatureMeta rewrites the Feature line and the prose, and nothing else', () => {
    const { store, fs } = seeded();
    assert.strictEqual(
      store.updateFeatureMeta('repodoc', 'gates', {
        title: 'Gates refuse a move',
        description: 'Rewritten prose.',
      }),
      true,
    );
    assert.strictEqual(
      fs.readFile('features/repodoc/gates.feature'),
      GATES_FEATURE.replace('Feature: Gates block a move', 'Feature: Gates refuse a move').replace(
        '  A move into a gated column is refused until every gate passes.',
        '  Rewritten prose.',
      ),
      'the comment, the tags and the scenario survive untouched',
    );
  });

  test('a title-only patch leaves the description alone, and the reverse', () => {
    const { store, fs } = seeded();
    store.updateFeatureMeta('repodoc', 'gates', { title: 'Renamed' });
    assert.strictEqual(
      fs.readFile('features/repodoc/gates.feature'),
      GATES_FEATURE.replace('Gates block a move', 'Renamed'),
    );
    store.updateFeatureMeta('repodoc', 'gates', { description: '' });
    assert.strictEqual(
      fs.readFile('features/repodoc/gates.feature'),
      GATES_FEATURE.replace('Gates block a move', 'Renamed').replace(
        '\n\n  A move into a gated column is refused until every gate passes.\n',
        '\n',
      ),
      'an empty description clears it and keeps one blank line',
    );
    assert.strictEqual(store.getFeature('repodoc', 'gates')?.title, 'Renamed');
  });

  test('setFeatureScenario rewrites one scenario, keyword and tags intact', () => {
    const { store, fs } = seeded();
    assert.strictEqual(
      store.setFeatureScenario('repodoc', 'gates', 0, {
        name: 'The move is refused loudly',
        steps: ['Given a failing gate', 'When I move', 'Then it is refused'],
      }),
      true,
    );
    assert.strictEqual(
      fs.readFile('features/repodoc/gates.feature'),
      [
        '# a leading comment',
        '@status:specified @core',
        'Feature: Gates block a move',
        '',
        '  A move into a gated column is refused until every gate passes.',
        '',
        '  @slow',
        '  Scenario: The move is refused loudly',
        '    Given a failing gate',
        '    When I move',
        '    Then it is refused',
        '',
      ].join('\n'),
    );
  });

  test('addFeatureScenario appends and removeFeatureScenario takes it back out', () => {
    const { store, fs } = seeded();
    assert.strictEqual(
      store.addFeatureScenario('repodoc', 'gates', {
        name: 'An override lets it through',
        steps: ['Given an override', 'Then it moves'],
      }),
      true,
    );
    const added = fs.readFile('features/repodoc/gates.feature') as string;
    assert.strictEqual(
      added,
      `${GATES_FEATURE.trimEnd()}\n\n  Scenario: An override lets it through\n    Given an override\n    Then it moves\n`,
    );
    assert.deepStrictEqual(
      store.getFeature('repodoc', 'gates')?.scenarios.map((sc) => sc.name),
      ['The move is refused', 'An override lets it through'],
    );
    assert.strictEqual(store.removeFeatureScenario('repodoc', 'gates', 1), true);
    assert.strictEqual(
      fs.readFile('features/repodoc/gates.feature'),
      GATES_FEATURE,
      'removing what was added gives the original file back',
    );
  });

  test('a feature file with no Feature: line refuses a description', () => {
    // There is nowhere to put it: a description is the text UNDER `Feature:`,
    // and prose written above the first scenario would never be read back.
    const { store, fs } = makeStore({
      'features/s/.config.json': CONFIG,
      'features/s/stray.feature': '@status:proposed\n  Scenario: Orphan\n',
    });
    assert.strictEqual(store.updateFeatureMeta('s', 'stray', { description: 'Prose.' }), false);
    assert.strictEqual(
      fs.readFile('features/s/stray.feature'),
      '@status:proposed\n  Scenario: Orphan\n',
    );
    // A title comes with a `Feature:` line, so the pair lands together.
    assert.strictEqual(
      store.updateFeatureMeta('s', 'stray', { title: 'Now titled', description: 'Prose.' }),
      true,
    );
    assert.strictEqual(
      fs.readFile('features/s/stray.feature'),
      '@status:proposed\nFeature: Now titled\n\n  Prose.\n\n  Scenario: Orphan\n',
    );
  });

  test('an unknown set, feature, index or blank name writes nothing', () => {
    const { store, fs } = seeded();
    const before = fs.readFile('features/repodoc/gates.feature');
    assert.strictEqual(store.updateFeatureMeta('nope', 'gates', { title: 'X' }), false);
    assert.strictEqual(store.updateFeatureMeta('repodoc', 'nope', { title: 'X' }), false);
    assert.strictEqual(store.updateFeatureMeta('repodoc', 'gates', { title: '   ' }), false);
    assert.strictEqual(store.setFeatureScenario('repodoc', 'gates', 1, { name: 'X' }), false);
    assert.strictEqual(store.setFeatureScenario('repodoc', 'gates', -1, { name: 'X' }), false);
    assert.strictEqual(store.setFeatureScenario('repodoc', 'gates', 1.5, { name: 'X' }), false);
    assert.strictEqual(store.setFeatureScenario('repodoc', 'gates', 0, { name: '' }), false);
    assert.strictEqual(store.addFeatureScenario('repodoc', 'gates', { name: ' ' }), false);
    assert.strictEqual(store.removeFeatureScenario('repodoc', 'gates', 4), false);
    assert.strictEqual(fs.readFile('features/repodoc/gates.feature'), before);
  });

  test('managed edits fire onDidChange; refusals do not', () => {
    const { store } = seeded();
    let fired = 0;
    store.onDidChange(() => {
      fired++;
    });
    store.updateFeatureMeta('repodoc', 'gates', { title: 'Renamed' });
    store.setFeatureScenario('repodoc', 'gates', 0, { name: 'Also renamed' });
    store.addFeatureScenario('repodoc', 'gates', { name: 'Third' });
    store.removeFeatureScenario('repodoc', 'gates', 1);
    expect(fired).toBe(4);
    store.updateFeatureMeta('repodoc', 'nope', { title: 'X' });
    store.setFeatureScenario('repodoc', 'gates', 9, { name: 'X' });
    store.removeFeatureScenario('repodoc', 'gates', 9);
    expect(fired).toBe(4);
  });

  test('a CRLF feature file stays CRLF through a managed edit', () => {
    const { store, fs } = makeStore({
      'features/s/.config.json': CONFIG,
      'features/s/crlf.feature':
        '@status:proposed\r\nFeature: C\r\n\r\n  Scenario: S\r\n    Given a\r\n',
    });
    store.updateFeatureMeta('s', 'crlf', { title: 'Renamed', description: 'Prose.' });
    store.setFeatureScenario('s', 'crlf', 0, { steps: ['Given a', 'Then b'] });
    assert.strictEqual(
      fs.readFile('features/s/crlf.feature'),
      '@status:proposed\r\nFeature: Renamed\r\n\r\n  Prose.\r\n\r\n  Scenario: S\r\n    Given a\r\n    Then b\r\n',
    );
  });
});
