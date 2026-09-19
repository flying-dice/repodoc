/**
 * Reference links must resolve across diff runs.
 *
 * `renderMarkdownDiff` renders each run through its own Marked instance, so a
 * `[label]: url` definition sitting in a different run is invisible to the
 * prose that uses it. The link silently renders as literal text, and a
 * destination-only edit produces two definition runs that show nothing a reader
 * can interpret.
 */

import { describe, test } from 'bun:test';
import * as assert from 'node:assert';
import { renderMarkdownDiff } from '../../src/panels/diffView';

const NO_DIAGRAMS = { plantUmlServer: '' };

describe('diffView — reference definitions', () => {
  test('given a definition in another run, when rendered, then the link still resolves', () => {
    const before = 'Read [manual][guide].\n\n[guide]: https://example.invalid/old\n';
    const after = 'Read [manual][guide].\n\n[guide]: https://example.invalid/new\n';
    const { html } = renderMarkdownDiff(before, after, NO_DIAGRAMS);

    assert.ok(
      html.includes('<a href="https://example.invalid/new">manual</a>'),
      `the unchanged prose lost its link:\n${html}`,
    );
  });

  test('given a destination-only edit, when rendered, then both destinations are visible', () => {
    const before = 'Read [manual][guide].\n\n[guide]: https://example.invalid/old\n';
    const after = 'Read [manual][guide].\n\n[guide]: https://example.invalid/new\n';
    const { html } = renderMarkdownDiff(before, after, NO_DIAGRAMS);

    assert.ok(html.includes('example.invalid/old'), `the old destination vanished:\n${html}`);
    assert.ok(html.includes('example.invalid/new'), `the new destination vanished:\n${html}`);
  });

  test('given removed prose, when rendered, then it resolves against the OLD definitions', () => {
    const before = 'Gone [manual][guide].\n\nStays.\n\n[guide]: https://example.invalid/old\n';
    const after = 'Stays.\n\n[guide]: https://example.invalid/new\n';
    const { html } = renderMarkdownDiff(before, after, NO_DIAGRAMS);

    assert.ok(
      html.includes('https://example.invalid/old'),
      `removed content must resolve against what it was written against:\n${html}`,
    );
  });

  test('given a reference image, when rendered, then it resolves', () => {
    const before = '![shot][img]\n\n[img]: https://example.invalid/a.png\n';
    const after = '![shot][img]\n\nAdded line.\n\n[img]: https://example.invalid/a.png\n';
    const { html } = renderMarkdownDiff(before, after, NO_DIAGRAMS);
    assert.ok(html.includes('src="https://example.invalid/a.png"'), `image lost:\n${html}`);
  });

  test('given a shortcut reference, when rendered, then it resolves', () => {
    const before = 'See [guide].\n\n[guide]: https://example.invalid/old\n';
    const after = 'See [guide].\n\nMore.\n\n[guide]: https://example.invalid/old\n';
    const { html } = renderMarkdownDiff(before, after, NO_DIAGRAMS);
    assert.ok(html.includes('href="https://example.invalid/old"'), `shortcut lost:\n${html}`);
  });

  test('given no references at all, when rendered, then nothing changes', () => {
    const { html } = renderMarkdownDiff('# A\n', '# B\n', NO_DIAGRAMS);
    assert.ok(html.includes('<h1>A</h1>'));
    assert.ok(html.includes('<h1>B</h1>'));
  });
});
