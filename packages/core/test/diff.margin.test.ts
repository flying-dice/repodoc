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

describe('diff — ownership follows the nesting, not the outer block', () => {
  test('given a fence owned by a child list item, then its literal is preserved', () => {
    const [before, after] = literalEdit(
      '- outer\n\n  - inner\n\n      ```js\n    const s = "a b";\n      ```\n',
    );
    assert.strictEqual(hasMarkdownChanges(before, after), true);
    assert.deepStrictEqual(counts(before, after), { added: 1, removed: 1 });
  });

  test('given a mixed-tab fence owned by a child item, then its literal is preserved', () => {
    const [before, after] = literalEdit(
      '- outer\n\n  - inner\n\n\t  ```js\n\tconst s = "a b";\n\t  ```\n',
    );
    assert.strictEqual(hasMarkdownChanges(before, after), true);
    assert.deepStrictEqual(counts(before, after), { added: 1, removed: 1 });
  });

  test('given three levels of nesting, then the innermost fence still owns its code', () => {
    const [before, after] = literalEdit(
      '- a\n\n  - b\n\n    - c\n\n        ```js\n      const s = "a b";\n        ```\n',
    );
    assert.strictEqual(hasMarkdownChanges(before, after), true);
  });
});

describe('diff — indented code that looks like a list', () => {
  test('given four-space indented YAML, then its literal is preserved', () => {
    const before = '    - name: "a b"\n';
    const after = '    - name: "a  b"\n';
    assert.strictEqual(
      hasMarkdownChanges(before, after),
      true,
      'four columns in, this is a code block whatever its first character is',
    );
    assert.deepStrictEqual(counts(before, after), { added: 1, removed: 1 });
  });

  test('given tab-indented YAML, then its literal is preserved', () => {
    const before = '\t- name: "a b"\n';
    const after = '\t- name: "a  b"\n';
    assert.strictEqual(hasMarkdownChanges(before, after), true);
    assert.deepStrictEqual(counts(before, after), { added: 1, removed: 1 });
  });

  test('given indented code starting with an ordered marker, then it is preserved', () => {
    const before = '    1. step "a b"\n';
    const after = '    1. step "a  b"\n';
    assert.strictEqual(hasMarkdownChanges(before, after), true);
  });

  test('given an ordinary list item respaced, then it is still not a change', () => {
    assert.strictEqual(
      hasMarkdownChanges('- name: "a b"\n', '- name: "a  b"\n'),
      false,
      'a real list item is prose; respacing it must stay a non-change',
    );
  });
});

describe('diff — ownership when code resembles a list, and on the way back out', () => {
  test('given list-owned indented code starting with a marker, then it is code', () => {
    const [before, after] = literalEdit('- outer\n\n      - name: "a b"\n');
    assert.strictEqual(
      hasMarkdownChanges(before, after),
      true,
      'indented four past the item margin, a leading dash is code content, not a new list',
    );
    assert.deepStrictEqual(counts(before, after), { added: 1, removed: 1 });
  });

  test('given the same with a tab indent, then it is code', () => {
    const [before, after] = literalEdit('- outer\n\n\t  - name: "a b"\n');
    assert.strictEqual(hasMarkdownChanges(before, after), true);
    assert.deepStrictEqual(counts(before, after), { added: 1, removed: 1 });
  });

  test('given list-owned indented code starting with a number, then it is code', () => {
    const [before, after] = literalEdit('- outer\n\n      1. step "a b"\n');
    assert.strictEqual(hasMarkdownChanges(before, after), true);
  });

  test('given a return to the parent after a child list, then the parent margin is restored', () => {
    const [before, after] = literalEdit(
      '- outer\n\n  - inner\n\n  back to outer\n\n      const s = "a b";\n',
    );
    assert.strictEqual(
      hasMarkdownChanges(before, after),
      true,
      'leaving a child list must not leave its deeper margin behind',
    );
    assert.deepStrictEqual(counts(before, after), { added: 1, removed: 1 });
  });

  test('given a return past two child levels, then the outermost margin is restored', () => {
    const [before, after] = literalEdit(
      '- outer\n\n  - inner\n\n    - deepest\n\n  back to outer\n\n      const s = "a b";\n',
    );
    assert.strictEqual(hasMarkdownChanges(before, after), true);
  });

  test('given a child list still in scope, then its own deeper code is still code', () => {
    const [before, after] = literalEdit('- outer\n\n  - inner\n\n        const s = "a b";\n');
    assert.strictEqual(
      hasMarkdownChanges(before, after),
      true,
      'popping on the way out must not pop while the child is still the container',
    );
  });
});
