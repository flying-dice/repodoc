/**
 * `resolveRelativeLink` — the only thing that turns an `href` written inside a
 * markdown document into something the host will open. Anything that climbs out
 * of the workspace root, or arrives with a scheme we do not vouch for, must be
 * refused here.
 */

import { describe, test } from 'bun:test';
import * as assert from 'node:assert';
import { resolveRelativeLink } from '../../src/panels/linkTargets';

const DOC = 'docs/01-getting-started/03-architecture.md';

describe('resolveRelativeLink', () => {
  test('given a relative link to a decision, when resolved, then it opens the reading view', () => {
    assert.deepStrictEqual(resolveRelativeLink(DOC, '../../decisions/03-x.md'), {
      kind: 'decision',
      id: '03-x',
      path: 'decisions/03-x.md',
    });
  });

  test('given a sibling doc, when resolved, then it opens as a doc', () => {
    assert.deepStrictEqual(resolveRelativeLink(DOC, './04-cli.md'), {
      kind: 'doc',
      path: 'docs/01-getting-started/04-cli.md',
    });
    assert.deepStrictEqual(resolveRelativeLink(DOC, '../02-reference/01-api.md'), {
      kind: 'doc',
      path: 'docs/02-reference/01-api.md',
    });
  });

  test('given a fragment, when resolved, then the page scrolls itself', () => {
    assert.deepStrictEqual(resolveRelativeLink(DOC, '#anchor'), {
      kind: 'fragment',
      fragment: 'anchor',
    });
  });

  test('given a document link with a fragment, when resolved, then the fragment is carried', () => {
    assert.deepStrictEqual(resolveRelativeLink(DOC, './04-cli.md#usage'), {
      kind: 'doc',
      path: 'docs/01-getting-started/04-cli.md',
      fragment: 'usage',
    });
  });

  test('given an http(s) link, when resolved, then it is external', () => {
    assert.deepStrictEqual(resolveRelativeLink(DOC, 'https://example.com/x?y=1#z'), {
      kind: 'external',
      url: 'https://example.com/x?y=1#z',
    });
    assert.strictEqual(resolveRelativeLink(DOC, 'http://localhost:8792/').kind, 'external');
  });

  test('given a link that escapes the workspace, when resolved, then it is blocked', () => {
    assert.strictEqual(resolveRelativeLink(DOC, '../../../etc/passwd').kind, 'blocked');
    assert.strictEqual(resolveRelativeLink(DOC, '../../../../../../etc/passwd').kind, 'blocked');
    assert.strictEqual(resolveRelativeLink('README.md', '../secrets.md').kind, 'blocked');
    assert.strictEqual(resolveRelativeLink(DOC, '..\\..\\..\\etc\\passwd').kind, 'blocked');
  });

  test('given a non-markdown in-repo file, when resolved, then it opens as a file', () => {
    assert.deepStrictEqual(resolveRelativeLink(DOC, '../../package.json'), {
      kind: 'file',
      path: 'package.json',
    });
    assert.deepStrictEqual(resolveRelativeLink(DOC, '../../decisions/notes/03-x.md'), {
      kind: 'file',
      path: 'decisions/notes/03-x.md',
    });
  });

  test('given a root-relative link, when resolved, then it is read against the repo root', () => {
    assert.deepStrictEqual(resolveRelativeLink(DOC, '/decisions/05-theme.md'), {
      kind: 'decision',
      id: '05-theme',
      path: 'decisions/05-theme.md',
    });
  });

  test('given a percent-encoded path, when resolved, then it is decoded once', () => {
    assert.deepStrictEqual(resolveRelativeLink(DOC, './a%20b.md'), {
      kind: 'doc',
      path: 'docs/01-getting-started/a b.md',
    });
    assert.strictEqual(resolveRelativeLink(DOC, './%E0%A4%A.md').kind, 'blocked');
    // Encoding the separators does not buy an escape.
    assert.strictEqual(resolveRelativeLink(DOC, '..%2f..%2f..%2fetc/passwd').kind, 'blocked');
  });

  test('given a scheme we do not vouch for, when resolved, then it is blocked', () => {
    for (const href of [
      'javascript:alert(1)',
      'file:///etc/passwd',
      'command:workbench.action.terminal.new',
      'vscode-webview://abc/decisions/03-x.md',
      'mailto:someone@example.com',
      'data:text/html,<script>',
      '//example.com/x',
    ]) {
      assert.strictEqual(resolveRelativeLink(DOC, href).kind, 'blocked', href);
    }
  });

  test('given an empty or root link, when resolved, then it is blocked', () => {
    assert.strictEqual(resolveRelativeLink(DOC, '').kind, 'blocked');
    assert.strictEqual(resolveRelativeLink(DOC, '   ').kind, 'blocked');
    assert.strictEqual(resolveRelativeLink(DOC, '/').kind, 'blocked');
    assert.strictEqual(resolveRelativeLink(DOC, '../..').kind, 'blocked');
  });

  test('given a query with no path, when resolved, then it stays on the page', () => {
    assert.deepStrictEqual(resolveRelativeLink(DOC, '?v=2#here'), {
      kind: 'fragment',
      fragment: 'here',
    });
  });

  test('given a decision document as the source, when a sibling is linked, then it resolves', () => {
    assert.deepStrictEqual(resolveRelativeLink('decisions/05-theme.md', '06-next.md'), {
      kind: 'decision',
      id: '06-next',
      path: 'decisions/06-next.md',
    });
  });
});
