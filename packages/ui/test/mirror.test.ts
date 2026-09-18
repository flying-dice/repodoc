/**
 * The components in this package and `packages/vscode/media/board.js` are two
 * hand-maintained copies of the same rendering. That was a deliberate choice
 * (#21): the shipped webview has no build step and cannot import a module, so
 * the migration comes later.
 *
 * The copies must not drift in the meantime. These lift the relevant function
 * out of the shipped `board.js` and hold it to the component, the same trick
 * `editConflict.test.ts` already uses for the conflict decision.
 */

import { describe, expect, test } from 'bun:test';
import * as assert from 'node:assert';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { agentAvatarValue } from '../src/atoms/agentAvatar.js';

if (!globalThis.document) {
  GlobalRegistrator.register();
}

import { ICON } from '../src/atoms/icon.js';
import { tintStyle } from '../src/atoms/labelChip.js';
import { relativeTime } from '../src/atoms/relativeTime.js';
import { h } from '../src/dom.js';

const BOARD_JS = path.join(import.meta.dir, '..', '..', 'vscode', 'media', 'board.js');
const source = readFileSync(BOARD_JS, 'utf8');

/** Lift a `start ... end` span out of board.js verbatim. */
function liftBlock(start: string, end: string): string {
  const from = source.indexOf(start);
  assert.ok(from > 0, `board.js no longer contains ${start.trim()}`);
  const to = source.indexOf(end, from);
  assert.ok(to > from, `could not find the end of ${start.trim()} in board.js`);
  return source.slice(from, to + end.length);
}

/**
 * Lift one `function name(...) { ... }` out of board.js.
 *
 * Braces are matched rather than scanning for the next `\n  }`: that shortcut
 * silently truncates the moment a helper grows a nested block, and a partial
 * function would still evaluate — leaving a mirror test that quietly checks
 * half of one.
 */
function liftFunction(name: string): string {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start > 0, `board.js no longer declares ${name}`);
  const open = source.indexOf('{', start);
  assert.ok(open > start, `could not find the body of ${name}`);

  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }
  throw new Error(`unbalanced braces reading ${name} from board.js`);
}

describe('components mirror board.js', () => {
  test('agentAvatar derives the same initials and colour in both copies', () => {
    const mirror = new Function(
      `${liftFunction('agentAvatar')}; return agentAvatar;`,
    )() as typeof agentAvatarValue;

    for (const name of ['starscream', 'Thundercracker', 'Jonathan Turnock', 'x', 'a b c d']) {
      expect(mirror(name)).toEqual(agentAvatarValue(name));
    }
  });

  test('tintStyle produces the same declaration in both copies', () => {
    const mirror = new Function(
      `${liftFunction('tintStyle')}; return tintStyle;`,
    )() as typeof tintStyle;

    for (const color of ['#e5534b', '#4c8bf5', '#8b949e']) {
      assert.strictEqual(mirror(color), tintStyle(color));
    }
  });

  test('humanizeTime coarsens identically in both copies', () => {
    const mirror = new Function(`${liftFunction('humanizeTime')}; return humanizeTime;`)() as (
      iso: string,
    ) => string;

    // board.js reads Date.now() directly, so both sides are compared against
    // the same real clock rather than an injected one.
    const now = Date.now();
    for (const offset of [5_000, 90_000, 3 * 3_600_000, 3 * 86_400_000, 30 * 86_400_000]) {
      const iso = new Date(now - offset).toISOString();
      assert.strictEqual(mirror(iso), relativeTime(iso, now), `disagreed on ${iso}`);
    }
    assert.strictEqual(mirror('not a date'), relativeTime('not a date'));
  });

  test('the icon set is byte-identical in both copies', () => {
    const start = source.indexOf('  var ICON = {');
    assert.ok(start > 0, 'board.js no longer declares ICON');
    const end = source.indexOf('\n  };\n', start) + 5;
    const mirror = new Function(
      `${source.slice(start, end).replace('  var ICON = {', 'const ICON = {')}; return ICON;`,
    )() as Record<string, string>;

    expect(mirror).toEqual(ICON);
  });

  /**
   * `h` is the one piece every component runs through, so a difference here is
   * a difference everywhere. The two copies are deliberately not byte-identical
   * — board.js is held to ES5 — so this compares the DOM they build.
   */
  test('h builds the same DOM in both copies', () => {
    const mirror = new Function(
      `${liftBlock('  var EVT = {', '\n  };\n')}
       ${liftFunction('appendChildren')}
       ${liftFunction('h')}
       return h;`,
    )() as typeof h;

    const cases: Array<[string, Record<string, unknown>, unknown]> = [
      ['div', { class: 'card' }, 'text'],
      ['span', { class: 'a b', title: 'tip' }, null],
      ['div', { dataset: { cardId: 'x' }, draggable: true }, ['one', 'two']],
      ['div', { html: '<b>bold</b>' }, null],
      ['input', { type: 'checkbox', id: 'c' }, null],
      // A null prop is skipped entirely rather than written as "null".
      ['div', { class: 'x', title: null }, null],
      // false children are dropped; 0 is not.
      ['div', {}, [false, 0, 'kept']],
    ];

    for (const [tag, props, children] of cases) {
      assert.strictEqual(
        mirror(tag, props, children).outerHTML,
        h(tag, props, children).outerHTML,
        `the copies disagree on ${tag} ${JSON.stringify(props)}`,
      );
    }
  });

  test('the card change badge still has no deleted variant in either copy', () => {
    // A deleted card file leaves no card to mark. If board.js grows one, this
    // package has to grow it too — and the trees need a deletion overlay first.
    assert.strictEqual(
      source.includes('card-git-deleted'),
      false,
      'board.js gained a deleted badge; the component and the trees must follow',
    );
  });
});
