/**
 * The diff must not allocate without limit.
 *
 * `lcs` builds an `Int32Array` of `(old + 1) * (new + 1)` cells synchronously on
 * the extension host. At ten thousand blocks a side that table alone is about
 * 400 MB, and nothing stopped it being asked for.
 *
 * The bound must never hide that a document changed — reporting "no changes"
 * because the document was large would be worse than the allocation.
 */

import { describe, test } from 'bun:test';
import * as assert from 'node:assert';
import { DIFF_BUDGET_CELLS, diffMarkdown, hasChanges, hasMarkdownChanges } from '../src/diff';

/** A document of `n` distinct paragraphs. */
function doc(n: number, tag = 'a'): string {
  return Array.from({ length: n }, (_, i) => `para ${tag} ${i}`).join('\n\n');
}

describe('diff — allocation budget', () => {
  test('given an ordinary document, when diffed, then it is aligned block by block', () => {
    const before = doc(50);
    const after = `${doc(50)}\n\nappended`;
    const blocks = diffMarkdown(before, after);
    assert.strictEqual(blocks.filter((b) => b.op === 'add').length, 1);
    assert.strictEqual(blocks.filter((b) => b.op === 'same').length, 50);
  });

  test('given a document past the budget, when diffed, then it still reports the change', () => {
    // Either side alone is under the limit; the product is what blows up.
    const side = Math.ceil(Math.sqrt(DIFF_BUDGET_CELLS)) + 50;
    const before = doc(side, 'x');
    const after = doc(side, 'y');

    const blocks = diffMarkdown(before, after);
    assert.ok(hasChanges(blocks), 'refusing to align is not the same as claiming nothing changed');
    assert.ok(
      blocks.some((b) => b.op === 'del') && blocks.some((b) => b.op === 'add'),
      'the reader must still see the old content and the new',
    );
  });

  test('given identical documents past the budget, when compared, then they are equal', () => {
    const side = Math.ceil(Math.sqrt(DIFF_BUDGET_CELLS)) + 50;
    const same = doc(side, 'x');
    assert.strictEqual(
      hasMarkdownChanges(same, same),
      false,
      'the equality check is linear and must not be affected by the budget',
    );
  });

  test('given a document past the budget, when diffed, then it completes quickly', () => {
    const side = Math.ceil(Math.sqrt(DIFF_BUDGET_CELLS)) + 200;
    const started = Date.now();
    diffMarkdown(doc(side, 'x'), doc(side, 'y'));
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 4000, `took ${elapsed}ms; the budget is meant to prevent exactly this`);
  });

  test('given a document just under the budget, when diffed, then alignment still happens', () => {
    const side = Math.floor(Math.sqrt(DIFF_BUDGET_CELLS)) - 10;
    const before = doc(side, 'x');
    const after = `${doc(side, 'x')}\n\ntail`;
    const blocks = diffMarkdown(before, after);
    assert.strictEqual(
      blocks.filter((b) => b.op === 'same').length,
      side,
      'under the budget nothing changes about how the diff behaves',
    );
  });
});
