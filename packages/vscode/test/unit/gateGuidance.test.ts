import { describe, test } from 'bun:test';
import * as assert from 'node:assert';
import type { Column, GateResult } from '@repodoc/core';
import {
  collectGatePrompts,
  defaultGatePrompt,
  gateKind,
  gatePromptKey,
  gatePromptText,
  nextColumnId,
  toBlockedGate,
} from '../../src/panels/gateGuidance';

describe('defaultGatePrompt', () => {
  test('script gates get the CLI’s gate-pass wording', () => {
    assert.strictEqual(
      defaultGatePrompt({ id: 'tests', script: 'bun run test' }),
      'Run `bun run test` and, only if it exits 0, record the result with gate-pass.',
    );
  });

  test('field gates name the field and the check', () => {
    assert.strictEqual(
      defaultGatePrompt({ id: 'signoff', field: 'peer-reviewed', check: '= true' }),
      'Set the `peer-reviewed` field so that it satisfies `= true`.',
    );
  });

  test('a field gate with no check defaults to nonempty', () => {
    assert.strictEqual(
      defaultGatePrompt({ id: 'owner', field: 'owner' }),
      'Set the `owner` field so that it satisfies `nonempty`.',
    );
  });

  test('an authored prompt wins over the default', () => {
    assert.strictEqual(
      gatePromptText({ id: 'x', script: 'make', prompt: 'Ask Dana.' }),
      'Ask Dana.',
    );
    assert.strictEqual(
      gatePromptText({ id: 'x', script: 'make' }),
      'Run `make` and, only if it exits 0, record the result with gate-pass.',
    );
  });
});

describe('gateKind', () => {
  test('script wins, field otherwise, malformed gates read as field', () => {
    assert.strictEqual(gateKind({ id: 'a', script: 's' }), 'script');
    assert.strictEqual(gateKind({ id: 'b', field: 'f' }), 'field');
    assert.strictEqual(gateKind({ id: 'c' }), 'field');
  });
});

describe('toBlockedGate', () => {
  test('carries label, reason, kind and everything the action row needs', () => {
    const result: GateResult = {
      gate: { id: 'tests', label: 'Tests pass', script: 'bun run test' },
      satisfied: false,
      reason: 'no recorded green run of `bun run test`',
    };
    assert.deepStrictEqual(toBlockedGate(result), {
      id: 'tests',
      label: 'Tests pass',
      satisfied: false,
      reason: 'no recorded green run of `bun run test`',
      kind: 'script',
      script: 'bun run test',
      // `field` / `check` are absent (not undefined-valued) for a script gate.
      prompt: 'Run `bun run test` and, only if it exits 0, record the result with gate-pass.',
    });
  });

  test('an unlabelled gate falls back to its id', () => {
    const gate = toBlockedGate({
      gate: { id: 'peer-reviewed', field: 'peer-reviewed', check: '= true' },
      satisfied: false,
      reason: 'peer-reviewed = true (currently: unset)',
    });
    assert.strictEqual(gate.label, 'peer-reviewed');
    assert.strictEqual(gate.kind, 'field');
    assert.strictEqual(gate.check, '= true');
  });
});

describe('nextColumnId', () => {
  const cols = ['todo', 'doing', 'review', 'done'];

  test('returns the column after the current one', () => {
    assert.strictEqual(nextColumnId(cols, 'todo'), 'doing');
    assert.strictEqual(nextColumnId(cols, 'review'), 'done');
  });

  test('the last column, an unknown column and no column have no next', () => {
    assert.strictEqual(nextColumnId(cols, 'done'), undefined);
    assert.strictEqual(nextColumnId(cols, 'nope'), undefined);
    assert.strictEqual(nextColumnId(cols, undefined), undefined);
    assert.strictEqual(nextColumnId([], 'todo'), undefined);
  });
});

describe('collectGatePrompts', () => {
  test('keys every enter/exit gate by column and direction, filling defaults', () => {
    const columns: Column[] = [
      {
        id: 'doing',
        name: 'Doing',
        color: '#fff',
        cardIds: [],
        exit: [{ id: 'tests', script: 'bun test', prompt: 'Run the suite.' }],
      },
      {
        id: 'done',
        name: 'Done',
        color: '#fff',
        cardIds: [],
        enter: [{ id: 'signoff', field: 'approved', check: '= true' }],
      },
    ];
    assert.deepStrictEqual(collectGatePrompts(columns), [
      { key: 'doing:exit:tests', prompt: 'Run the suite.' },
      {
        key: 'done:enter:signoff',
        prompt: 'Set the `approved` field so that it satisfies `= true`.',
      },
    ]);
  });

  test('gatePromptKey separates identical gate ids on different columns', () => {
    assert.notStrictEqual(
      gatePromptKey('doing', 'exit', 'tests'),
      gatePromptKey('done', 'enter', 'tests'),
    );
  });

  test('a board with no gates yields nothing', () => {
    assert.deepStrictEqual(
      collectGatePrompts([{ id: 'todo', name: 'Todo', color: '#fff', cardIds: [] }]),
      [],
    );
  });
});
