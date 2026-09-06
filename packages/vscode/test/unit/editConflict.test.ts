/**
 * The check behind "Changed on disk" for the description and title editors.
 * The bug it covers is a save silently overwriting text that arrived from the
 * file — from another agent, from the CLI, or from the human's own editor —
 * while the managed editor was open.
 */

import { describe, test } from 'bun:test';
import * as assert from 'node:assert';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { editBase, hasEditConflict } from '../../src/panels/editConflict';

describe('edit conflicts', () => {
  test('given an untouched value, when a save arrives over it, then there is no conflict', () => {
    assert.strictEqual(hasEditConflict('Original description.', 'Original description.'), false);
    assert.strictEqual(hasEditConflict('', ''), false, 'a card with no description saves fine');
  });

  test('given a value changed on disk, when a save arrives over the old one, then it conflicts', () => {
    assert.strictEqual(
      hasEditConflict('Original description.', 'External author description must survive'),
      true,
    );
    assert.strictEqual(hasEditConflict('', 'Written while you were typing'), true);
    assert.strictEqual(hasEditConflict('Was here', ''), true, 'a deletion is a change too');
  });

  test('given values that differ only in whitespace, when compared, then they still conflict', () => {
    assert.strictEqual(
      hasEditConflict('Prose.', 'Prose. '),
      true,
      'the host hands out the exact stored string, so any difference is someone else',
    );
    assert.strictEqual(hasEditConflict('a\nb', 'a\r\nb'), true);
  });

  test('given an inbound message, when its base is read, then only a string is accepted', () => {
    assert.strictEqual(editBase(''), '');
    assert.strictEqual(editBase('Original'), 'Original');
    assert.strictEqual(editBase(undefined), undefined, 'an old webview sends no base');
    assert.strictEqual(editBase(null), undefined);
    assert.strictEqual(editBase(42), undefined);
    assert.strictEqual(editBase({ base: 'Original' }), undefined);
  });

  /**
   * `media/board.js` mirrors the decision by hand (the webview has no build
   * step). This lifts the mirrored block out of the shipped file and holds it
   * to the same behaviour, so the two cannot drift apart silently.
   */
  test('given the webview mirror, when exercised, then it behaves the same', () => {
    const boardJs = path.join(__dirname, '..', '..', 'media', 'board.js');
    const source = readFileSync(boardJs, 'utf8');
    const start = source.indexOf(
      '  /* ---- Edit conflicts (mirrors src/panels/editConflict.ts) ---- */',
    );
    const end = source.indexOf('  /* ---- end of the edit-conflict mirror ---- */');
    assert.ok(start > 0 && end > start, 'the mirrored edit-conflict helper moved in board.js');
    const mirror = new Function(`${source.slice(start, end)}; return { hasEditConflict };`)() as {
      hasEditConflict: typeof hasEditConflict;
    };

    for (const [base, current] of [
      ['Original description.', 'Original description.'],
      ['Original description.', 'External author description must survive'],
      ['', ''],
      ['', 'Written while you were typing'],
      ['Prose.', 'Prose. '],
    ] as const) {
      assert.strictEqual(
        mirror.hasEditConflict(base, current),
        hasEditConflict(base, current),
        `the mirror disagrees on ${JSON.stringify([base, current])}`,
      );
    }
  });
});
