/**
 * Ordered lists must keep the numbers the author wrote.
 *
 * `splitListItems` restarted its ordinal at 1 for every blank-line-separated
 * group, and `runSource` rewrote the source markers from that count. So a list
 * starting at 5 renumbered itself to 1, and a loose list — blank lines between
 * items — restarted at every group.
 */

import { describe, test } from 'bun:test';
import * as assert from 'node:assert';
import { diffMarkdown, groupRuns, runSource, splitBlocks } from '../src/diff';

/** The markers a document's blocks carry once split. */
function markers(source: string): string[] {
  return splitBlocks(source)
    .map((b) => /^\s*(\d+)[.)]/.exec(b.text)?.[1])
    .filter((m): m is string => m !== undefined);
}

/** Every run rejoined, as the renderer would receive it. */
function rendered(before: string, after: string): string {
  return groupRuns(diffMarkdown(before, after))
    .map((run) => runSource(run))
    .join('\n\n');
}

describe('diff — ordered list numbering', () => {
  test('given a list starting at five, when split, then the numbers are kept', () => {
    assert.deepStrictEqual(markers('5. five\n6. six\n7. seven\n'), ['5', '6', '7']);
  });

  test('given a list starting at zero, when split, then zero is kept', () => {
    assert.deepStrictEqual(markers('0. zero\n1. one\n'), ['0', '1']);
  });

  test('given a five-list with an edited middle item, when rendered, then numbering survives', () => {
    const before = '5. five\n6. six\n7. seven\n';
    const after = '5. five\n6. six changed\n7. seven\n';
    const out = rendered(before, after);
    assert.ok(out.includes('5. five'), `lost the start number:\n${out}`);
    assert.ok(out.includes('7. seven'), `lost the tail number:\n${out}`);
    assert.strictEqual(out.includes('1. five'), false, 'a 5/6/7 list must not become 1/2/3');
  });

  test('given a loose list split by a change, when rendered, then it does not restart', () => {
    const before = '1. one\n\n2. two\n\n3. three\n';
    const after = '1. one\n\n2. two changed\n\n3. three\n';
    const out = rendered(before, after);
    assert.ok(out.includes('3. three'), `the tail restarted:\n${out}`);
  });

  test('given an item inserted into a loose list, when rendered, then later numbers hold', () => {
    const before = '1. one\n\n2. three\n';
    const after = '1. one\n\n2. two\n\n3. three\n';
    const out = rendered(before, after);
    assert.ok(out.includes('3. three'), `insertion renumbered the tail:\n${out}`);
  });

  test('given a multi-paragraph item, when split, then the paragraphs stay with it', () => {
    const blocks = splitBlocks('1. first\n\n   still first\n\n2. second\n');
    const first = blocks.find((b) => b.text.startsWith('1.'));
    assert.ok(first?.text.includes('still first'), 'an indented paragraph belongs to its item');
  });

  test('given a fenced block inside an item, when split, then it stays with the item', () => {
    const source = '1. run this\n\n   ```sh\n   npm test\n   ```\n\n2. then this\n';
    const blocks = splitBlocks(source);
    const owner = blocks.find((b) => b.text.includes('npm test'));
    assert.ok(
      owner?.text.startsWith('1.'),
      `the fence was detached from its item:\n${blocks.map((b) => b.text).join('\n---\n')}`,
    );
  });
});
