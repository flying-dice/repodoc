import { describe, test } from 'bun:test';
import * as assert from 'assert';
import { OrderEntry, computeCardOrder } from '../src/ordering';

/** Builds ordered entries from `slug:column` shorthand. */
function entries(...specs: string[]): OrderEntry[] {
  return specs.map((s) => {
    const [slug, column] = s.split(':');
    return { slug, column };
  });
}

describe('ordering.computeCardOrder — within a column', () => {
  const within = entries('c1:a', 'c2:a', 'c3:a');

  test('move to top (index 0)', () => {
    assert.deepStrictEqual(computeCardOrder(within, 'c3', 'a', 0), ['c3', 'c1', 'c2']);
  });

  test('move to the middle', () => {
    assert.deepStrictEqual(computeCardOrder(within, 'c1', 'a', 1), ['c2', 'c1', 'c3']);
  });

  test('move past the end appends to the column tail', () => {
    assert.deepStrictEqual(computeCardOrder(within, 'c1', 'a', 99), ['c2', 'c3', 'c1']);
  });
});

describe('ordering.computeCardOrder — across columns', () => {
  test('move into another column at index 0', () => {
    const e = entries('c1:a', 'c2:a', 'c3:b');
    assert.deepStrictEqual(computeCardOrder(e, 'c1', 'b', 0), ['c2', 'c1', 'c3']);
  });

  test('move into an empty column appends at the global end', () => {
    const e = entries('c1:a', 'c2:a');
    assert.deepStrictEqual(computeCardOrder(e, 'c1', 'b', 0), ['c2', 'c1']);
  });

  test('negative index clamps to the top of the target column', () => {
    const e = entries('c1:a', 'c2:b', 'c3:b');
    assert.deepStrictEqual(computeCardOrder(e, 'c1', 'b', -5), ['c1', 'c2', 'c3']);
  });

  test('index past the end lands right after the column tail', () => {
    const e = entries('c1:a', 'c2:b', 'c3:b');
    assert.deepStrictEqual(computeCardOrder(e, 'c1', 'b', 99), ['c2', 'c3', 'c1']);
  });

  test('the moved slug always appears exactly once', () => {
    const e = entries('c1:a', 'c2:a', 'c3:b', 'c4:b');
    const out = computeCardOrder(e, 'c2', 'b', 1);
    assert.strictEqual(out.filter((s) => s === 'c2').length, 1);
    assert.strictEqual(new Set(out).size, out.length);
    assert.strictEqual(out.length, 4);
  });
});
