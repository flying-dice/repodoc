/**
 * Unsaved scenario edits. The bugs these cover are the two ways a managed
 * editor loses someone's work: a background refresh wiping a half-typed
 * scenario, and a save quietly overwriting an edit that arrived from the file
 * in the meantime.
 */

import { describe, test } from 'bun:test';
import * as assert from 'node:assert';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import {
  clearCardDrafts,
  clearScenarioDraft,
  draftMatchesStored,
  getScenarioDraft,
  joinSteps,
  NEW_SCENARIO,
  type ScenarioDraft,
  type ScenarioDraftMap,
  scenarioChangedUnderDraft,
  scenarioDraftKey,
  setScenarioDraft,
  splitSteps,
} from '../../src/panels/scenarioDrafts';

function draft(name: string, steps: string, base = { name, steps }): ScenarioDraft {
  return { name, steps, base };
}

describe('scenario drafts', () => {
  test('given a draft on one scenario, when another is read, then it has none', () => {
    const first = scenarioDraftKey('spec', 'gates', 0);
    const second = scenarioDraftKey('spec', 'gates', 1);
    const drafts = setScenarioDraft({}, first, draft('Renamed', 'Given a'));
    assert.strictEqual(getScenarioDraft(drafts, first)?.name, 'Renamed');
    assert.strictEqual(getScenarioDraft(drafts, second), undefined);
  });

  test('given the same index on two features, when read, then the drafts are separate', () => {
    assert.strictEqual(scenarioDraftKey('spec', 'gates', 0), 'spec/gates/0');
    assert.strictEqual(scenarioDraftKey('spec', 'moves', 0), 'spec/moves/0');
    assert.strictEqual(scenarioDraftKey('spec', 'gates', NEW_SCENARIO), 'spec/gates/new');
  });

  test('given a map, when a draft is set or cleared, then the original is not mutated', () => {
    const before: ScenarioDraftMap = {};
    const after = setScenarioDraft(before, 'k', draft('A', ''));
    assert.deepStrictEqual(before, {});
    assert.notStrictEqual(after, before);
    assert.strictEqual(clearScenarioDraft(after, 'missing'), after);
    assert.deepStrictEqual(clearScenarioDraft(after, 'k'), {});
  });

  test('given a closed card, when its drafts are dropped, then other cards keep theirs', () => {
    let drafts = setScenarioDraft({}, scenarioDraftKey('spec', 'gates', 0), draft('A', ''));
    drafts = setScenarioDraft(drafts, scenarioDraftKey('spec', 'gates', 1), draft('B', ''));
    drafts = setScenarioDraft(drafts, scenarioDraftKey('spec', 'moves', 0), draft('C', ''));
    drafts = clearCardDrafts(drafts, 'spec', 'gates');
    assert.deepStrictEqual(Object.keys(drafts), ['spec/moves/0']);
  });

  test('given an inherited property name as a key, when read, then nothing leaks', () => {
    assert.strictEqual(getScenarioDraft({}, 'constructor'), undefined);
    assert.strictEqual(getScenarioDraft({}, '__proto__'), undefined);
    assert.strictEqual(getScenarioDraft({}, scenarioDraftKey('b', 'toString', 0)), undefined);
  });

  test('given textarea text, when split, then it is one step per line without the edges', () => {
    assert.deepStrictEqual(splitSteps('\nGiven a\r\nThen b\n\n'), ['Given a', 'Then b']);
    assert.deepStrictEqual(splitSteps('   \n  '), [], 'a blank textarea is no steps at all');
    // A blank line INSIDE the body is content — a doc string may hold one.
    assert.deepStrictEqual(splitSteps('"""\na\n\nb\n"""'), ['"""', 'a', '', 'b', '"""']);
    assert.strictEqual(joinSteps(splitSteps('Given a\nThen b')), 'Given a\nThen b');
  });

  test('given the file changed under an open edit, when checked, then it is reported', () => {
    const open = draft('Mine', 'Given mine', { name: 'Theirs', steps: 'Given theirs' });
    assert.strictEqual(
      scenarioChangedUnderDraft(open, { name: 'Theirs', steps: ['Given theirs'] }),
      false,
      'the file still says what the edit started from',
    );
    assert.strictEqual(
      scenarioChangedUnderDraft(open, { name: 'Theirs', steps: ['Given something else'] }),
      true,
    );
    assert.strictEqual(
      scenarioChangedUnderDraft(open, { name: 'Renamed elsewhere', steps: ['Given theirs'] }),
      true,
    );
    assert.strictEqual(
      scenarioChangedUnderDraft(open, undefined),
      true,
      'a scenario that has been deleted underneath the edit counts as changed',
    );
  });

  test('given a posted draft, when the file comes back saying it, then it matches', () => {
    const posted = draft('  The move   is refused ', 'Given a\nThen b\n');
    assert.strictEqual(
      draftMatchesStored(posted, { name: 'The move is refused', steps: ['Given a', 'Then b'] }),
      true,
      'the name is compared as the store writes it: collapsed to one line',
    );
    assert.strictEqual(
      draftMatchesStored(posted, { name: 'The move is refused', steps: ['Given a'] }),
      false,
    );
    assert.strictEqual(draftMatchesStored(posted, undefined), false);
  });

  /**
   * `media/board.js` mirrors these helpers by hand (the webview has no build
   * step). This lifts the mirrored block straight out of the shipped file and
   * holds it to the same behaviour, so the two cannot drift apart silently.
   */
  test('given the webview mirror, when exercised, then it behaves the same', () => {
    const boardJs = path.join(__dirname, '..', '..', 'media', 'board.js');
    const source = readFileSync(boardJs, 'utf8');
    const start = source.indexOf("  var NEW_SCENARIO = 'new';");
    const end = source.indexOf('  /* ---- end of the scenario-draft mirror ---- */');
    assert.ok(start > 0 && end > start, 'the mirrored scenario helpers moved in board.js');
    const mirror = new Function(
      `${source.slice(start, end)}; return { NEW_SCENARIO, scenarioDraftKey, getScenarioDraft, setScenarioDraft, clearScenarioDraft, clearCardDrafts, splitSteps, joinSteps, scenarioChangedUnderDraft, draftMatchesStored };`,
    )() as {
      NEW_SCENARIO: typeof NEW_SCENARIO;
      scenarioDraftKey: typeof scenarioDraftKey;
      getScenarioDraft: typeof getScenarioDraft;
      setScenarioDraft: typeof setScenarioDraft;
      clearScenarioDraft: typeof clearScenarioDraft;
      clearCardDrafts: typeof clearCardDrafts;
      splitSteps: typeof splitSteps;
      joinSteps: typeof joinSteps;
      scenarioChangedUnderDraft: typeof scenarioChangedUnderDraft;
      draftMatchesStored: typeof draftMatchesStored;
    };

    assert.strictEqual(mirror.NEW_SCENARIO, NEW_SCENARIO);
    assert.strictEqual(mirror.scenarioDraftKey('spec', 'gates', 0), 'spec/gates/0');
    assert.strictEqual(
      mirror.scenarioDraftKey('spec', 'gates', mirror.NEW_SCENARIO),
      scenarioDraftKey('spec', 'gates', NEW_SCENARIO),
    );

    let drafts = mirror.setScenarioDraft({}, 'spec/gates/0', draft('A', 'Given a'));
    drafts = mirror.setScenarioDraft(drafts, 'spec/moves/0', draft('B', 'Given b'));
    assert.strictEqual(mirror.getScenarioDraft(drafts, 'spec/gates/0')?.name, 'A');
    assert.strictEqual(mirror.getScenarioDraft(drafts, 'spec/gates/1'), undefined);
    assert.deepStrictEqual(Object.keys(mirror.clearCardDrafts(drafts, 'spec', 'gates')), [
      'spec/moves/0',
    ]);
    assert.deepStrictEqual(Object.keys(mirror.clearScenarioDraft(drafts, 'spec/gates/0')), [
      'spec/moves/0',
    ]);

    assert.deepStrictEqual(mirror.splitSteps('\nGiven a\r\nThen b\n\n'), ['Given a', 'Then b']);
    assert.strictEqual(mirror.joinSteps(['Given a', 'Then b']), joinSteps(['Given a', 'Then b']));

    const open = draft('Mine', 'Given mine', { name: 'Theirs', steps: 'Given theirs' });
    assert.strictEqual(
      mirror.scenarioChangedUnderDraft(open, { name: 'Theirs', steps: ['Given theirs'] }),
      false,
    );
    assert.strictEqual(
      mirror.scenarioChangedUnderDraft(open, { name: 'Theirs', steps: ['Given else'] }),
      true,
    );
    assert.strictEqual(
      mirror.draftMatchesStored(draft(' A  B ', 'Given a\n'), {
        name: 'A B',
        steps: ['Given a'],
      }),
      true,
    );
  });
});
