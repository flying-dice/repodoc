/**
 * Both hosts print these: the CLI on a refused command, the board panel as a
 * warning. The switch is exhaustive, so a new StoreError cannot be added
 * without the compiler asking for its wording here.
 */

import { describe, test } from 'bun:test';
import * as assert from 'node:assert';
import { storeErrorMessage } from '../src/storeErrors';
import type { StoreError } from '../src/types';

const ALL: StoreError[] = [
  { code: 'unknown-board', boardId: 'b' },
  { code: 'unknown-card', cardId: 'c' },
  { code: 'unknown-column', columnId: 'done' },
  { code: 'duplicate-slugs', slug: 'foo' },
  { code: 'unreadable-card', cardId: 'c' },
  { code: 'renumber-failed', boardId: 'b' },
];

describe('storeErrorMessage', () => {
  test('given any store error, when explained, then it is one non-empty line', () => {
    for (const error of ALL) {
      const message = storeErrorMessage(error);
      assert.ok(message.trim(), `${error.code} has no message`);
      assert.strictEqual(message.includes('\n'), false, `${error.code} spans lines`);
    }
  });

  test('given an error naming a subject, when explained, then the subject is in the text', () => {
    assert.ok(
      storeErrorMessage({ code: 'unknown-board', boardId: 'sprint-7' }).includes('sprint-7'),
    );
    assert.ok(storeErrorMessage({ code: 'unknown-card', cardId: 'my-card' }).includes('my-card'));
    assert.ok(
      storeErrorMessage({ code: 'unknown-column', columnId: 'shipped' }).includes('shipped'),
    );
    assert.ok(storeErrorMessage({ code: 'duplicate-slugs', slug: 'twice' }).includes('twice'));
  });

  test('given renumber-failed, when explained, then it says the move DID happen', () => {
    const message = storeErrorMessage({ code: 'renumber-failed', boardId: 'b' });
    assert.ok(
      message.includes('moved column'),
      'this is the one partial success; implying nothing changed would be a lie',
    );
  });
});
