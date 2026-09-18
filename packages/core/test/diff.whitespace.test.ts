/**
 * Whitespace that carries meaning must survive block matching.
 *
 * `blockKey` collapsed every run of whitespace, which is right for prose — a
 * reflowed paragraph is not an edit — and wrong for everything else. Indentation
 * *is* the code in Python and YAML, two spaces inside a string literal are part
 * of the string, and two spaces at the end of a markdown line are a hard break.
 *
 * The user-visible cost was worse than a missed highlight: `markdownPanel`
 * treats "git says the file changed, the body diff says it did not" as
 * `metadataOnly`, so a real body edit was reported as *metadata changed*.
 */

import { describe, test } from 'bun:test';
import * as assert from 'node:assert';
import { frontmatterChanged, hasMarkdownChanges } from '../src/diff';

describe('diff — whitespace that means something', () => {
  test('given a Python indentation change in a fence, when compared, then it is a change', () => {
    const before = '```python\ndef f():\n    if x:\n        return 1\n```\n';
    const after = '```python\ndef f():\n    if x:\n            return 1\n```\n';
    assert.strictEqual(
      hasMarkdownChanges(before, after),
      true,
      'indentation is the control flow; collapsing it hides the edit entirely',
    );
  });

  test('given a YAML indentation change in a fence, when compared, then it is a change', () => {
    const before = '```yaml\nroot:\n  child: 1\n```\n';
    const after = '```yaml\nroot:\n    child: 1\n```\n';
    assert.strictEqual(hasMarkdownChanges(before, after), true);
  });

  test('given a doubled space inside a code literal, when compared, then it is a change', () => {
    const before = '```js\nconst s = "a b";\n```\n';
    const after = '```js\nconst s = "a  b";\n```\n';
    assert.strictEqual(hasMarkdownChanges(before, after), true);
  });

  test('given a markdown hard break added, when compared, then it is a change', () => {
    // Two trailing spaces are a <br>, not decoration.
    assert.strictEqual(hasMarkdownChanges('one\ntwo\n', 'one  \ntwo\n'), true);
  });

  test('given a prose paragraph reflowed, when compared, then it is NOT a change', () => {
    assert.strictEqual(
      hasMarkdownChanges('one two three\n', 'one two\nthree\n'),
      false,
      'rewrapping prose is not an edit, and this must stay true',
    );
  });

  test('given prose spaced differently mid-line, when compared, then it is NOT a change', () => {
    assert.strictEqual(hasMarkdownChanges('one  two\n', 'one two\n'), false);
  });

  test('given a list item indented into a nested level, when compared, then it is a change', () => {
    const before = '- parent\n- child\n';
    const after = '- parent\n  - child\n';
    assert.strictEqual(
      hasMarkdownChanges(before, after),
      true,
      'leading indentation decides what owns the item',
    );
  });

  test('given an indented code block reindented, when compared, then it is a change', () => {
    assert.strictEqual(hasMarkdownChanges('    code()\n', '        code()\n'), true);
  });
});

describe('diff — the metadata-changed claim', () => {
  const withFm = (status: string, body: string) => `---\nstatus: ${status}\n---\n${body}`;

  test('given only frontmatter moved, when compared, then it is a frontmatter change', () => {
    assert.strictEqual(
      frontmatterChanged(withFm('Proposed', '# A\n'), withFm('Accepted', '# A\n')),
      true,
    );
  });

  test('given only the body moved, when compared, then it is NOT a frontmatter change', () => {
    assert.strictEqual(
      frontmatterChanged(withFm('Proposed', '# A\n'), withFm('Proposed', '# B\n')),
      false,
      'a prose edit must never be reported as a metadata change',
    );
  });

  test('given reordered frontmatter keys, when compared, then it is NOT a change', () => {
    assert.strictEqual(
      frontmatterChanged('---\na: 1\nb: 2\n---\nx\n', '---\nb: 2\na: 1\n---\nx\n'),
      false,
    );
  });

  test('given frontmatter added to a file that had none, when compared, then it is a change', () => {
    assert.strictEqual(frontmatterChanged('# A\n', withFm('Proposed', '# A\n')), true);
  });

  test('given neither revision has frontmatter, when compared, then it is not a change', () => {
    assert.strictEqual(frontmatterChanged('# A\n', '# B\n'), false);
  });
});
