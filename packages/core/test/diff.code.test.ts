/**
 * Code content must survive block matching wherever it sits.
 *
 * These reproductions predate the parser-backed comparison: each one was a
 * defect in RepoDoc's own markdown classifier, which decided from indentation
 * and regular expressions what the parser already knew. They are kept exactly
 * as they were — a rewrite that quietly dropped its predecessor's failing
 * inputs would be proving nothing.
 */

import { describe, test } from 'bun:test';
import * as assert from 'node:assert';
import { diffMarkdown, hasMarkdownChanges } from '../src/diff';
import { counts, projection, render } from './diffHelpers';

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

describe('diff — list nesting, as the parser reads it', () => {
  test('given a tab-nested child under a space-indented parent, then it nests', () => {
    // A tab is four columns, so the child belongs to the parent. Asserted
    // through the rendering rather than through a block split: what matters is
    // that the diff agrees with the document the reader sees.
    assert.ok(render('  - parent\n\t- child\n').includes('<ul>\n<li>parent<ul>'));
    assert.strictEqual(
      projection('  - parent\n\t- child\n', '  - parent\n\t- child\n', 'new'),
      render('  - parent\n\t- child\n'),
    );
  });

  test('given a child outdented to a sibling, then it is a change', () => {
    assert.strictEqual(hasMarkdownChanges('- parent\n  - child\n', '- parent\n- child\n'), true);
  });

  test('given a sibling at the same column, then respacing its prose is not a change', () => {
    assert.strictEqual(
      hasMarkdownChanges(
        '  - parent\n  - sibling\n',
        '  - parent\n  - sibling  text\n'.replace('  text', ''),
      ),
      false,
    );
  });
});

describe('diff — indented code is not a document fence', () => {
  test('given indented code starting with fence ticks, then its content is protected', () => {
    // Broadening the old fence pattern to any indent made `    ```…` open a
    // document fence, which then swallowed later blocks.
    const before = '    code before\n    ```not-a-fence\n    code "a b"\n';
    const after = before.replace('"a b"', '"a  b"');
    assert.strictEqual(hasMarkdownChanges(before, after), true);
    assert.deepStrictEqual(counts(before, after), { added: 1, removed: 1 });
  });

  test('given a destination-only ref edit beside indented fence ticks, then only the def changes', () => {
    const before =
      'See [doc][ref].\n\n    code before\n    ```not-a-fence\n    code after\n\n[ref]: https://example.invalid/old\n';
    const after = before.replace('/old', '/new');
    assert.strictEqual(hasMarkdownChanges(before, after), true);
    const diff = diffMarkdown(before, after);
    assert.deepStrictEqual(
      diff.definitions.removed.map((d) => d.href),
      ['https://example.invalid/old'],
    );
    assert.deepStrictEqual(
      diff.definitions.added.map((d) => d.href),
      ['https://example.invalid/new'],
    );
    // The definition itself, plus the paragraph whose link now points
    // somewhere else — that paragraph really does render differently.
    assert.deepStrictEqual(counts(before, after), { added: 2, removed: 2 });
    const changed = diff.runs.filter((run) => run.op !== 'same');
    assert.strictEqual(
      changed.every((run) => run.tokens.every((token) => token.raw.includes('[doc][ref]'))),
      true,
      'the indented code beside the definition did not move',
    );
  });

  test('given unchanged indented code with fence ticks, then nothing is marked changed', () => {
    const source = '    line1\n    ```not-a-fence\n    line3\n';
    assert.strictEqual(hasMarkdownChanges(source, source), false);
    assert.deepStrictEqual(counts(source, source), { added: 0, removed: 0 });
  });

  test('given a real fence at three columns, then it still opens', () => {
    const before = '   ```\nconst s = "a b";\n```\n';
    assert.ok(render(before).includes('<pre>'), 'three columns still opens a fence');
    assert.strictEqual(hasMarkdownChanges(before, before.replace('"a b"', '"a  b"')), true);
  });
});
