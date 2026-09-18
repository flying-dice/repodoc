/**
 * Components must emit the markup the extension actually ships.
 *
 * The value of this package rests entirely on that: a story is only evidence
 * about the real UI if the component wears the same classes the webview does.
 * While bootstrapping I invented about twenty class names — `blocked-dialog`,
 * `check-row`, `live-bar` — and every one of them rendered unstyled while the
 * tests stayed green, because nothing was checking.
 *
 * So: every class a component emits must appear either in a shipped stylesheet
 * or in `board.js`. A name that appears in neither is invented.
 */

import { describe, test } from 'bun:test';
import * as assert from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

const VSCODE = path.join(import.meta.dir, '..', '..', 'vscode');
const SRC = path.join(import.meta.dir, '..', 'src');

const CLASS_TOKEN = /^[a-zA-Z][\w-]*$/;
/** Stands in for a `${...}` expression while a class string is split. */
const HOLE = '\u0000';

/**
 * Class names a `class:` prop can produce.
 *
 * A template may interpolate — `diff-${op}`, `card-git-${status}` — so an
 * expression is replaced by a hole before splitting. A token carrying a hole is
 * a prefix to be matched against the vocabulary, not a literal name; a token
 * without one has to match exactly.
 */
function classTokens(source: string): string[] {
  const tokens: string[] = [];
  for (const [, value] of source.matchAll(/class:\s*[`'"]([^`'"]*)/g)) {
    const holed = (value ?? '').replace(/\$\{[^}]*\}/g, HOLE);
    for (const token of holed.split(/\s+/)) {
      if (token && (CLASS_TOKEN.test(token) || token.includes(HOLE))) {
        tokens.push(token);
      }
    }
  }
  return tokens;
}

/** Whether the vocabulary can account for a literal name or an interpolated prefix. */
function known(vocabulary: Set<string>, token: string): boolean {
  if (!token.includes(HOLE)) {
    return vocabulary.has(token);
  }
  const prefix = token.slice(0, token.indexOf(HOLE));
  if (prefix === '') {
    return true; // wholly computed, e.g. `${cls}` — nothing to check
  }
  for (const name of vocabulary) {
    if (name.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

function read(...parts: string[]): string {
  return readFileSync(path.join(...parts), 'utf8');
}

/** Every class the shipped stylesheets define or the shipped webview emits. */
function shippedVocabulary(): Set<string> {
  const css = ['base.css', 'board.css', 'markdown.css']
    .map((f) => read(VSCODE, 'media', f))
    .join('\n');
  const defined = [...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1] as string);
  const emitted = classTokens(read(VSCODE, 'media', 'board.js'));
  return new Set([...defined, ...emitted]);
}

/** Component modules, stories excluded — a story may style its own scaffolding. */
function componentFiles(): string[] {
  const files: string[] = [];
  for (const dir of ['atoms', 'molecules', 'organisms']) {
    for (const name of readdirSync(path.join(SRC, dir))) {
      if (name.endsWith('.js') && !name.endsWith('.stories.js')) {
        files.push(path.join(SRC, dir, name));
      }
    }
  }
  files.push(path.join(SRC, 'dom.js'));
  return files;
}

describe('components wear the shipped markup', () => {
  const vocabulary = shippedVocabulary();

  for (const file of componentFiles()) {
    const name = path.basename(file);
    test(`${name} invents no class of its own`, () => {
      const invented = classTokens(readFileSync(file, 'utf8')).filter((c) => !known(vocabulary, c));
      assert.deepStrictEqual(
        [...new Set(invented)],
        [],
        `${name} emits ${invented.map((c) => c.replaceAll(HOLE, '<expr>')).join(', ')}, which neither the stylesheets nor board.js know — a story of it would render unstyled and prove nothing`,
      );
    });
  }

  test('the vocabulary itself is non-trivial, so an empty read cannot pass this', () => {
    assert.ok(
      vocabulary.size > 100,
      `only ${vocabulary.size} classes found; the sources did not load`,
    );
    assert.ok(vocabulary.has('card'), 'the board vocabulary is missing');
    assert.ok(vocabulary.has('diff-add'), 'the reading-view vocabulary is missing');
  });
});
