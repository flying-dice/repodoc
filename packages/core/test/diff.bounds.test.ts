/**
 * The diff must not allocate or run without limit.
 *
 * Alignment is jsdiff's now, and a library does not make every workload cheap:
 * its table is still quadratic in the block counts, so the budget, the timeout
 * and the edit-length bound all stay. Each of them, when hit, means
 * *fine-grained comparison unavailable* — never *unchanged*. Reporting "no
 * changes" because a document was large would be worse than the allocation it
 * avoided.
 *
 * The limits are exercised through `DiffLimits` rather than by building a
 * document big enough to exhaust a host: a multi-second parse in the suite to
 * prove a three-line branch is a cost paid on every run forever. The default
 * limits themselves are asserted separately, and one document large enough to
 * matter still goes through the whole path.
 */

import { describe, test } from 'bun:test';
import * as assert from 'node:assert';
import {
  DIFF_BUDGET_CELLS,
  DIFF_TIMEOUT_MS,
  diffMarkdown,
  hasChanges,
  hasMarkdownChanges,
  lexMarkdown,
} from '../src/diff';
import { projection, render } from './diffHelpers';

/** A document of `n` distinct paragraphs. */
function doc(n: number, tag = 'a'): string {
  return Array.from({ length: n }, (_, i) => `para ${tag} ${i}`).join('\n\n');
}

/** Every token of one op, as source, in order. */
function sideOf(diff: ReturnType<typeof diffMarkdown>, op: 'add' | 'del'): string[] {
  return diff.runs.flatMap((run) => (run.op === op ? run.tokens.map((t) => t.raw) : []));
}

describe('diff — the default limits', () => {
  test('the budget is a bound on cells, not on documents anyone reads', () => {
    // Four million cells is two thousand blocks a side: far past any document
    // in a repository, and far short of an allocation that takes a host down.
    assert.strictEqual(DIFF_BUDGET_CELLS, 4_000_000);
    assert.ok(DIFF_TIMEOUT_MS > 0);
  });

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

  test('given a substantial document, when diffed, then it completes quickly', () => {
    const started = Date.now();
    const diff = diffMarkdown(doc(500, 'x'), `${doc(500, 'x')}\n\ntail`);
    const elapsed = Date.now() - started;
    assert.strictEqual(diff.coarse, false);
    assert.ok(elapsed < 4000, `took ${elapsed}ms on a document well inside the budget`);
  });
});

describe('diff — alignment refused', () => {
  const before = doc(6, 'x');
  const after = doc(6, 'y');

  test('given a document past the budget, when diffed, then it still reports the change', () => {
    const diff = diffMarkdown(before, after, { budgetCells: 4 });
    assert.strictEqual(diff.coarse, true, 'past the budget alignment is refused, not attempted');
    assert.ok(hasChanges(diff), 'refusing to align is not the same as claiming nothing changed');
    assert.ok(
      diff.runs.some((run) => run.op === 'del') && diff.runs.some((run) => run.op === 'add'),
      'the reader must still see the old content and the new',
    );
  });

  test('given an edit-length limit hit, when diffed, then it still reports the change', () => {
    const diff = diffMarkdown(before, after, { maxEditLength: 0 });
    assert.strictEqual(diff.coarse, true);
    assert.ok(hasChanges(diff));
  });

  test('given a refused alignment, when projected, then each side is still itself', () => {
    const diff = diffMarkdown(before, after, { budgetCells: 4 });
    assert.deepStrictEqual(
      sideOf(diff, 'del'),
      lexMarkdown(before).tokens.map((t) => t.raw),
    );
    assert.deepStrictEqual(
      sideOf(diff, 'add'),
      lexMarkdown(after).tokens.map((t) => t.raw),
    );
  });

  test('given identical documents, when alignment is refused, then they are equal', () => {
    const diff = diffMarkdown(before, before, { budgetCells: 4 });
    assert.strictEqual(hasChanges(diff), false, 'a refused alignment must not invent a change');
    assert.strictEqual(projection(before, before, 'old'), render(before));
  });

  test('given equality, when asked, then the budget is not consulted at all', () => {
    // `hasMarkdownChanges` takes no limits: it never aligns, so there is
    // nothing for a budget to refuse. Asserted on a document large enough for
    // a quadratic answer to show, and no larger — parsing one this size four
    // times is the cost of this test, on every run.
    const large = doc(400, 'x');
    const started = Date.now();
    assert.strictEqual(hasMarkdownChanges(large, large), false);
    assert.strictEqual(hasMarkdownChanges(large, `${large}\n\ntail`), true);
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 4000, `equality took ${elapsed}ms; it is meant to be one pass`);
  });
});
