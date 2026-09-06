/**
 * Adversarial coverage for `boardConfig.ts` normalization (with an eye on the
 * column and gate `prompt` keys, which reach agents verbatim) and for the
 * pasteable references built by `refs.ts`.
 *
 * The board config is user-authored JSON, so every one of these inputs is
 * something a repository can genuinely contain.
 */

import { describe, test } from 'bun:test';
import * as assert from 'node:assert';
import { normalizeBoardConfig } from '../src/boardConfig';
import { formatRef } from '../src/refs';
import { required } from './helpers';

/** The first (only) column of a normalized config built from `columns`. */
function oneColumn(column: unknown): ReturnType<typeof normalizeBoardConfig>['columns'][number] {
  const config = normalizeBoardConfig({ columns: [column] }, 'board-id');
  return required(config.columns[0], 'normalized column');
}

describe('normalizeBoardConfig — prompts', () => {
  test('given a whitespace-only column prompt, when normalized, then the key is dropped entirely', () => {
    assert.strictEqual(oneColumn({ id: 'a', prompt: '   \n  ' }).prompt, undefined);
    assert.strictEqual(oneColumn({ id: 'a', prompt: '' }).prompt, undefined);
  });

  test('given a padded column prompt, when normalized, then it is kept verbatim (not trimmed)', () => {
    assert.strictEqual(oneColumn({ id: 'a', prompt: '  Ship it.  ' }).prompt, '  Ship it.  ');
  });

  test('given a multi-line column prompt, when normalized, then every line survives', () => {
    const prompt = 'Do this:\n\n1. read the card\n2. run the tests\n';
    assert.strictEqual(oneColumn({ id: 'a', prompt }).prompt, prompt);
  });

  test('given a non-string column prompt, when normalized, then it is dropped', () => {
    assert.strictEqual(oneColumn({ id: 'a', prompt: 42 }).prompt, undefined);
    assert.strictEqual(oneColumn({ id: 'a', prompt: ['x'] }).prompt, undefined);
    assert.strictEqual(oneColumn({ id: 'a', prompt: null }).prompt, undefined);
  });

  test('given gate prompts, when normalized, then blank ones are dropped and real ones are kept verbatim', () => {
    const column = oneColumn({
      id: 'a',
      enter: [
        { id: 'blank', script: 's', prompt: '   ' },
        { id: 'kept', field: 'f', prompt: ' Ask Dana. ' },
      ],
    });
    const gates = required(column.enter, 'enter gates');
    assert.strictEqual(required(gates[0], 'first gate').prompt, undefined);
    assert.strictEqual(required(gates[1], 'second gate').prompt, ' Ask Dana. ');
  });
});

describe('normalizeBoardConfig — columns, gates, fields, labels', () => {
  test('given garbage input, when normalized, then a named board with nothing in it comes back', () => {
    for (const input of [undefined, null, 42, 'nope', [1, 2]]) {
      const config = normalizeBoardConfig(input, 'my-board');
      assert.strictEqual(config.name, 'My Board');
      assert.deepStrictEqual(config.columns, []);
      assert.deepStrictEqual(config.labels, {});
      assert.deepStrictEqual(config.fields, []);
    }
  });

  test('given a blank name, when normalized, then it falls back to the title-cased id but a padded name is kept', () => {
    assert.strictEqual(normalizeBoardConfig({ name: '   ' }, 'my-board').name, 'My Board');
    assert.strictEqual(normalizeBoardConfig({ name: 42 }, 'my-board').name, 'My Board');
    assert.strictEqual(normalizeBoardConfig({ name: '  Kept  ' }, 'my-board').name, '  Kept  ');
  });

  test('given columns without a usable id, when normalized, then they are dropped', () => {
    const config = normalizeBoardConfig(
      { columns: [{ id: '' }, { name: 'no id' }, null, ['a'], 'x', { id: 'keep' }] },
      'b',
    );
    assert.deepStrictEqual(
      config.columns.map((c) => c.id),
      ['keep'],
    );
  });

  test('given a non-finite wip, when normalized, then the limit is dropped', () => {
    assert.strictEqual(oneColumn({ id: 'a', wip: Number.NaN }).wip, undefined);
    assert.strictEqual(oneColumn({ id: 'a', wip: '3' }).wip, undefined);
    assert.strictEqual(oneColumn({ id: 'a', wip: 0 }).wip, 0);
  });

  test('given a gate with neither script nor field, when normalized, then it is dropped', () => {
    assert.strictEqual(oneColumn({ id: 'a', enter: [{ id: 'g', label: 'G' }] }).enter, undefined);
  });

  test('given a gate with both script and field, when normalized, then script wins and field/check are dropped', () => {
    const gates = required(
      oneColumn({ id: 'a', exit: [{ id: 'g', script: 's', field: 'f', check: '= 1' }] }).exit,
      'exit gates',
    );
    assert.deepStrictEqual(gates, [{ id: 'g', script: 's' }]);
  });

  test('given a gate whose script is empty or whitespace, when normalized, then it is dropped', () => {
    // A gate that requires running nothing can never be satisfied by running
    // anything: it is a config error, not a rule (see defaultGatePrompt).
    assert.strictEqual(oneColumn({ id: 'a', enter: [{ id: 'g', script: '' }] }).enter, undefined);
    assert.strictEqual(oneColumn({ id: 'a', enter: [{ id: 'g', script: '  ' }] }).enter, undefined);
    assert.deepStrictEqual(
      required(oneColumn({ id: 'a', enter: [{ id: 'g', script: ' make ' }] }).enter, 'gates'),
      [{ id: 'g', script: ' make ' }],
      'a script with real content is kept verbatim',
    );
  });

  test('given two gates sharing an id in one list, when normalized, then only the first survives', () => {
    // Decision 6: hosts key a gate's rendered prompt by id, so the second gate's
    // instructions could never reach the reader anyway.
    const column = oneColumn({
      id: 'a',
      enter: [
        { id: 'dup', script: 'first' },
        { id: 'dup', script: 'second' },
        { id: 'other', field: 'f' },
      ],
    });
    assert.deepStrictEqual(required(column.enter, 'enter gates'), [
      { id: 'dup', script: 'first' },
      { id: 'other', field: 'f' },
    ]);
  });

  test('given the same gate id in enter and exit, when normalized, then both survive (different lists)', () => {
    const column = oneColumn({
      id: 'a',
      enter: [{ id: 'g', script: 's' }],
      exit: [{ id: 'g', script: 's' }],
    });
    assert.strictEqual(required(column.enter, 'enter')[0]?.id, 'g');
    assert.strictEqual(required(column.exit, 'exit')[0]?.id, 'g');
  });

  test('given an empty gate list, when normalized, then the key is omitted so configs round-trip', () => {
    const column = oneColumn({ id: 'a', enter: [], exit: 'nope' });
    assert.ok(!('enter' in column), 'an empty enter list must not be written back');
    assert.ok(!('exit' in column), 'a non-array exit must not be written back');
  });

  test('given fields that are reserved, duplicated or wrongly typed, when normalized, then they are dropped', () => {
    const config = normalizeBoardConfig(
      {
        fields: [
          { id: 'column', type: 'text' },
          { id: 'updatedAt', type: 'text' },
          { id: 'ok', type: 'text' },
          { id: 'ok', type: 'number' },
          { id: 'bad', type: 'colour' },
          { id: '', type: 'text' },
          { id: 'nope' },
          'x',
        ],
      },
      'b',
    );
    assert.deepStrictEqual(config.fields, [{ id: 'ok', type: 'text' }]);
  });

  test('given a select field, when normalized, then options are always an array of strings', () => {
    const config = normalizeBoardConfig(
      {
        fields: [
          { id: 'a', type: 'select' },
          { id: 'b', type: 'multiselect', options: ['x', 2, null, 'y'] },
        ],
      },
      'b',
    );
    assert.deepStrictEqual(config.fields, [
      { id: 'a', type: 'select', options: [] },
      { id: 'b', type: 'multiselect', options: ['x', 'y'] },
    ]);
  });

  test('given label entries that carry no strings, when normalized, then they are dropped', () => {
    const config = normalizeBoardConfig(
      {
        labels: {
          good: { name: 'good', color: '#fff' },
          nulled: null,
          listed: ['x'],
          primitive: 'x',
          empty: {},
          numbers: { name: 1 },
        },
      },
      'b',
    );
    assert.deepStrictEqual(Object.keys(config.labels), ['good']);
  });
});

describe('formatRef — adversarial', () => {
  test('given a title and path, then the ref is scope/id — title (path)', () => {
    assert.strictEqual(
      formatRef('repodoc', 'add-csv-export', 'Add CSV export', 'boards/repodoc/03-add.md'),
      'repodoc/add-csv-export — Add CSV export (boards/repodoc/03-add.md)',
    );
  });

  test('given no path, then the ref stops after the title', () => {
    assert.strictEqual(formatRef('s', 'id', 'Title'), 's/id — Title');
  });

  test('given a blank or padded title, then the id stands in and padding is trimmed', () => {
    assert.strictEqual(formatRef('s', 'id', '   '), 's/id — id');
    assert.strictEqual(formatRef('s', 'id', '  Title  '), 's/id — Title');
  });

  test('given a title that already contains an em dash, then it is kept verbatim', () => {
    assert.strictEqual(formatRef('s', 'id', 'A — B', 'p'), 's/id — A — B (p)');
  });
});
