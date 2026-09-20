/**
 * The diff must not allocate or run without limit.
 *
 * Alignment is jsdiff's now, and a library does not make every workload cheap:
 * its table is still quadratic in the block counts, so the budget and the
 * timeout both stay. jsdiff returns `undefined` when a limit is hit, which
 * means *fine-grained comparison unavailable* — never *unchanged*. Reporting
 * "no changes" because the document was large would be worse than the
 * allocation it avoided.
 */

import { describe, test } from 'bun:test';
import * as assert from 'node:assert';
import { DIFF_BUDGET_CELLS, diffMarkdown, hasChanges, hasMarkdownChanges } from '../src/diff';
import { projection, render } from './diffHelpers';

/** A document of `n` distinct paragraphs. */
function doc(n: number, tag = 'a'): string {
  return Array.from({ length: n }, (_, i) => `para ${tag} ${i}`).join('\n\n');
}

describe('diff — allocation budget', () => {
  test('given an ordinary document, when diffed, then it is aligned block by block', () => {
    const before = doc(50);
    const after = `${doc(50)}\n\nappended`;
    const diff = diffMarkdown(before, after);
    assert.strictEqual(diff.added, 1);
    assert.strictEqual(diff.coarse, false);
    assert.strictEqual(
      diff.runs.filter((run) => run.op === 'same').reduce((n, run) => n + run.tokens.length, 0),
      50,
    );
  });

  test('given a document past the budget, when diffed, then it still reports the change', () => {
    // Either side alone is under the limit; the product is what blows up.
    const side = Math.ceil(Math.sqrt(DIFF_BUDGET_CELLS)) + 50;
    const before = doc(side, 'x');
    const after = doc(side, 'y');

    const diff = diffMarkdown(before, after);
    assert.strictEqual(diff.coarse, true, 'past the budget alignment is refused, not attempted');
    assert.ok(hasChanges(diff), 'refusing to align is not the same as claiming nothing changed');
    assert.ok(
      diff.runs.some((run) => run.op === 'del') && diff.runs.some((run) => run.op === 'add'),
      'the reader must still see the old content and the new',
    );
    assert.strictEqual(projection(before, after, 'old'), render(before));
    assert.strictEqual(projection(before, after, 'new'), render(after));
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
    const diff = diffMarkdown(before, after);
    assert.strictEqual(
      diff.runs.filter((run) => run.op === 'same').reduce((n, run) => n + run.tokens.length, 0),
      side,
      'under the budget nothing changes about how the diff behaves',
    );
  });
});
