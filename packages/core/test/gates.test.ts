import { describe, test } from 'bun:test';
import * as assert from 'assert';
import { checkValue, evaluateGates, evaluateTransition } from '../src/gates';
import { Card, Column, CustomFieldValue, GateDef } from '../src/types';

function baseCard(over: Partial<Card> = {}): Card {
  return { id: 'card', title: 'Card', ...over };
}

function col(id: string, over: Partial<Column> = {}): Column {
  return { id, name: id, color: '#000', cardIds: [], ...over };
}

function one(card: Card, gate: GateDef): { satisfied: boolean; reason: string } {
  const [r] = evaluateGates(card, [gate]);
  return { satisfied: r.satisfied, reason: r.reason };
}

describe('gates — script kind', () => {
  const gate: GateDef = { id: 'ci', script: 'npm test' };

  test('satisfied by a done evidence line; reason is the note when present', () => {
    const card = baseCard({ gates: [{ gateId: 'ci', done: true, note: 'passed' }] });
    assert.deepStrictEqual(one(card, gate), { satisfied: true, reason: 'passed' });
  });

  test('done without a note falls back to a ran-command reason', () => {
    const card = baseCard({ gates: [{ gateId: 'ci', done: true }] });
    assert.deepStrictEqual(one(card, gate), { satisfied: true, reason: 'ran `npm test`' });
  });

  test('no evidence (or not done) is unsatisfied with a green-run reason', () => {
    assert.deepStrictEqual(one(baseCard(), gate), {
      satisfied: false,
      reason: 'no recorded green run of `npm test`',
    });
    const notDone = baseCard({ gates: [{ gateId: 'ci', done: false }] });
    assert.strictEqual(one(notDone, gate).satisfied, false);
  });

  test('reason falls back to the gate id when the script is empty', () => {
    const idGate: GateDef = { id: 'lint', script: '' };
    // An empty script is treated as a field gate by normalization, but gates.ts
    // is defensive: a bare {script:''} still evaluates as a script gate here
    // because script is defined. The reason names the id.
    assert.strictEqual(one(baseCard(), idGate).reason, 'no recorded green run of `lint`');
  });
});

describe('gates — field kind', () => {
  test('default (no check) means nonempty; reason names the field and value', () => {
    const gate: GateDef = { id: 'g', field: 'sev' };
    assert.deepStrictEqual(one(baseCard({ custom: { sev: 'high' } }), gate), {
      satisfied: true,
      reason: 'sev nonempty (currently: high)',
    });
    assert.deepStrictEqual(one(baseCard(), gate), {
      satisfied: false,
      reason: 'sev nonempty (currently: unset)',
    });
  });

  test('equality check reports the field, check, and current value', () => {
    const gate: GateDef = { id: 'g', field: 'sign-off', check: '= approved' };
    assert.deepStrictEqual(one(baseCard({ custom: { 'sign-off': 'approved' } }), gate), {
      satisfied: true,
      reason: 'sign-off = approved (currently: approved)',
    });
    assert.deepStrictEqual(one(baseCard(), gate), {
      satisfied: false,
      reason: 'sign-off = approved (currently: unset)',
    });
  });

  test('uses the gate label or id in the reason when field is unset', () => {
    // field is always set on a normalized field gate, but the fallback chain is
    // field -> label -> id; exercise the field path (the normal case).
    const gate: GateDef = { id: 'g', field: 'estimate', check: '>= 3' };
    assert.strictEqual(one(baseCard({ custom: { estimate: 5 } }), gate).satisfied, true);
    assert.strictEqual(
      one(baseCard({ custom: { estimate: 5 } }), gate).reason,
      'estimate >= 3 (currently: 5)',
    );
  });

  test('multi-value current display joins arrays with a comma', () => {
    const gate: GateDef = { id: 'g', field: 'tags', check: 'contains urgent' };
    assert.deepStrictEqual(one(baseCard({ custom: { tags: ['ops', 'urgent'] } }), gate), {
      satisfied: true,
      reason: 'tags contains urgent (currently: ops, urgent)',
    });
  });

  test('falls back to reserved card props for known field ids', () => {
    const gate: GateDef = { id: 'g', field: 'priority', check: '= high' };
    assert.strictEqual(one(baseCard({ priority: 'high' }), gate).satisfied, true);
    assert.strictEqual(one(baseCard({ priority: 'low' }), gate).satisfied, false);
    const agentGate: GateDef = { id: 'g', field: 'agent' };
    assert.strictEqual(one(baseCard({ agent: 'claude' }), agentGate).satisfied, true);
    assert.strictEqual(one(baseCard(), agentGate).satisfied, false);
  });
});

describe('gates — checkValue mini-syntax', () => {
  const v = (value: CustomFieldValue | undefined, check: string | undefined): boolean =>
    checkValue(value, check);

  test('absent/blank/nonempty checks presence', () => {
    for (const check of [undefined, '', '   ', 'nonempty', 'NONEMPTY']) {
      assert.strictEqual(v('x', check), true, `present ${check}`);
      assert.strictEqual(v(undefined, check), false, `undefined ${check}`);
      assert.strictEqual(v('', check), false, `empty string ${check}`);
      assert.strictEqual(v('   ', check), false, `blank string ${check}`);
      assert.strictEqual(v([], check), false, `empty array ${check}`);
      assert.strictEqual(v(['a'], check), true, `array ${check}`);
    }
  });

  test('empty is the negation of nonempty', () => {
    assert.strictEqual(v(undefined, 'empty'), true);
    assert.strictEqual(v('', 'empty'), true);
    assert.strictEqual(v([], 'empty'), true);
    assert.strictEqual(v('x', 'empty'), false);
    assert.strictEqual(v(['a'], 'empty'), false);
  });

  test('= and != on scalars compare String(value)', () => {
    assert.strictEqual(v('high', '= high'), true);
    assert.strictEqual(v('low', '= high'), false);
    assert.strictEqual(v(3, '= 3'), true);
    assert.strictEqual(v(true, '= true'), true);
    assert.strictEqual(v(undefined, '= high'), false);
    assert.strictEqual(v('low', '!= high'), true);
    assert.strictEqual(v('high', '!= high'), false);
    assert.strictEqual(v(undefined, '!= high'), true);
  });

  test('= on arrays is true only for a single matching element; != negates', () => {
    assert.strictEqual(v(['x'], '= x'), true);
    assert.strictEqual(v(['x', 'y'], '= x'), false);
    assert.strictEqual(v([], '= x'), false);
    assert.strictEqual(v(['x', 'y'], '!= x'), true);
    assert.strictEqual(v(['x'], '!= x'), false);
  });

  test('numeric comparisons via parseFloat; NaN on either side is false', () => {
    assert.strictEqual(v(5, '> 3'), true);
    assert.strictEqual(v(3, '> 3'), false);
    assert.strictEqual(v(3, '>= 3'), true);
    assert.strictEqual(v(2, '< 3'), true);
    assert.strictEqual(v(3, '<= 3'), true);
    assert.strictEqual(v(3, '<= 2'), false);
    assert.strictEqual(v('5', '> 3'), true); // string coerces
    assert.strictEqual(v('x', '> 3'), false); // NaN value
    assert.strictEqual(v(5, '> abc'), false); // NaN operand
    assert.strictEqual(v(undefined, '> 3'), false); // NaN value
    assert.strictEqual(v(-2.5, '< -1'), true); // floats and signs
  });

  test('contains: substring on strings, membership on arrays, case-insensitive', () => {
    assert.strictEqual(v('Hello World', 'contains world'), true);
    assert.strictEqual(v('Hello', 'contains bye'), false);
    assert.strictEqual(v(['Ops', 'Urgent'], 'contains urgent'), true);
    assert.strictEqual(v(['Ops'], 'contains urg'), false); // membership, not substring
    assert.strictEqual(v(undefined, 'contains x'), false);
  });

  test('match: regex on String(value); any array element; invalid regex is false', () => {
    assert.strictEqual(v('abc123', 'match \\d+'), true);
    assert.strictEqual(v('abc', 'match ^a.c$'), true);
    assert.strictEqual(v('xyz', 'match ^a'), false);
    assert.strictEqual(v(['no', 'yes42'], 'match \\d\\d'), true);
    assert.strictEqual(v('abc', 'match ('), false); // invalid regex
    assert.strictEqual(v(undefined, 'match .'), false);
  });

  test('operand keeps spaces and strips one pair of surrounding quotes', () => {
    assert.strictEqual(v('a b c', '= a b c'), true);
    assert.strictEqual(v('a b c', '= "a b c"'), true);
    assert.strictEqual(v("a b c", "= 'a b c'"), true);
    assert.strictEqual(v('"quoted"', '= ""quoted""'), true); // only the outer pair strips
    assert.strictEqual(v('contains me', 'contains "ins m"'), true);
  });

  test('an unrecognized expression is false', () => {
    assert.strictEqual(v('x', 'wat'), false);
  });
});

describe('gates — evaluateTransition', () => {
  const exit: GateDef = { id: 'e', field: 'sev' };
  const enter: GateDef = { id: 'n', field: 'sev', check: 'nonempty' };

  test('combines the source exit gates with the target enter gates, in order', () => {
    const from = col('a', { exit: [exit] });
    const to = col('b', { enter: [enter] });
    const results = evaluateTransition(baseCard(), from, to);
    assert.deepStrictEqual(
      results.map((r) => r.gate.id),
      ['e', 'n'],
    );
  });

  test('a move within the same column has no gates', () => {
    const same = col('a', { exit: [exit], enter: [enter] });
    assert.deepStrictEqual(evaluateTransition(baseCard(), same, same), []);
  });

  test('an undefined source contributes only the target enter gates', () => {
    const to = col('b', { enter: [enter] });
    const results = evaluateTransition(baseCard(), undefined, to);
    assert.deepStrictEqual(
      results.map((r) => r.gate.id),
      ['n'],
    );
  });
});
