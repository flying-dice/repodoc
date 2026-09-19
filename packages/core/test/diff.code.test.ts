/**
 * Code content must survive block matching wherever it sits.
 *
 * The first fix byte-preserved only top-level `fence` blocks. That left two
 * kinds of code still being normalised as prose: a standalone indented code
 * block, which is a `prose` block, and a fence nested inside a list item,
 * which is part of a `listItem`. Both lost indentation and literal spacing.
 */

import { describe, test } from 'bun:test';
import * as assert from 'node:assert';
import { diffMarkdown, hasMarkdownChanges, splitBlocks } from '../src/diff';

/** Added and removed block counts, so a "detected" claim is checked end to end. */
function counts(before: string, after: string): { added: number; removed: number } {
  const blocks = diffMarkdown(before, after);
  return {
    added: blocks.filter((b) => b.op === 'add').length,
    removed: blocks.filter((b) => b.op === 'del').length,
  };
}

describe('diff — code content, wherever it lives', () => {
  test('given an indented code block with a changed literal, then it is a change', () => {
    const before = '    const s = "a b";\n';
    const after = '    const s = "a  b";\n';
    assert.strictEqual(hasMarkdownChanges(before, after), true);
    assert.deepStrictEqual(counts(before, after), { added: 1, removed: 1 });
  });

  test('given indented code reindented after its first line, then it is a change', () => {
    const before = '    def f():\n        return 1\n';
    const after = '    def f():\n            return 1\n';
    assert.strictEqual(hasMarkdownChanges(before, after), true);
    assert.deepStrictEqual(counts(before, after), { added: 1, removed: 1 });
  });

  test('given a fence nested in a list item, then an indentation change is a change', () => {
    const before = '1. run it\n\n   ```python\n   if x:\n       audit()\n   ```\n';
    const after = '1. run it\n\n   ```python\n   if x:\n           audit()\n   ```\n';
    assert.strictEqual(hasMarkdownChanges(before, after), true);
    assert.deepStrictEqual(counts(before, after), { added: 1, removed: 1 });
  });

  test('given a YAML fence nested in a list item, then an indentation change is a change', () => {
    const before = '- config\n\n  ```yaml\n  root:\n    child: 1\n  ```\n';
    const after = '- config\n\n  ```yaml\n  root:\n      child: 1\n  ```\n';
    assert.strictEqual(hasMarkdownChanges(before, after), true);
  });

  test('given a literal space change inside a nested fence, then it is a change', () => {
    const before = '- code\n\n  ```js\n  const s = "a b";\n  ```\n';
    const after = '- code\n\n  ```js\n  const s = "a  b";\n  ```\n';
    assert.strictEqual(hasMarkdownChanges(before, after), true);
  });

  test('given prose reflowed around code, then the prose alone is not a change', () => {
    const before = 'one two three\n\n    code()\n';
    const after = 'one two\nthree\n\n    code()\n';
    assert.strictEqual(
      hasMarkdownChanges(before, after),
      false,
      'protecting code must not make prose reflow an edit',
    );
  });

  test('given prose inside a list item respaced, then it is not a change', () => {
    const before = '- alpha beta gamma\n';
    const after = '- alpha  beta gamma\n';
    assert.strictEqual(hasMarkdownChanges(before, after), false);
  });
});

describe('diff — code bytes survive key assembly', () => {
  test('given tab-indented code with a changed literal, then it is a change', () => {
    // A tab is an indentation column, not one character. Counting characters
    // made a tab-indented code block look like prose and normalised its string.
    const before = '\tconst s = "a b";\n';
    const after = '\tconst s = "a  b";\n';
    assert.strictEqual(hasMarkdownChanges(before, after), true);
    assert.deepStrictEqual(counts(before, after), { added: 1, removed: 1 });
  });

  test('given tab-indented code reindented, then it is a change', () => {
    const before = '\tdef f():\n\t\treturn 1\n';
    const after = '\tdef f():\n\t\t\treturn 1\n';
    assert.strictEqual(hasMarkdownChanges(before, after), true);
  });

  test('given a mixed tab and space indent, then code is still recognised', () => {
    const before = '  \tconst s = "a b";\n';
    const after = '  \tconst s = "a  b";\n';
    assert.strictEqual(hasMarkdownChanges(before, after), true);
  });

  test('given trailing spaces inside a fenced string, then they are preserved', () => {
    // Inside a multiline string literal the trailing spaces are the value.
    // Key assembly used to strip whitespace before every newline, which threw
    // them away after the code had been correctly preserved line by line.
    const before = '```python\ns = """alpha \nbeta"""\n```\n';
    const after = '```python\ns = """alpha  \nbeta"""\n```\n';
    assert.strictEqual(hasMarkdownChanges(before, after), true);
    assert.deepStrictEqual(counts(before, after), { added: 1, removed: 1 });
  });

  test('given trailing spaces inside indented code, then they are preserved', () => {
    const before = '    s = """alpha \n    beta"""\n';
    const after = '    s = """alpha  \n    beta"""\n';
    assert.strictEqual(hasMarkdownChanges(before, after), true);
  });

  test('given trailing spaces in a nested fence, then they are preserved', () => {
    const before = '- code\n\n  ```py\n  s = """a \n  b"""\n  ```\n';
    const after = '- code\n\n  ```py\n  s = """a  \n  b"""\n  ```\n';
    assert.strictEqual(hasMarkdownChanges(before, after), true);
  });

  test('given prose with trailing spaces removed, then it is still a hard-break change', () => {
    assert.strictEqual(hasMarkdownChanges('one  \ntwo\n', 'one\ntwo\n'), true);
  });
});

describe('diff — tabs under an indented parent', () => {
  test('given a tab fence under a space-indented item, then its literal is preserved', () => {
    const before = '  - x\n\t```\n\tconst s = "a b";\n\t```\n';
    const after = '  - x\n\t```\n\tconst s = "a  b";\n\t```\n';
    assert.strictEqual(hasMarkdownChanges(before, after), true);
    assert.deepStrictEqual(counts(before, after), { added: 1, removed: 1 });
  });

  test('given a tab-indented code line under a space-indented item, then it is preserved', () => {
    const before = '  - x\n\n\t\tconst s = "a b";\n';
    const after = '  - x\n\n\t\tconst s = "a  b";\n';
    assert.strictEqual(hasMarkdownChanges(before, after), true);
  });

  test('given a fence opened with a tab, then it is recognised as a fence', () => {
    const before = '\t```\n\tconst s = "a b";\n\t```\n';
    const after = '\t```\n\tconst s = "a  b";\n\t```\n';
    assert.strictEqual(hasMarkdownChanges(before, after), true);
  });
});

describe('diff — list nesting measured in columns', () => {
  test('given a tab-nested child under a space-indented parent, then it nests', () => {
    const items = splitBlocks('  - parent\n\t- child\n').filter((b) => b.kind === 'listItem');
    assert.strictEqual(
      items.length,
      1,
      'a tab is four columns, so the child is nested under the parent, not its sibling',
    );
    assert.ok(items[0]?.text.includes('child'));
  });

  test('given a space-nested child, then it still nests', () => {
    const items = splitBlocks('  - parent\n    - child\n').filter((b) => b.kind === 'listItem');
    assert.strictEqual(items.length, 1);
  });

  test('given a sibling at the same column, then it is a sibling', () => {
    const items = splitBlocks('  - parent\n  - sibling\n').filter((b) => b.kind === 'listItem');
    assert.strictEqual(items.length, 2);
  });

  test('given a tab-indented list with a tab-nested child, then it nests', () => {
    const items = splitBlocks('\t- parent\n\t\t- child\n').filter((b) => b.kind === 'listItem');
    assert.strictEqual(items.length, 1);
  });
});
