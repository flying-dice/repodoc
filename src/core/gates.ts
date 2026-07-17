/**
 * Pure gate evaluation. Given a card and a set of {@link GateDef gates}, decides
 * whether each is satisfied and why. No I/O, no vscode — the store wires this to
 * column transitions and the UI renders the {@link GateResult reasons}.
 *
 * A gate is either a `script` gate or a `field` gate (normalization guarantees
 * exactly one is set):
 *  - script: satisfied when the card's `## Gates` section carries a done
 *    evidence line for the gate id (a recorded green run of the command).
 *  - field: evaluated LIVE against the card's custom (or reserved) field value
 *    using the `check` mini-syntax parsed by {@link checkValue}.
 */

import { Card, Column, CustomFieldValue, GateDef, GateResult } from './types';

/** Evaluates each gate against the card, in order. */
export function evaluateGates(card: Card, gates: GateDef[]): GateResult[] {
  return gates.map((gate) => evaluateGate(card, gate));
}

/**
 * Gates that apply to moving `card` from `from` into `to`: the source column's
 * `exit` gates followed by the target's `enter` gates. A move within the same
 * column (or a no-op) has no gates.
 */
export function evaluateTransition(
  card: Card,
  from: Column | undefined,
  to: Column,
): GateResult[] {
  if (from && from.id === to.id) {
    return [];
  }
  const gates = [...(from?.exit ?? []), ...(to.enter ?? [])];
  return evaluateGates(card, gates);
}

/**
 * Evaluate a field `check` expression against a value. The mini-syntax:
 *
 *  - absent/blank check, or `nonempty` → value present && non-empty (arrays:
 *    length > 0; scalars: trimmed string is not '')
 *  - `empty`                → the negation of nonempty
 *  - `= v`                  → String(value) === v (arrays: exactly one element
 *                             equal to v)
 *  - `!= v`                 → the negation of `= v`
 *  - `> n` `>= n` `< n` `<= n` → numeric compare via parseFloat on both sides;
 *                             false when either side is NaN
 *  - `contains v`           → string: case-insensitive substring; array:
 *                             case-insensitive membership
 *  - `match re`             → new RegExp(re) tested against String(value)
 *                             (arrays: any element matches); invalid regex → false
 *
 * `v` is everything after the operator token, trimmed; a paired surrounding
 * quote (single or double) is stripped. An unrecognized expression is false.
 */
export function checkValue(value: CustomFieldValue | undefined, check: string | undefined): boolean {
  const expr = (check ?? '').trim();
  const lower = expr.toLowerCase();
  if (expr === '' || lower === 'nonempty') {
    return isNonEmpty(value);
  }
  if (lower === 'empty') {
    return !isNonEmpty(value);
  }

  const word = /^(contains|match)\b([\s\S]*)$/i.exec(expr);
  if (word) {
    const operand = stripQuotes(word[2].trim());
    return word[1].toLowerCase() === 'contains'
      ? containsCheck(value, operand)
      : matchCheck(value, operand);
  }

  const sym = /^(!=|>=|<=|=|>|<)([\s\S]*)$/.exec(expr);
  if (sym) {
    const operand = stripQuotes(sym[2].trim());
    switch (sym[1]) {
      case '=':
        return equalsCheck(value, operand);
      case '!=':
        return !equalsCheck(value, operand);
      case '>':
      case '>=':
      case '<':
      case '<=':
        return numericCheck(value, sym[1], operand);
    }
  }

  return false;
}

// ---------------------------------------------------------------------------

function evaluateGate(card: Card, gate: GateDef): GateResult {
  if (gate.script !== undefined) {
    return scriptResult(card, gate);
  }
  if (gate.field !== undefined) {
    return fieldResult(card, gate);
  }
  // Should not happen once a gate is normalized — treat as a no-op pass.
  return { gate, satisfied: true, reason: gate.label ?? gate.id };
}

/** Satisfied when the card records a done evidence line for this gate id. */
function scriptResult(card: Card, gate: GateDef): GateResult {
  const evidence = (card.gates ?? []).find((g) => g.gateId === gate.id && g.done);
  const script = gate.script || gate.id;
  if (evidence) {
    return { gate, satisfied: true, reason: evidence.note ?? `ran \`${script}\`` };
  }
  return { gate, satisfied: false, reason: `no recorded green run of \`${script}\`` };
}

/** Evaluates the `check` expression live against the card's field value. */
function fieldResult(card: Card, gate: GateDef): GateResult {
  const fieldId = gate.field ?? '';
  const value = resolveFieldValue(card, fieldId);
  const name = gate.field ?? gate.label ?? gate.id;
  const satisfied = checkValue(value, gate.check);
  const checkText = (gate.check ?? '').trim() || 'nonempty';
  return { gate, satisfied, reason: `${name} ${checkText} (currently: ${displayValue(value)})` };
}

/** How the current field value reads in a gate reason. */
function displayValue(value: CustomFieldValue | undefined): string {
  if (!isNonEmpty(value)) {
    return 'unset';
  }
  return Array.isArray(value) ? value.join(', ') : String(value);
}

function equalsCheck(value: CustomFieldValue | undefined, operand: string): boolean {
  if (Array.isArray(value)) {
    return value.length === 1 && String(value[0]) === operand;
  }
  return value !== undefined && String(value) === operand;
}

function numericCheck(
  value: CustomFieldValue | undefined,
  op: '>' | '>=' | '<' | '<=',
  operand: string,
): boolean {
  const a = parseFloat(scalarString(value));
  const b = parseFloat(operand);
  if (Number.isNaN(a) || Number.isNaN(b)) {
    return false;
  }
  switch (op) {
    case '>':
      return a > b;
    case '>=':
      return a >= b;
    case '<':
      return a < b;
    case '<=':
      return a <= b;
  }
}

function containsCheck(value: CustomFieldValue | undefined, operand: string): boolean {
  const needle = operand.toLowerCase();
  if (Array.isArray(value)) {
    return value.some((el) => String(el).toLowerCase() === needle);
  }
  if (value === undefined) {
    return false;
  }
  return String(value).toLowerCase().includes(needle);
}

function matchCheck(value: CustomFieldValue | undefined, operand: string): boolean {
  let re: RegExp;
  try {
    re = new RegExp(operand);
  } catch {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((el) => re.test(String(el)));
  }
  if (value === undefined) {
    return false;
  }
  return re.test(String(value));
}

/** A scalar string for numeric compares — arrays join with ','; undefined is ''. */
function scalarString(value: CustomFieldValue | undefined): string {
  if (value === undefined) {
    return '';
  }
  return Array.isArray(value) ? value.join(',') : String(value);
}

/** Strips one pair of matching surrounding quotes (single or double). */
function stripQuotes(s: string): string {
  if (s.length >= 2 && (s[0] === '"' || s[0] === "'") && s[s.length - 1] === s[0]) {
    return s.slice(1, -1);
  }
  return s;
}

/** The field value, preferring custom fields and falling back to reserved props. */
function resolveFieldValue(card: Card, fieldId: string): CustomFieldValue | undefined {
  if (card.custom && fieldId in card.custom) {
    return card.custom[fieldId];
  }
  switch (fieldId) {
    case 'agent':
      return card.agent;
    case 'priority':
      return card.priority;
    case 'labels':
      return card.labels;
    case 'live':
      return card.live;
    case 'status':
      return card.status;
    case 'progress':
      return card.progress;
    case 'title':
      return card.title;
    case 'updatedAt':
      return card.updatedAt;
    case 'id':
      return card.id;
    default:
      return undefined;
  }
}

function isNonEmpty(value: CustomFieldValue | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return String(value).trim() !== '';
}
