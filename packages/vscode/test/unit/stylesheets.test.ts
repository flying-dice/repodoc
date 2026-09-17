/**
 * Webview stylesheets are hand-written and never parsed by a build step, so
 * nothing catches a rule that ends up nested inside another one.
 *
 * The bug this covers shipped: a merge left the whole git block inside
 * `.filecrumb-link:hover { … }` in base.css and inside `.scenario-notice.error`
 * in board.css. Nested CSS is valid syntax, so Biome was happy and the bundle
 * built — but `.diff-add` then only matches inside a hovered breadcrumb link,
 * which never happens. The diff view rendered its added and removed blocks with
 * no marking at all, and the card-face change badges were invisible.
 */

import { describe, test } from 'bun:test';
import * as assert from 'node:assert';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

const MEDIA = path.join(__dirname, '..', '..', 'media');

/** Strip comments and strings so braces inside them do not skew the depth. */
function stripNoise(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

/**
 * Selectors that begin a rule at the top level of the file. A selector found at
 * any other depth is nested inside another rule and scoped to it.
 */
function topLevelSelectors(css: string): Set<string> {
  const found = new Set<string>();
  let depth = 0;
  let current = '';
  for (const char of stripNoise(css)) {
    if (char === '{') {
      if (depth === 0) {
        found.add(current.trim().replace(/\s+/g, ' '));
      }
      depth++;
      current = '';
    } else if (char === '}') {
      depth = Math.max(0, depth - 1);
      current = '';
    } else if (char === ';') {
      current = '';
    } else {
      current += char;
    }
  }
  return found;
}

/** Every selector the file declares, at any depth — to prove one exists at all. */
function allSelectors(css: string): string[] {
  return [...stripNoise(css).matchAll(/([^{};]+)\{/g)].map((m) =>
    (m[1] ?? '').trim().replace(/\s+/g, ' '),
  );
}

const CASES: Array<{ file: string; selectors: string[] }> = [
  {
    file: 'base.css',
    selectors: [
      ':root',
      '.git-toggle.is-on',
      '.diff-run',
      '.diff-run::before',
      '.diff-add',
      '.diff-add::before',
      '.diff-del',
      '.diff-del::before',
    ],
  },
  {
    file: 'board.css',
    selectors: ['.card-git', '.card-git-added', '.card-git-modified', '.card-git-renamed'],
  },
  {
    file: 'markdown.css',
    selectors: ['.git-legend', '.git-note', '.git-timing'],
  },
];

describe('webview stylesheets — the git rules are not nested', () => {
  for (const { file, selectors } of CASES) {
    const css = readFileSync(path.join(MEDIA, file), 'utf8');
    const top = topLevelSelectors(css);
    const all = allSelectors(css);

    for (const selector of selectors) {
      test(`${file} declares ${selector} at the top level`, () => {
        assert.ok(all.includes(selector), `${file} no longer declares ${selector} at all`);
        assert.ok(
          top.has(selector),
          `${selector} is nested inside another rule in ${file}, so it only applies within it`,
        );
      });
    }
  }

  test('every stylesheet closes every rule it opens', () => {
    for (const { file } of CASES) {
      const css = stripNoise(readFileSync(path.join(MEDIA, file), 'utf8'));
      const opens = (css.match(/\{/g) ?? []).length;
      const closes = (css.match(/\}/g) ?? []).length;
      assert.strictEqual(opens, closes, `${file} has unbalanced braces`);
    }
  });
});
