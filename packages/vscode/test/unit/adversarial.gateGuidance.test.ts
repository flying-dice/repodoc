/**
 * Adversarial coverage for the pure gate-guidance helpers behind the
 * blocked-move dialog. These strings are read by a human who has just been
 * refused a move, so garbled or missing wording is a real defect.
 *
 * `test.skip` marks a failing test for a defect reported to the lead.
 */

import { describe, test } from 'bun:test';
import * as assert from 'node:assert';
import { type Column, defaultGatePrompt, type GateResult, gatePromptText } from '@repodoc/core';
import { collectGatePrompts, gatePromptKey, toBlockedGate } from '../../src/panels/gateGuidance';

/** A blocked GateResult for `gate`. */
function blocked(gate: GateResult['gate'], reason = 'because'): GateResult {
  return { gate, satisfied: false, reason };
}

describe('toBlockedGate — adversarial', () => {
  test('given a gate with no label, when projected, then the id is the label and absent keys stay absent', () => {
    const projected = toBlockedGate(blocked({ id: 'owner', field: 'owner' }));
    assert.deepStrictEqual(projected, {
      id: 'owner',
      label: 'owner',
      reason: 'because',
      field: 'owner',
      prompt: 'Set the `owner` field so that it satisfies `nonempty`.',
    });
    assert.ok(!('check' in projected), 'an unset check must not appear as undefined');
    assert.ok(!('script' in projected), 'a field gate must not carry a script key');
  });

  test('given an empty check expression, when projected, then the key is carried through as written', () => {
    const projected = toBlockedGate(blocked({ id: 'g', field: 'f', check: '' }));
    assert.strictEqual(projected.check, '');
    assert.strictEqual(projected.prompt, 'Set the `f` field so that it satisfies ``.');
  });

  test('given an authored prompt, when projected, then it wins over the default wording', () => {
    const projected = toBlockedGate(
      blocked({ id: 'g', script: 'make', prompt: 'Ask Dana first.\n\nThen run `make`.' }),
    );
    assert.strictEqual(projected.prompt, 'Ask Dana first.\n\nThen run `make`.');
  });

  test('given a malformed gate carrying both script and field, when projected, then both are reported and script drives the prompt', () => {
    // normalizeBoardConfig drops `field` when both are set, but this helper is
    // pure — it must not invent a second source of truth.
    const projected = toBlockedGate(blocked({ id: 'g', script: 's', field: 'f', check: '= 1' }));
    assert.strictEqual(projected.script, 's');
    assert.strictEqual(projected.field, 'f');
    assert.strictEqual(
      projected.prompt,
      'Run `s` and, only if it exits 0, record the result with gate-pass.',
    );
  });

  test('given a satisfied result, when projected, then the reason still travels to the dialog', () => {
    const projected = toBlockedGate({
      gate: { id: 'g', script: 's' },
      satisfied: true,
      reason: 'ran `s`',
    });
    assert.strictEqual(projected.reason, 'ran `s`');
  });

  test('given a gate whose script is an empty string, when projected, then the prompt names the gate rather than undefined', () => {
    // normalizeBoardConfig now drops such a gate, but this helper is pure and
    // must not render "Set the `undefined` field" for whatever reaches it.
    const prompt = toBlockedGate(blocked({ id: 'tests', script: '' })).prompt ?? '';
    assert.ok(!prompt.includes('undefined'), `user-facing wording leaked undefined: ${prompt}`);
    assert.strictEqual(
      prompt,
      'Run `tests` and, only if it exits 0, record the result with gate-pass.',
    );
  });
});

describe('gatePromptText / defaultGatePrompt — adversarial', () => {
  test('given an empty authored prompt, when read, then the empty string wins (only undefined falls back)', () => {
    assert.strictEqual(gatePromptText({ id: 'g', script: 's', prompt: '' }), '');
  });

  test('given backticks and newlines in a script, when defaulted, then they are embedded verbatim', () => {
    assert.strictEqual(
      defaultGatePrompt({ id: 'g', script: 'bun test && echo `done`' }),
      'Run `bun test && echo `done`` and, only if it exits 0, record the result with gate-pass.',
    );
  });
});

describe('collectGatePrompts — adversarial', () => {
  const column = (id: string, gates: Partial<Pick<Column, 'enter' | 'exit'>>): Column => ({
    id,
    name: id,
    color: '#fff',
    cardIds: [],
    ...gates,
  });

  test('given both enter and exit gates on one column, when collected, then enter comes first and keys differ', () => {
    const collected = collectGatePrompts([
      column('done', {
        enter: [{ id: 'signoff', field: 'approved' }],
        exit: [{ id: 'signoff', script: 'ship' }],
      }),
    ]);
    assert.deepStrictEqual(
      collected.map((c) => c.key),
      ['done:enter:signoff', 'done:exit:signoff'],
    );
  });

  test('given two gates sharing an id in one list, when collected, then both are emitted under one key', () => {
    // The panel stores these in a Record keyed by `key`, so the LAST prompt wins
    // and the first gate's instructions never reach the dialog. Decision 6 makes
    // normalizeBoardConfig drop the duplicate before it ever gets here; this
    // helper stays pure and reports what it is given.
    const collected = collectGatePrompts([
      column('done', {
        enter: [
          { id: 'dup', script: 'first' },
          { id: 'dup', script: 'second' },
        ],
      }),
    ]);
    assert.strictEqual(collected.length, 2);
    assert.strictEqual(collected[0]?.key, collected[1]?.key);
    assert.notStrictEqual(collected[0]?.prompt, collected[1]?.prompt);
  });

  test('given a column with empty gate lists, when collected, then nothing is emitted', () => {
    assert.deepStrictEqual(collectGatePrompts([column('todo', { enter: [], exit: [] })]), []);
    assert.deepStrictEqual(collectGatePrompts([]), []);
  });

  test('given a gate id containing a colon, when keyed, then the column and direction still lead the key', () => {
    assert.strictEqual(gatePromptKey('done', 'enter', 'a:b'), 'done:enter:a:b');
    assert.notStrictEqual(gatePromptKey('done', 'enter', 'a'), gatePromptKey('done', 'exit', 'a'));
  });
});
