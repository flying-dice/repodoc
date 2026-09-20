/**
 * The comparison key must be injective: two different documents may not share
 * one key.
 *
 * The first version of the parser-backed comparison built keys by joining
 * fields with `|`. Joining is not injective — an info string of `text|a` over
 * a payload of `b` produces the same string as `text` over `a|b` — so a code
 * change read as no change at all. Changing the separator would only move the
 * collision somewhere quieter; the encoding has to be one the data cannot
 * forge from the inside.
 *
 * Also here: prose whitespace. Collapsing runs is right, and trimming every
 * text token is not — the space in `Hello **world**` is a word boundary the
 * parser leaves at the end of a text token.
 */

import { describe, test } from 'bun:test';
import * as assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { comparisonKey, hasMarkdownChanges, lexMarkdown } from '../src/diff';
import { counts, render } from './diffHelpers';
import { required } from './helpers';

/** Both sides of a change, asserted end to end rather than on the key alone. */
function assertChanged(before: string, after: string, why: string): void {
  assert.notStrictEqual(render(before), render(after), 'the fixture must actually differ');
  assert.strictEqual(hasMarkdownChanges(before, after), true, why);
  const { added, removed } = counts(before, after);
  assert.ok(added > 0 && removed > 0, `reported ${removed} removed / ${added} added: ${why}`);
}

describe('diff — keys cannot be forged from inside a field', () => {
  test('given an info string holding a separator, then the payload is still compared', () => {
    assertChanged(
      '```text|a\nb\n```',
      '```text\na|b\n```',
      'a code payload moved into the info string and the change vanished',
    );
  });

  test('given a link destination holding a separator, then the target is still compared', () => {
    assertChanged(
      '[text](https://example.invalid/a "b|c")',
      '[text](https://example.invalid/a|b "c")',
      'a link target moved into the title and the change vanished',
    );
  });

  test('given a payload spelling another token, then it is not that token', () => {
    const keyOfFirst = (source: string): string =>
      comparisonKey(required(lexMarkdown(source).tokens[0], 'first block'));
    assert.notStrictEqual(
      keyOfFirst('```\n["hr"]\n```\n'),
      keyOfFirst('---\n'),
      'a code block whose text spells a key must not compare equal to what it spells',
    );
  });

  test('given an image title and destination swapped around, then they differ', () => {
    assertChanged(
      '![a](x.png "t|u")',
      '![a](x.png|t "u")',
      'an image target moved into the title and the change vanished',
    );
  });
});

describe('diff — word boundaries survive whitespace collapsing', () => {
  test('given a separator removed before emphasis, then it is a change', () => {
    assertChanged(
      'Hello **world**',
      'Hello**world**',
      'the space before emphasis is a word boundary, not decoration',
    );
  });

  test('given a separator removed before a link, then it is a change', () => {
    assertChanged(
      'See [the guide](https://example.invalid/a)',
      'See[the guide](https://example.invalid/a)',
      'the space before a link is a word boundary',
    );
  });

  test('given a separator removed after emphasis, then it is a change', () => {
    assertChanged('**Hello** world', '**Hello**world', 'the space after emphasis is a boundary');
  });

  test('given a separator removed between two inline spans, then it is a change', () => {
    assertChanged('`a` `b`', '`a``b`', 'two code spans running together are not the same text');
  });

  test('given a widened separator, then it is still not a change', () => {
    assert.strictEqual(
      hasMarkdownChanges('Hello **world**', 'Hello   **world**'),
      false,
      'one space or three, a reader sees the same sentence',
    );
  });

  test('given whitespace at the edges of a paragraph, then it is not a change', () => {
    assert.strictEqual(hasMarkdownChanges('  hello world  \n', 'hello world\n'), false);
  });

  test('given a paragraph reflowed, then it is still not a change', () => {
    assert.strictEqual(hasMarkdownChanges('one two three\n', 'one two\nthree\n'), false);
  });
});

describe('diff — the document key is a structure too', () => {
  test('given a definition label holding a separator, then it is still compared', () => {
    const before = 'prose\n\n[a]: https://example.invalid/x\n\n[b|c]: https://example.invalid/y\n';
    const after = 'prose\n\n[a|b]: https://example.invalid/x\n\n[c]: https://example.invalid/y\n';
    assert.strictEqual(
      hasMarkdownChanges(before, after),
      true,
      'definition fields joined into one string can be forged from inside a label',
    );
  });

  test('given source with no control characters, then the keys carry none either', () => {
    // The joins used a NUL as a separator, which put a literal control
    // character in the source file — GitHub then refused to diff it. Nothing
    // needs one: the key is JSON.
    const source = readFileSync(new URL('../src/diff.ts', import.meta.url), 'utf8');
    const control = [...source].filter((c) => c < ' ' && c !== '\n' && c !== '\t');
    assert.deepStrictEqual(control, []);
  });
});
