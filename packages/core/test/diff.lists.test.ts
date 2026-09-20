/**
 * Ordered lists must keep the numbers the author wrote.
 *
 * The old splitter cut a list into items and rebuilt the markers when a run
 * rendered, so a list starting at five renumbered itself to one and a loose
 * list restarted at every blank line. Nothing is rebuilt now — a list is one
 * parsed block, rendered from its own tokens — so these cases are asserted
 * against the ordinary rendering, which is what the reader actually sees.
 */

import { describe, test } from 'bun:test';
import * as assert from 'node:assert';
import { hasMarkdownChanges } from '../src/diff';
import { projection, render } from './diffHelpers';

/** Both projections of a diff must reproduce their own side's rendering. */
function assertPreserved(before: string, after: string): void {
  assert.strictEqual(projection(before, after, 'old'), render(before), 'old side reinterpreted');
  assert.strictEqual(projection(before, after, 'new'), render(after), 'new side reinterpreted');
}

describe('diff — ordered list numbering', () => {
  test('given a list starting at five, when diffed, then the numbers are kept', () => {
    const before = '5. five\n6. six\n7. seven\n';
    const after = '5. five\n6. six changed\n7. seven\n';
    assert.ok(render(before).includes('start="5"'), 'the reading view starts the list at five');
    assertPreserved(before, after);
    assert.ok(projection(before, after, 'old').includes('start="5"'));
    assert.ok(projection(before, after, 'new').includes('start="5"'));
  });

  test('given a list starting at zero, when diffed, then zero is kept', () => {
    const before = '0. zero\n1. one\n';
    assertPreserved(before, before.replace('one', 'ONE'));
    assert.ok(projection(before, before.replace('one', 'ONE'), 'old').includes('start="0"'));
  });

  test('given a loose list split by a change, when rendered, then it does not restart', () => {
    const before = '1. one\n\n2. two\n\n3. three\n';
    const after = '1. one\n\n2. two changed\n\n3. three\n';
    assertPreserved(before, after);
    assert.ok(projection(before, after, 'new').includes('three'));
  });

  test('given an item inserted into a loose list, when rendered, then the list is intact', () => {
    const before = '1. one\n\n2. three\n';
    const after = '1. one\n\n2. two\n\n3. three\n';
    assertPreserved(before, after);
  });

  test('given a multi-paragraph item, then the paragraphs stay with it', () => {
    const before = '1. first\n\n   still first\n\n2. second\n';
    assertPreserved(before, before.replace('second', 'SECOND'));
  });

  test('given a fenced block inside an item, then it stays with the item', () => {
    const before = '1. run this\n\n   ```sh\n   npm test\n   ```\n\n2. then this\n';
    const after = before.replace('npm test', 'npm  test');
    assert.strictEqual(hasMarkdownChanges(before, after), true, 'the fence is code, not prose');
    assertPreserved(before, after);
  });

  test('given two lists with different delimiters, then editing one leaves the other alone', () => {
    const before = '1. alpha\n2. beta\n\n5) gamma\n6) delta\n';
    const after = '1. ALPHA\n2. beta\n\n5) gamma\n6) delta\n';
    assertPreserved(before, after);
    assert.ok(
      projection(before, after, 'new').includes('start="5"'),
      'editing one list must not renumber a different one',
    );
  });
});

describe('diff — lazy list continuations', () => {
  const before = '- alpha\ncontinued\n- omega\n';
  const after = '- ALPHA\ncontinued\n- omega\n';

  test('given a lazy continuation, then it stays inside its item', () => {
    assertPreserved(before, after);
    assert.ok(
      render(before).includes('alpha\ncontinued'),
      'the parser folds the continuation into the item; the diff must not undo that',
    );
  });

  test('given the first line edited, then the continuation moves with it', () => {
    const removed = projection(before, after, 'old');
    const added = projection(before, after, 'new');
    assert.ok(removed.includes('continued'), 'old item lost its continuation');
    assert.ok(added.includes('continued'), 'new item lost its continuation');
    assert.strictEqual(
      added.includes('<p>continued</p>'),
      false,
      'the continuation must never become a paragraph outside the list',
    );
  });

  test('given a blank line then unindented prose, then it is NOT a continuation', () => {
    const doc = '- alpha\n\nA new paragraph.\n';
    assertPreserved(doc, doc.replace('alpha', 'ALPHA'));
    assert.ok(render(doc).includes('<p>A new paragraph.</p>'));
  });
});
