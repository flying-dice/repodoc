/**
 * Ownership: which container a fence, an indented literal or a line of code
 * belongs to.
 *
 * Every case here failed at some point in RepoDoc's own markdown classifier,
 * each one a margin, fence or continuation rule disagreeing with the real
 * parser about what owned a line. They are kept verbatim now that the parser
 * answers the question, because the point of the rewrite is that these inputs
 * stay fixed.
 */

import { describe, test } from 'bun:test';
import * as assert from 'node:assert';
import { diffMarkdown, hasMarkdownChanges } from '../src/diff';
import { counts, projection, render } from './diffHelpers';

/** Both sides of a literal-space edit inside code owned by a list item. */
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
  const doc = (dest: string): string =>
    `Read [manual][guide].\n\n    \`\`\`\n    literal ticks\n    \`\`\`\n\n[guide]: https://example.invalid/${dest}\n`;

  test('given literal backticks in indented code, then they do not open a fence', () => {
    assert.ok(
      render(doc('old')).includes('literal ticks'),
      'four-space backticks are code content, not a document fence',
    );
    const [before, after] = [doc('old'), doc('old').replace('literal ticks', 'literal  ticks')];
    assert.strictEqual(hasMarkdownChanges(before, after), true);
  });

  test('given a destination-only edit past indented backticks, then refs survive', () => {
    const diff = diffMarkdown(doc('old'), doc('new'));
    assert.deepStrictEqual(
      [diff.definitions.removed.length, diff.definitions.added.length],
      [1, 1],
      'the definition change is reported even though it renders to nothing',
    );
    assert.strictEqual(
      diff.runs.every(
        (run) => run.op === 'same' || run.tokens.every((t) => !t.raw.includes('```')),
      ),
      true,
      'the false fence swallowed later blocks again',
    );
    assert.strictEqual(projection(doc('old'), doc('new'), 'old'), render(doc('old')));
  });

  test('given a tab-indented literal backtick block, then it is not a fence', () => {
    const before = '\t```\n\tliteral "a b"\n\t```\n';
    const [b, a] = literalEdit(before);
    assert.strictEqual(hasMarkdownChanges(b, a), true);
    assert.ok(render(before).includes('```'), 'the ticks are content, so they are still visible');
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

describe('diff — a paragraph continuation is not a return to the parent', () => {
  test('given a lazy continuation under a child item, then the child still owns its fence', () => {
    const [before, after] = literalEdit(
      '- outer\n\n  - inner\n  continued\n\n      ```js\n    const s = "a b";\n      ```\n',
    );
    assert.strictEqual(
      hasMarkdownChanges(before, after),
      true,
      'an unindented continuation is still the child’s paragraph, not the parent’s',
    );
    assert.deepStrictEqual(counts(before, after), { added: 1, removed: 1 });
  });

  test('given a tab-indented fence after a lazy continuation, then its body is still code', () => {
    const [before, after] = literalEdit(
      '- outer\n\n  - inner\n  continued\n\n\t```js\n\tconst s = "a b";\n\t```\n',
    );
    assert.strictEqual(hasMarkdownChanges(before, after), true);
    assert.deepStrictEqual(counts(before, after), { added: 1, removed: 1 });
  });

  test('given a lazy continuation three levels deep, then the innermost item keeps its fence', () => {
    const [before, after] = literalEdit(
      '- outer\n\n  - inner\n\n    - deepest\n    continued\n\n        ```js\n      const s = "a b";\n        ```\n',
    );
    assert.strictEqual(hasMarkdownChanges(before, after), true);
    assert.deepStrictEqual(counts(before, after), { added: 1, removed: 1 });
  });

  test('given a blank line before the outdented line, then the parent context is restored', () => {
    const [before, after] = literalEdit(
      '- outer\n\n  - inner\n\n  back to outer\n\n      const s = "a b";\n',
    );
    assert.strictEqual(
      hasMarkdownChanges(before, after),
      true,
      'the blank line ends the child’s paragraph, so this one is a genuine return',
    );
    assert.deepStrictEqual(counts(before, after), { added: 1, removed: 1 });
  });
});

describe('diff — structure the hand-written classifier never saw', () => {
  test('given a heading inside a child item, then the parent still owns its code', () => {
    const [before, after] = literalEdit(
      '- outer\n\n  - inner\n    # Inner heading\n\n  Parent prose.\n\n      const s = "a b";\n',
    );
    assert.strictEqual(hasMarkdownChanges(before, after), true);
    assert.deepStrictEqual(counts(before, after), { added: 1, removed: 1 });
    assert.strictEqual(projection(before, after, 'old'), render(before));
    assert.strictEqual(projection(before, after, 'new'), render(after));
  });

  test('given a horizontal rule between list-owned code, then the code is still code', () => {
    const [before, after] = literalEdit('- outer\n\n  ---\n\n      const s = "a b";\n');
    assert.strictEqual(hasMarkdownChanges(before, after), true);
    assert.strictEqual(projection(before, after, 'new'), render(after));
  });

  test('given a setext heading above indented code, then the code is still code', () => {
    const [before, after] = literalEdit('Title\n=====\n\n    const s = "a b";\n');
    assert.strictEqual(hasMarkdownChanges(before, after), true);
    assert.deepStrictEqual(counts(before, after), { added: 1, removed: 1 });
  });

  test('given a blockquote holding a fence, then its literal is preserved', () => {
    const [before, after] = literalEdit('> quote\n>\n> ```js\n> const s = "a b";\n> ```\n');
    assert.strictEqual(hasMarkdownChanges(before, after), true);
    assert.strictEqual(projection(before, after, 'old'), render(before));
  });

  test('given a table cell respaced, then the rendering decides', () => {
    const before = '| a | b |\n| --- | --- |\n| 1 | 2 |\n';
    const after = '| a  |  b |\n| --- | --- |\n| 1 | 2 |\n';
    assert.strictEqual(render(before), render(after), 'the reader sees the same table');
    assert.strictEqual(hasMarkdownChanges(before, after), false);
  });
});
