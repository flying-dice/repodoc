/**
 * `sanitizeMetaPatch` — the gate between an untrusted webview payload and a
 * card's frontmatter. Every value that survives it is written to disk, so the
 * tests below are adversarial by nature: wrong types, forged keys, newlines.
 */

import { describe, test } from 'bun:test';
import * as assert from 'node:assert';
import { sanitizeMetaPatch } from '../../src/panels/metaPatch';

describe('sanitizeMetaPatch', () => {
  test('given an empty or junk payload, when narrowed, then nothing usable survives', () => {
    assert.strictEqual(sanitizeMetaPatch({}), undefined);
    assert.strictEqual(sanitizeMetaPatch({ nope: 'x', column: 'done' }), undefined);
    assert.strictEqual(sanitizeMetaPatch({ title: '   ' }), undefined);
    assert.strictEqual(sanitizeMetaPatch({ priority: 'urgent' }), undefined);
    assert.strictEqual(sanitizeMetaPatch({ progress: Number.NaN }), undefined);
    assert.strictEqual(sanitizeMetaPatch({ live: 'yes' }), undefined);
  });

  test('given a full valid payload, when narrowed, then every key is carried through', () => {
    assert.deepStrictEqual(
      sanitizeMetaPatch({
        title: 'Ship it',
        labels: ['a', 'b'],
        priority: 'high',
        agent: 'dana',
        status: 'editing src/x.ts',
        live: true,
        progress: 62,
      }),
      {
        title: 'Ship it',
        labels: ['a', 'b'],
        priority: 'high',
        agent: 'dana',
        status: 'editing src/x.ts',
        live: true,
        progress: 62,
      },
    );
  });

  test('given newlines in strings, when narrowed, then each value is flattened to one line', () => {
    // Frontmatter is one `key: value` per line: an unflattened newline in a
    // title or label could forge a second key.
    const patch = sanitizeMetaPatch({
      title: '  Ship\nit  ',
      labels: ['a\nb', ' c '],
      agent: 'da\r\nna',
    });
    assert.strictEqual(patch?.title, 'Ship it');
    assert.deepStrictEqual(patch?.labels, ['a b', 'c']);
    assert.strictEqual(patch?.agent, 'da  na');
  });

  test('given null, when narrowed, then the key is kept as a removal', () => {
    assert.deepStrictEqual(
      sanitizeMetaPatch({
        labels: null,
        priority: null,
        agent: null,
        status: null,
        live: null,
        progress: null,
      }),
      {
        labels: null,
        priority: null,
        agent: null,
        status: null,
        live: null,
        progress: null,
      },
    );
  });

  test('given an empty string for agent or status, when narrowed, then it becomes a removal', () => {
    assert.deepStrictEqual(sanitizeMetaPatch({ agent: '   ' }), { agent: null });
    assert.deepStrictEqual(sanitizeMetaPatch({ status: '' }), { status: null });
  });

  test('given a labels array with a non-string, when narrowed, then the whole key is dropped', () => {
    assert.strictEqual(sanitizeMetaPatch({ labels: ['a', 2] }), undefined);
    assert.strictEqual(sanitizeMetaPatch({ labels: 'a,b' }), undefined);
    assert.deepStrictEqual(sanitizeMetaPatch({ labels: [] }), { labels: [] });
  });

  test('given an empty labels array, when narrowed, then it survives as "remove every label"', () => {
    // `[]` is not "nothing usable": it is the webview clearing the last label,
    // and it must reach the store as an empty array (which writes `labels: []`),
    // distinct from `null`, which removes the key altogether.
    const patch = sanitizeMetaPatch({ labels: [] });
    assert.deepStrictEqual(patch, { labels: [] });
    assert.notStrictEqual(patch?.labels, null, 'an empty array is not a removal');
    assert.deepStrictEqual(sanitizeMetaPatch({ labels: [], title: 'Keep' }), {
      labels: [],
      title: 'Keep',
    });
  });

  test('given progress out of range or fractional, when narrowed, then it is clamped and rounded', () => {
    assert.strictEqual(sanitizeMetaPatch({ progress: 150 })?.progress, 100);
    assert.strictEqual(sanitizeMetaPatch({ progress: -5 })?.progress, 0);
    assert.strictEqual(sanitizeMetaPatch({ progress: 61.6 })?.progress, 62);
    assert.strictEqual(sanitizeMetaPatch({ progress: Number.POSITIVE_INFINITY }), undefined);
  });

  test('given a title that is only a newline, when narrowed, then the patch is undefined', () => {
    assert.strictEqual(sanitizeMetaPatch({ title: '\n' }), undefined);
  });
});
