/**
 * Comment drafts are keyed by board AND card: the bug these cover is a draft
 * typed on one card appearing in the next card's composer.
 */

import { describe, test } from 'bun:test';
import * as assert from 'node:assert';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import {
  clearDraft,
  type DraftMap,
  draftKey,
  getDraft,
  setDraft,
} from '../../src/panels/commentDrafts';

describe('comment drafts', () => {
  test('given a draft on one card, when another card is read, then it has none', () => {
    const drafts = setDraft({}, 'sprint', 'a1', 'half a thought');
    assert.strictEqual(getDraft(drafts, 'sprint', 'a1'), 'half a thought');
    assert.strictEqual(getDraft(drafts, 'sprint', 'b2'), '');
  });

  test('given the same card id on two boards, when read, then the drafts are separate', () => {
    let drafts: DraftMap = setDraft({}, 'sprint', '01-x', 'sprint text');
    drafts = setDraft(drafts, 'backlog', '01-x', 'backlog text');
    assert.strictEqual(getDraft(drafts, 'sprint', '01-x'), 'sprint text');
    assert.strictEqual(getDraft(drafts, 'backlog', '01-x'), 'backlog text');
    assert.strictEqual(draftKey('sprint', '01-x'), 'sprint/01-x');
  });

  test('given a draft, when it is set again, then the latest text wins', () => {
    let drafts = setDraft({}, 'sprint', 'a1', 'first');
    drafts = setDraft(drafts, 'sprint', 'a1', 'second');
    assert.deepStrictEqual(drafts, { 'sprint/a1': 'second' });
  });

  test('given a draft, when it is cleared, then only that entry goes', () => {
    let drafts = setDraft({}, 'sprint', 'a1', 'keep me');
    drafts = setDraft(drafts, 'sprint', 'b2', 'and me');
    drafts = clearDraft(drafts, 'sprint', 'a1');
    assert.strictEqual(getDraft(drafts, 'sprint', 'a1'), '');
    assert.strictEqual(getDraft(drafts, 'sprint', 'b2'), 'and me');
  });

  test('given blank text, when set, then no empty entry is left behind', () => {
    const drafts = setDraft(setDraft({}, 'sprint', 'a1', 'typed'), 'sprint', 'a1', '   ');
    assert.deepStrictEqual(drafts, {});
  });

  test('given an unknown card, when cleared, then the map is returned unchanged', () => {
    const drafts = setDraft({}, 'sprint', 'a1', 'x');
    assert.strictEqual(clearDraft(drafts, 'sprint', 'nope'), drafts);
  });

  test('given a map, when a draft is set, then the original map is not mutated', () => {
    const before: DraftMap = {};
    const after = setDraft(before, 'sprint', 'a1', 'x');
    assert.deepStrictEqual(before, {});
    assert.notStrictEqual(after, before);
  });

  test('given an inherited property name as a card id, when read, then nothing leaks', () => {
    assert.strictEqual(getDraft({}, 'sprint', 'constructor'), '');
    assert.strictEqual(getDraft({}, '', '__proto__'), '');
  });

  /**
   * `media/board.js` mirrors these helpers by hand (the webview has no build
   * step). This lifts the mirrored block straight out of the shipped file and
   * holds it to the same behaviour, so the two cannot drift apart silently.
   */
  test('given the webview mirror, when exercised, then it behaves the same', () => {
    const boardJs = path.join(__dirname, '..', '..', 'media', 'board.js');
    const source = readFileSync(boardJs, 'utf8');
    const start = source.indexOf('  function draftKey(');
    const end = source.indexOf('  // The board this webview is showing');
    assert.ok(start > 0 && end > start, 'the mirrored draft helpers moved in board.js');
    const mirror = new Function(
      `${source.slice(start, end)}; return { draftKey, getDraft, setDraft, clearDraft };`,
    )() as {
      draftKey: typeof draftKey;
      getDraft: typeof getDraft;
      setDraft: typeof setDraft;
      clearDraft: typeof clearDraft;
    };

    assert.strictEqual(mirror.draftKey('sprint', 'a1'), draftKey('sprint', 'a1'));
    let drafts = mirror.setDraft({}, 'sprint', 'a1', 'half a thought');
    assert.strictEqual(mirror.getDraft(drafts, 'sprint', 'a1'), 'half a thought');
    assert.strictEqual(mirror.getDraft(drafts, 'sprint', 'b2'), '');
    drafts = mirror.setDraft(drafts, 'backlog', 'a1', 'other board');
    drafts = mirror.clearDraft(drafts, 'sprint', 'a1');
    assert.strictEqual(mirror.getDraft(drafts, 'sprint', 'a1'), '');
    assert.strictEqual(mirror.getDraft(drafts, 'backlog', 'a1'), 'other board');
    assert.deepStrictEqual(mirror.setDraft({ 'b/c': 'x' }, 'b', 'c', '   '), {});
  });
});
