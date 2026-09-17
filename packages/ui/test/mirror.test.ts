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
import { agentAvatarValue } from '../src/atoms/agentAvatar.js';
import { tintStyle } from '../src/atoms/labelChip.js';

const BOARD_JS = path.join(import.meta.dir, '..', '..', 'vscode', 'media', 'board.js');
const source = readFileSync(BOARD_JS, 'utf8');

/** Lift one `function name(...) { ... }` out of board.js and evaluate it. */
function liftFunction(name: string): string {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start > 0, `board.js no longer declares ${name}`);
  const end = source.indexOf('\n  }\n', start);
  assert.ok(end > start, `could not find the end of ${name} in board.js`);
  return source.slice(start, end + 4);
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
