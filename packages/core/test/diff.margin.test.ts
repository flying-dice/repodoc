/**
 * Fence and code ownership is measured from the **container's content margin**,
 * not from the leading indentation of the line that opens the block.
 *
 * A list marker shifts the margin: in `- example` the item's content starts at
 * column two, so a fence at column four is a nested fence, not a document one.
 * Gating on the marker's own indent rejected it, `inFence` stayed false, and
 * the string literal inside was collapsed as prose.
 */

import { describe, test } from 'bun:test';
import * as assert from 'node:assert';
import { diffMarkdown, hasMarkdownChanges, splitBlocks } from '../src/diff';

function counts(before: string, after: string): { added: number; removed: number } {
  const blocks = diffMarkdown(before, after);
  return {
    added: blocks.filter((b) => b.op === 'add').length,
    removed: blocks.filter((b) => b.op === 'del').length,
  };
}

/** Both sides of a literal-space edit inside a fence owned by a list item. */
function literalEdit(before: string): [string, string] {
  return [before, before.replace('"a b"', '"a  b"')];
}

describe('diff — fence depth from the content margin', () => {
  test('given a bullet with a four-column fence, then the literal is preserved', () => {
    const [before, after] = literalEdit('- example\n\n    ```js\n  const s = "a b";\n    ```\n');
    assert.strictEqual(hasMarkdownChanges(before, after), true);
    assert.deepStrictEqual(counts(before, after), { added: 1, removed: 1 });
  });

  test('given a bullet with a tab fence and a two-column body, then it is preserved', () => {
    const [before, after] = literalEdit('- example\n\n\t```js\n  const s = "a b";\n\t```\n');
    assert.strictEqual(hasMarkdownChanges(before, after), true);
    assert.deepStrictEqual(counts(before, after), { added: 1, removed: 1 });
  });

  test('given an ordered item with a four-column fence, then it is preserved', () => {
    const [before, after] = literalEdit('1. example\n\n    ```js\n   const s = "a b";\n    ```\n');
    assert.strictEqual(hasMarkdownChanges(before, after), true);
    assert.deepStrictEqual(counts(before, after), { added: 1, removed: 1 });
  });

  test('given an indented bullet with a six-column fence, then it is preserved', () => {
    const [before, after] = literalEdit(
      '  - example\n\n      ```js\n    const s = "a b";\n      ```\n',
    );
    assert.strictEqual(hasMarkdownChanges(before, after), true);
    assert.deepStrictEqual(counts(before, after), { added: 1, removed: 1 });
  });

  test('given a two-column fence under a bullet, then it still works', () => {
    const [before, after] = literalEdit('- example\n\n  ```js\n  const s = "a b";\n  ```\n');
    assert.strictEqual(hasMarkdownChanges(before, after), true);
  });

  test('given a three-column document fence, then it still opens', () => {
    const [before, after] = literalEdit('   ```js\n   const s = "a b";\n   ```\n');
    assert.strictEqual(hasMarkdownChanges(before, after), true);
  });
});

describe('diff — top-level indented backticks stay indented code', () => {
  const doc = (dest: string) =>
    `Read [manual][guide].\n\n    \`\`\`\n    literal ticks\n    \`\`\`\n\n[guide]: https://example.invalid/${dest}\n`;

  test('given literal backticks in indented code, then they do not open a fence', () => {
    const blocks = splitBlocks(doc('old'));
    assert.strictEqual(
      blocks.some((b) => b.kind === 'fence'),
      false,
      'four-space backticks are code content, not a document fence',
    );
  });

  test('given a destination-only edit past indented backticks, then refs survive', () => {
    const blocks = diffMarkdown(doc('old'), doc('new'));
    const changed = blocks.filter((b) => b.op !== 'same');
    assert.strictEqual(changed.length, 2, 'only the definition moved');
    for (const block of changed) {
      assert.ok(
        block.block.text.includes('example.invalid'),
        `the false fence swallowed later blocks again: ${block.block.text}`,
      );
    }
  });

  test('given a tab-indented literal backtick block, then it is not a fence', () => {
    const blocks = splitBlocks('\t```\n\tliteral\n\t```\n');
    assert.strictEqual(
      blocks.some((b) => b.kind === 'fence'),
      false,
    );
  });
});
