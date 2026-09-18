/**
 * Two list defects the first fix left behind, each reproduced through the
 * renderer rather than by inspecting source fragments — the complaint was that
 * the *rendered document structure* changes, which a source assertion misses.
 */

import { describe, test } from 'bun:test';
import * as assert from 'node:assert';
import { diffMarkdown, groupRuns, runSource, splitBlocks } from '../src/diff';

/** Each run's source, in order, as the renderer receives it. */
function runs(before: string, after: string): string[] {
  return groupRuns(diffMarkdown(before, after)).map((run) => runSource(run));
}

describe('diff — lazy list continuations', () => {
  const before = '- alpha\ncontinued\n- omega\n';
  const after = '- ALPHA\ncontinued\n- omega\n';

  test('given a lazy continuation, when split, then it stays with its item', () => {
    const blocks = splitBlocks(before);
    const first = blocks.find((b) => b.text.startsWith('- alpha'));
    assert.ok(
      first?.text.includes('continued'),
      `the continuation was detached:\n${blocks.map((b) => `[${b.kind}] ${b.text}`).join('\n')}`,
    );
  });

  test('given the first line edited, when diffed, then the continuation moves with it', () => {
    const out = runs(before, after);
    const removed = out.find((r) => r.includes('- alpha'));
    const added = out.find((r) => r.includes('- ALPHA'));
    assert.ok(
      removed?.includes('continued'),
      `old item lost its continuation:\n${out.join('\n--\n')}`,
    );
    assert.ok(
      added?.includes('continued'),
      `new item lost its continuation:\n${out.join('\n--\n')}`,
    );
    assert.strictEqual(
      out.some((r) => r.trim() === 'continued'),
      false,
      'the continuation must never become a paragraph of its own outside the list',
    );
  });

  test('given a blank line then unindented prose, then it is NOT a continuation', () => {
    const blocks = splitBlocks('- alpha\n\nA new paragraph.\n');
    assert.ok(blocks.some((b) => b.kind === 'prose' && b.text.includes('A new paragraph')));
  });

  test('given a lazy continuation before a new item, then the item still starts', () => {
    const blocks = splitBlocks(before).filter((b) => b.kind === 'listItem');
    assert.strictEqual(blocks.length, 2, 'omega is its own item');
  });
});

describe('diff — ordered list identity', () => {
  const before = '1. alpha\n2. beta\n\n5) gamma\n6) delta\n';
  const after = '1. ALPHA\n2. beta\n\n5) gamma\n6) delta\n';

  test('given two lists with different delimiters, when split, then they are separate', () => {
    const items = splitBlocks(before).filter((b) => b.kind === 'listItem');
    assert.deepStrictEqual(
      items.map((b) => b.ordinal),
      [1, 2, 5, 6],
      'a ) list is not a continuation of a . list, so its numbering starts again at five',
    );
  });

  test('given an edit in the first list, when diffed, then the second keeps its start', () => {
    const out = runs(before, after).join('\n---\n');
    assert.ok(out.includes('5) gamma'), `the untouched list was renumbered:\n${out}`);
    assert.strictEqual(
      out.includes('3) gamma'),
      false,
      'editing one list must not renumber a different one',
    );
  });

  test('given a paren list alone, when split, then its start is kept', () => {
    const items = splitBlocks('5) gamma\n6) delta\n').filter((b) => b.kind === 'listItem');
    assert.deepStrictEqual(
      items.map((b) => b.ordinal),
      [5, 6],
    );
  });
});
