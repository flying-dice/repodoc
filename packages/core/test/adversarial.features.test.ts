/**
 * Adversarial coverage for Gherkin parsing (`featureParse.ts`) and feature-set
 * storage (`features.ts`): files without a `Feature:` line, tag lines in odd
 * places, `Rule:` blocks, `Scenario Outline` + `Examples`, CRLF files, slug
 * collisions, and the `@status:` tag rewrite that must preserve every other
 * byte of the file.
 *
 * `test.skip` marks a failing test for a defect reported to the lead — the
 * assertion states the contract, never the current behaviour.
 */

import { describe, test } from 'bun:test';
import * as assert from 'node:assert';
import {
  featureIdFromFileName,
  parseFeature,
  statusFromTags,
  tagsWithoutStatus,
} from '../src/featureParse';
import { writeStatusTag } from '../src/features';
import { makeStore, required } from './helpers';

const SET_CONFIG = JSON.stringify({
  name: 'Spec Set',
  columns: [
    { id: 'proposed', name: 'Proposed', color: '#000' },
    { id: 'done', name: 'Done', color: '#000' },
  ],
  labels: {},
  fields: [],
});

describe('parseFeature — adversarial', () => {
  test('given a file with no Feature line, when parsed, then the file name is the title and its tags still count', () => {
    // Nothing else can claim them, so tags left over at the end of the file are
    // the file's own — otherwise the board ignores a `@status:` tag that a move
    // would happily rewrite.
    const parsed = parseFeature('stray-notes.feature', '@status:done\nsome prose\n');
    assert.strictEqual(parsed.title, 'stray-notes');
    assert.deepStrictEqual(parsed.tags, ['@status:done']);
    assert.strictEqual(parsed.description, '');
    assert.deepStrictEqual(parsed.scenarios, []);
  });

  test("given a file with no Feature line, when parsed, then the tags above its first scenario are the file's own", () => {
    // A move rewrites the `@status:` tag on that line (see the paired store
    // test below), so the board has to read the file's status from there —
    // attributing it to the scenario left the board showing a column the file
    // no longer claimed.
    const parsed = parseFeature('x.feature', '@wip\nScenario: S\n');
    assert.deepStrictEqual(parsed.tags, ['@wip']);
    assert.deepStrictEqual(parsed.scenarios, [{ name: 'S', tags: [] }]);
  });

  test('given a file with no Feature line, when parsed, then tags BELOW its first scenario stay with their scenario', () => {
    const parsed = parseFeature('x.feature', '@wip\nScenario: S\n@slow\nScenario: T\n');
    assert.deepStrictEqual(parsed.tags, ['@wip']);
    assert.deepStrictEqual(parsed.scenarios, [
      { name: 'S', tags: [] },
      { name: 'T', tags: ['@slow'] },
    ]);
  });

  test('given a Feature: line with no text, when parsed, then the title falls back to the file name', () => {
    assert.strictEqual(parseFeature('my-file.feature', 'Feature:\n').title, 'my-file');
    assert.strictEqual(parseFeature('my-file.feature', 'Feature:   \n').title, 'my-file');
  });

  test('given a tag line as the very last line, when parsed, then it is dropped rather than crashing', () => {
    const parsed = parseFeature('x.feature', 'Feature: T\n\nDesc\n\n@wip');
    assert.strictEqual(parsed.title, 'T');
    assert.strictEqual(parsed.description, 'Desc');
    assert.deepStrictEqual(parsed.scenarios, []);
  });

  test('given tags spread over several lines with a comment between, when parsed, then all of them attach to the Feature', () => {
    const parsed = parseFeature(
      'x.feature',
      ['@a @b', '@status:done', '# a comment', '@c', 'Feature: T', '  Desc line', ''].join('\n'),
    );
    assert.deepStrictEqual(parsed.tags, ['@a', '@b', '@status:done', '@c']);
    assert.strictEqual(parsed.description, 'Desc line');
  });

  test('given a lone @ among tags, when parsed, then it is not treated as a tag', () => {
    assert.deepStrictEqual(parseFeature('x.feature', '@ @ok\nFeature: T\n').tags, ['@ok']);
  });

  test('given Rule blocks, when parsed, then every scenario inside them is found and Rule tags do not leak', () => {
    const parsed = parseFeature(
      'x.feature',
      [
        'Feature: T',
        '  desc',
        '',
        '  @rule-tag',
        '  Rule: R1',
        '',
        '    @tag',
        '    Example: E1',
        '',
        '  Rule: R2',
        '    Scenario: S2',
        '',
      ].join('\n'),
    );
    assert.strictEqual(parsed.description, 'desc');
    assert.deepStrictEqual(
      parsed.scenarios.map((s) => [s.name, s.tags]),
      [
        ['E1', ['@tag']],
        ['S2', []],
      ],
    );
  });

  test('given a Scenario Outline with Examples, when parsed, then the Examples table does not become a scenario', () => {
    const parsed = parseFeature(
      'x.feature',
      [
        'Feature: T',
        '',
        '  @o',
        '  Scenario Outline: SO',
        '    Given <x>',
        '',
        '    Examples:',
        '      | x |',
        '      | 1 |',
        '',
        '  Scenario: after',
        '',
      ].join('\n'),
    );
    assert.deepStrictEqual(
      parsed.scenarios.map((s) => [s.name, s.tags]),
      [
        ['SO', ['@o']],
        ['after', []],
      ],
    );
  });

  test('given a CRLF file, when parsed, then no carriage return survives in the title, tags or description', () => {
    const parsed = parseFeature(
      'x.feature',
      '@status:done @core\r\nFeature: T\r\n  desc one\r\n  desc two\r\n\r\n  Scenario: S\r\n',
    );
    assert.strictEqual(parsed.title, 'T');
    assert.deepStrictEqual(parsed.tags, ['@status:done', '@core']);
    assert.strictEqual(parsed.description, 'desc one\ndesc two');
    assert.deepStrictEqual(parsed.scenarios, [{ name: 'S', tags: [] }]);
  });

  test('given a second Feature line, when parsed, then the first wins and the second is description text', () => {
    const parsed = parseFeature('x.feature', 'Feature: One\nFeature: Two\n');
    assert.strictEqual(parsed.title, 'One');
    assert.strictEqual(parsed.description, 'Feature: Two');
  });

  test('given blank lines inside the description, when parsed, then the paragraph break survives', () => {
    const parsed = parseFeature('x.feature', 'Feature: T\n  one\n\n  two\n\n  Scenario: S\n');
    assert.strictEqual(parsed.description, 'one\n\ntwo');
  });
});

describe('statusFromTags / tagsWithoutStatus — adversarial', () => {
  test('given an empty @status: tag, when read, then there is no status but the tag is still not a label', () => {
    assert.strictEqual(statusFromTags(['@status:']), undefined);
    assert.deepStrictEqual(tagsWithoutStatus(['@status:', '@keep']), ['@keep']);
  });

  test('given two @status: tags, when read, then the first one wins and both are stripped from the labels', () => {
    assert.strictEqual(statusFromTags(['@status:one', '@status:two']), 'one');
    assert.deepStrictEqual(tagsWithoutStatus(['@status:one', '@status:two', '@x']), ['@x']);
  });

  test('given a tag that merely starts with the word status, when read, then it is not a status tag', () => {
    assert.strictEqual(statusFromTags(['@statuses', '@status-quo']), undefined);
    assert.deepStrictEqual(tagsWithoutStatus(['@statuses']), ['@statuses']);
  });

  test('given an uppercase extension, when the id is derived, then the extension is still stripped', () => {
    assert.strictEqual(featureIdFromFileName('Login.FEATURE'), 'Login');
    assert.strictEqual(featureIdFromFileName('no-extension'), 'no-extension');
  });
});

describe('writeStatusTag — adversarial', () => {
  test('given an existing tag among others, when rewritten, then only the status token changes', () => {
    assert.strictEqual(
      writeStatusTag('  @wip @status:old @slow\nFeature: T\n  body\n', 'new'),
      '  @wip @status:new @slow\nFeature: T\n  body\n',
    );
  });

  test('given no tag line, when rewritten, then one is inserted directly above the Feature line', () => {
    assert.strictEqual(
      writeStatusTag('# a comment\nFeature: T\n  body\n', 'done'),
      '# a comment\n@status:done\nFeature: T\n  body\n',
    );
  });

  test('given a file with no Feature line, when rewritten, then the tag goes to the very top', () => {
    assert.strictEqual(writeStatusTag('prose only\n', 'done'), '@status:done\nprose only\n');
    assert.strictEqual(writeStatusTag('', 'done'), '@status:done\n');
  });

  test('given a status tag that is the last line and no Feature line, when rewritten, then it is replaced in place', () => {
    assert.strictEqual(writeStatusTag('# c\n@status:a', 'b'), '# c\n@status:b');
  });

  test('given a status tag below the Feature line, when rewritten, then a feature-level tag is inserted above it', () => {
    // Tags under `Feature:` belong to scenarios, so the feature-level tag is
    // added where it belongs and the lower line is left alone.
    assert.strictEqual(
      writeStatusTag('Feature: T\n@status:old\n', 'new'),
      '@status:new\nFeature: T\n@status:old\n',
    );
  });

  test('given a CRLF file with a tag, when rewritten, then the CRLF endings survive', () => {
    assert.strictEqual(
      writeStatusTag('@status:proposed\r\nFeature: T\r\n', 'done'),
      '@status:done\r\nFeature: T\r\n',
    );
  });

  test('given a CRLF file with no tag, when rewritten, then the inserted line uses CRLF too', () => {
    assert.strictEqual(
      writeStatusTag('Feature: T\r\nbody\r\n', 'done'),
      '@status:done\r\nFeature: T\r\nbody\r\n',
    );
  });

  test('given an LF file with no tag, when rewritten, then no carriage return is introduced', () => {
    assert.strictEqual(
      writeStatusTag('Feature: T\nbody\n', 'done'),
      '@status:done\nFeature: T\nbody\n',
    );
  });
});

describe('FeatureStore through the store — adversarial', () => {
  const seed = (extra: Record<string, string> = {}): ReturnType<typeof makeStore> =>
    makeStore({
      'features/s/.config.json': SET_CONFIG,
      'features/s/a.feature': '@status:done\nFeature: A\n',
      ...extra,
    });

  test('given a taken slug, when features are created, then collisions suffix -2 then -3', () => {
    const { fs, store } = seed();
    assert.deepStrictEqual(store.createFeature('s', 'A!!!'), { ok: true, cardId: 'a-2' });
    assert.deepStrictEqual(store.createFeature('s', 'a'), { ok: true, cardId: 'a-3' });
    assert.strictEqual(
      required(fs.readFile('features/s/a-2.feature'), 'a-2 file'),
      '@status:proposed\nFeature: A!!!\n',
    );
  });

  test('given a file whose name differs only in case, when a feature is created, then the slug is suffixed', () => {
    // `Login.feature` and `login.feature` are one file on macOS and Windows:
    // handing out `login` there silently overwrites the existing feature.
    const { fs, store } = makeStore({
      'features/s/.config.json': SET_CONFIG,
      'features/s/Login.feature': '@status:done\nFeature: Login\n',
    });
    assert.deepStrictEqual(store.createFeature('s', 'Login'), { ok: true, cardId: 'login-2' });
    assert.strictEqual(
      required(fs.readFile('features/s/Login.feature'), 'the original file'),
      '@status:done\nFeature: Login\n',
    );
  });

  test('given a set directory that differs only in case, when a set is created, then the id is suffixed', () => {
    const { fs, store } = makeStore({ 'features/Spec/.config.json': SET_CONFIG });
    assert.strictEqual(store.createFeatureSet('spec'), 'spec-2');
    assert.strictEqual(
      required(fs.readFile('features/Spec/.config.json'), 'the original config'),
      SET_CONFIG,
    );
  });

  test('given a title with no ASCII letters, when created, then the fallback slug is used and the title survives', () => {
    const { fs, store } = seed();
    assert.deepStrictEqual(store.createFeature('s', '日本語'), { ok: true, cardId: 'feature' });
    assert.strictEqual(
      required(fs.readFile('features/s/feature.feature'), 'feature file'),
      '@status:proposed\nFeature: 日本語\n',
    );
  });

  test('given a title carrying a newline, when created, then it cannot forge a second Feature line', () => {
    const { fs, store } = seed();
    const created = store.createFeature('s', 'Real\nFeature: Forged');
    assert.ok(created.ok);
    const content = required(
      fs.readFile(`features/s/${created.cardId}.feature`),
      'created feature file',
    );
    assert.strictEqual(content.split('\n').filter((l) => l.startsWith('Feature:')).length, 1);
  });

  test('given an unknown column or set, when creating, then it refuses and writes nothing', () => {
    const { fs, store } = seed();
    const before = fs.snapshot();
    assert.deepStrictEqual(store.createFeature('s', 'X', 'nope'), {
      ok: false,
      error: { code: 'unknown-column', columnId: 'nope' },
    });
    assert.deepStrictEqual(store.createFeature('nope', 'X'), {
      ok: false,
      error: { code: 'unknown-board', boardId: 'nope' },
    });
    assert.deepStrictEqual(fs.snapshot(), before);
  });

  test('given a set with no config, when creating, then it refuses with an empty column id', () => {
    const { store } = makeStore({ 'features/s/a.feature': 'Feature: A\n' });
    assert.deepStrictEqual(store.createFeature('s', 'X'), {
      ok: false,
      error: { code: 'unknown-column', columnId: '' },
    });
  });

  test('given a rich feature file, when moved, then only the status token changes and the file is not renamed', () => {
    const original = [
      '# top comment',
      '@core @status:proposed',
      'Feature: Rich',
      '  Some description.',
      '',
      '  Background:',
      '    Given setup',
      '',
      '  @slow',
      '  Scenario: One',
      '    Then ok',
      '',
    ].join('\n');
    const { fs, store } = makeStore({
      'features/s/.config.json': SET_CONFIG,
      'features/s/rich.feature': original,
    });
    assert.deepStrictEqual(store.moveFeature('s', 'rich', 'done'), { ok: true });
    assert.strictEqual(
      required(fs.readFile('features/s/rich.feature'), 'rich file'),
      original.replace('@status:proposed', '@status:done'),
    );
    assert.deepStrictEqual(
      fs
        .listDir('features/s')
        .map((e) => e.name)
        .sort(),
      ['.config.json', 'rich.feature'],
    );
  });

  test('given an unknown set, feature or column, when moving, then the error names what was missing', () => {
    const { fs, store } = seed();
    const before = fs.snapshot();
    assert.deepStrictEqual(store.moveFeature('nope', 'a', 'done'), {
      ok: false,
      error: { code: 'unknown-board', boardId: 'nope' },
    });
    assert.deepStrictEqual(store.moveFeature('s', 'nope', 'done'), {
      ok: false,
      error: { code: 'unknown-card', cardId: 'nope' },
    });
    assert.deepStrictEqual(store.moveFeature('s', 'a', 'nope'), {
      ok: false,
      error: { code: 'unknown-column', columnId: 'nope' },
    });
    assert.deepStrictEqual(fs.snapshot(), before);
  });

  test('given features tagged with an unknown or missing status, when the board renders, then they land in the first column', () => {
    const { store } = seed({
      'features/s/b.feature': '@status:mystery\nFeature: B\n',
      'features/s/c.feature': 'Feature: C\n',
    });
    const board = required(store.getFeatureSet('s'), 'feature set board');
    const proposed = required(
      board.columns.find((c) => c.id === 'proposed'),
      'proposed column',
    );
    assert.deepStrictEqual(proposed.cardIds, ['b', 'c']);
    assert.deepStrictEqual(
      required(
        board.columns.find((c) => c.id === 'done'),
        'done column',
      ).cardIds,
      ['a'],
    );
  });

  test('given a feature with tags and scenarios, when the board renders, then labels and a Scenarios list are derived', () => {
    const { store } = seed({
      'features/s/d.feature':
        '@status:done @ui\nFeature: D\n  Prose.\n\n  Scenario: First\n\n  Scenario: Second\n',
    });
    const card = required(store.getFeatureSet('s'), 'board').cards['d'];
    assert.deepStrictEqual(card?.labels, ['@ui']);
    assert.strictEqual(card?.desc, 'Prose.\n\n## Scenarios\n\n- First\n- Second');
  });

  test('given an unknown feature, when a ref or path is asked for, then both are undefined', () => {
    const { store } = seed();
    assert.strictEqual(store.featureRef('s', 'nope'), undefined);
    assert.strictEqual(store.featureRef('nope', 'a'), undefined);
    assert.strictEqual(store.featureFilePath('s', 'nope'), undefined);
    assert.strictEqual(store.featureRef('s', 'a'), 's/a — A (features/s/a.feature)');
    assert.strictEqual(store.featureFilePath('s', 'a'), 'features/s/a.feature');
  });

  test('given a file with no Feature line, when moved, then the board follows its new column', () => {
    const { fs, store } = makeStore({
      'features/s/.config.json': SET_CONFIG,
      'features/s/stray.feature': '@status:proposed\njust prose\n',
    });
    assert.deepStrictEqual(store.moveFeature('s', 'stray', 'done'), { ok: true });
    assert.strictEqual(
      required(fs.readFile('features/s/stray.feature'), 'stray file'),
      '@status:done\njust prose\n',
    );
    assert.strictEqual(
      required(store.getFeature('s', 'stray'), 'stray record').status,
      'done',
      'the board must agree with the tag the move just wrote',
    );
  });

  test('given a file with no Feature line and no tag, when moved, then a tag is inserted and the board follows it', () => {
    const { fs, store } = makeStore({
      'features/s/.config.json': SET_CONFIG,
      'features/s/stray.feature': 'just prose\n',
    });
    assert.deepStrictEqual(store.moveFeature('s', 'stray', 'done'), { ok: true });
    assert.strictEqual(
      required(fs.readFile('features/s/stray.feature'), 'stray file'),
      '@status:done\njust prose\n',
    );
    assert.strictEqual(required(store.getFeature('s', 'stray'), 'stray record').status, 'done');
  });

  test('given a Feature-less file whose tag line sits above a scenario, when moved, then the board follows the tag that was written', () => {
    // The parse half of this contract is asserted above; pairing them is the
    // point — the tag a move rewrites and the tag the board reads must be the
    // same line.
    const { fs, store } = makeStore({
      'features/s/.config.json': SET_CONFIG,
      'features/s/stray.feature': '@wip\nScenario: S\n',
    });
    assert.deepStrictEqual(store.moveFeature('s', 'stray', 'done'), { ok: true });
    assert.strictEqual(
      required(fs.readFile('features/s/stray.feature'), 'stray file'),
      '@status:done\n@wip\nScenario: S\n',
    );
    const record = required(store.getFeature('s', 'stray'), 'stray record');
    assert.strictEqual(record.status, 'done', 'the board must agree with the tag the move wrote');
    assert.deepStrictEqual(record.tags, ['@wip'], 'the file keeps its other tag');
  });

  test('given a @status: tag that belongs to a scenario, when the file is moved, then that tag is left alone', () => {
    const original = '@wip\nScenario: S\n@status:proposed\nScenario: T\n';
    const { fs, store } = makeStore({
      'features/s/.config.json': SET_CONFIG,
      'features/s/stray.feature': original,
    });
    // The board never read the scenario's tag as the file's status, so a move
    // must not rewrite it: the file gets its own tag line instead.
    assert.strictEqual(required(store.getFeature('s', 'stray'), 'record').status, 'proposed');
    assert.deepStrictEqual(store.moveFeature('s', 'stray', 'done'), { ok: true });
    assert.strictEqual(
      required(fs.readFile('features/s/stray.feature'), 'stray file'),
      `@status:done\n${original}`,
    );
    assert.strictEqual(required(store.getFeature('s', 'stray'), 'record').status, 'done');
  });

  test('given a CRLF feature file, when moved, then the file keeps its CRLF endings', () => {
    const { fs, store } = makeStore({
      'features/s/.config.json': SET_CONFIG,
      'features/s/crlf.feature': 'Feature: C\r\n  Prose.\r\n',
    });
    assert.deepStrictEqual(store.moveFeature('s', 'crlf', 'done'), { ok: true });
    const after = required(fs.readFile('features/s/crlf.feature'), 'crlf file');
    assert.strictEqual(after, '@status:done\r\nFeature: C\r\n  Prose.\r\n');
    assert.strictEqual(required(store.getFeature('s', 'crlf'), 'crlf record').status, 'done');
  });

  test('given a set whose config is missing, when listed, then it still appears with its feature count', () => {
    const { store } = makeStore({
      'features/s/a.feature': 'Feature: A\n',
      'features/s/b.feature': 'Feature: B\n',
    });
    assert.deepStrictEqual(store.listFeatureSets(), [{ id: 's', name: 'S', featureCount: 2 }]);
  });
});
