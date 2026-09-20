/**
 * Reference definitions may span lines. RepoDoc's own one-line pattern missed
 * them, so a document the ordinary renderer resolves correctly rendered as
 * literal `[manual][guide]` in a diff, with the destination change invisible.
 *
 * The parser resolves them now, against the whole document, so these cases are
 * asserted through the rendered diff rather than against a collector.
 */

import { describe, test } from 'bun:test';
import * as assert from 'node:assert';
import { diffMarkdown, lexMarkdown } from '@repodoc/core/diff';
import { renderMarkdownDiff } from '../../src/panels/diffView';

const NO_DIAGRAMS = { plantUmlServer: '' };

describe('reference definitions — spanning lines', () => {
  test('given a destination on the next line, when parsed, then it is complete', () => {
    const doc = lexMarkdown('Read [manual][guide].\n\n[guide]:\n  https://example.invalid/old\n');
    assert.deepStrictEqual(doc.definitions, [
      { label: 'guide', href: 'https://example.invalid/old', title: '' },
    ]);
  });

  test('given a title on a continuation line, when parsed, then it is included', () => {
    const doc = lexMarkdown('[guide]: https://example.invalid/a\n  "The guide"\n');
    assert.strictEqual(doc.definitions[0]?.title, 'The guide');
  });

  test('given a definition inside a fence, when parsed, then it is code', () => {
    assert.deepStrictEqual(
      lexMarkdown('```\n[guide]: https://example.invalid/x\n```\n').definitions,
      [],
    );
  });

  test('given a multiline definition alone, when diffed, then the change is reported', () => {
    const before = '[guide]:\n  https://example.invalid/old\n';
    const after = '[guide]:\n  https://example.invalid/new\n';
    const diff = diffMarkdown(before, after);
    assert.deepStrictEqual(
      [diff.definitions.removed.length, diff.definitions.added.length],
      [1, 1],
      'a document of nothing but definitions renders to nothing and must still report',
    );
  });

  test('given a multiline definition, when diffed, then the link still resolves', () => {
    const before = 'Read [manual][guide].\n\n[guide]:\n  https://example.invalid/old\n';
    const after = 'Read [manual][guide].\n\n[guide]:\n  https://example.invalid/new\n';
    const { html } = renderMarkdownDiff(before, after, NO_DIAGRAMS);
    assert.ok(
      html.includes('<a href="https://example.invalid/new">manual</a>'),
      `the link did not resolve:\n${html}`,
    );
    assert.strictEqual(html.includes('[manual][guide]'), false, 'rendered as literal text');
  });

  test('given a multiline destination edit, when diffed, then both destinations are visible', () => {
    const before = 'Read [manual][guide].\n\n[guide]:\n  https://example.invalid/old\n';
    const after = 'Read [manual][guide].\n\n[guide]:\n  https://example.invalid/new\n';
    const { html } = renderMarkdownDiff(before, after, NO_DIAGRAMS);

    assert.ok(html.includes('example.invalid/old'), `the old destination vanished:\n${html}`);
    assert.ok(html.includes('example.invalid/new'), `the new destination vanished:\n${html}`);
  });

  test('given a multiline image definition, when diffed, then it resolves', () => {
    const before = '![shot][img]\n\n[img]:\n  https://example.invalid/a.png\n';
    const after = '![shot][img]\n\nMore.\n\n[img]:\n  https://example.invalid/a.png\n';
    const { html } = renderMarkdownDiff(before, after, NO_DIAGRAMS);
    assert.ok(html.includes('src="https://example.invalid/a.png"'), `image lost:\n${html}`);
  });
});
