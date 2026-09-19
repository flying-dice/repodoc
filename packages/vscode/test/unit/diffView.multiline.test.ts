/**
 * Reference definitions may span lines. The one-line pattern missed them, so a
 * document the ordinary renderer resolves correctly rendered as literal
 * `[manual][guide]` in a diff, with the destination change invisible.
 */

import { describe, test } from 'bun:test';
import * as assert from 'node:assert';
import { isReferenceDefinitionsOnly, referenceDefinitions } from '@repodoc/core';
import { renderMarkdownDiff } from '../../src/panels/diffView';

const NO_DIAGRAMS = { plantUmlServer: '' };

describe('reference definitions — spanning lines', () => {
  test('given a destination on the next line, when collected, then it is complete', () => {
    const defs = referenceDefinitions(
      'Read [manual][guide].\n\n[guide]:\n  https://example.invalid/old\n',
    );
    assert.strictEqual(defs.length, 1);
    assert.ok(defs[0]?.includes('https://example.invalid/old'), `incomplete: ${defs[0]}`);
  });

  test('given a title on a continuation line, when collected, then it is included', () => {
    const defs = referenceDefinitions('[guide]: https://example.invalid/a\n  "The guide"\n');
    assert.strictEqual(defs.length, 1);
    assert.ok(defs[0]?.includes('The guide'), `title dropped: ${defs[0]}`);
  });

  test('given a multiline definition alone, then it counts as definitions only', () => {
    assert.strictEqual(
      isReferenceDefinitionsOnly('[guide]:\n  https://example.invalid/old\n'),
      true,
    );
    assert.strictEqual(isReferenceDefinitionsOnly('Some prose.\n'), false);
    assert.strictEqual(
      isReferenceDefinitionsOnly('[guide]:\n  https://example.invalid/old\n\nProse.\n'),
      false,
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

    const removed = /<div class="diff-run diff-del"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '';
    const added = /<div class="diff-run diff-add"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '';
    assert.ok(removed.includes('example.invalid/old'), `removed container was empty:\n${html}`);
    assert.ok(added.includes('example.invalid/new'), `added container was empty:\n${html}`);
  });

  test('given a multiline image definition, when diffed, then it resolves', () => {
    const before = '![shot][img]\n\n[img]:\n  https://example.invalid/a.png\n';
    const after = '![shot][img]\n\nMore.\n\n[img]:\n  https://example.invalid/a.png\n';
    const { html } = renderMarkdownDiff(before, after, NO_DIAGRAMS);
    assert.ok(html.includes('src="https://example.invalid/a.png"'), `image lost:\n${html}`);
  });

  test('given a definition inside a fence, when collected, then it is ignored', () => {
    assert.deepStrictEqual(
      referenceDefinitions('```\n[guide]: https://example.invalid/x\n```\n'),
      [],
    );
  });
});
