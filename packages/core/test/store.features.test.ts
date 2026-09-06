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
    assert.strictEqual(board.columns[1].prompt, 'Write the scenarios.');
  });

  test('a feature card carries its non-status tags and a ## Scenarios list', () => {
    const { store } = seeded();
    const card = store.getFeatureSet('repodoc')?.cards.gates;
    assert.deepStrictEqual(card, {
      id: 'gates',
      title: 'Gates block a move',
      labels: ['@core'],
      desc:
        'A move into a gated column is refused until every gate passes.\n\n' +
        '## Scenarios\n\n- The move is refused',
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
      scenarios: [{ name: 'The move is refused', tags: ['@slow'] }],
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
