/**
 * Pure gate-guidance helpers — no `vscode` import, so they run under plain unit
 * tests (like `readingWidthValue.ts`).
 *
 * The wording here MUST match the CLI's (`packages/cli/src/commands.ts`
 * `defaultPrompt`): a human reading the blocked-move dialog and an agent
 * reading a refused `card move` should be told the same thing.
 */

import type { Column, GateDef, GateResult } from '@repodoc/core';
import type { MoveBlockedGate } from './protocol';

/**
 * The instructions shown for a gate that declares no `prompt` of its own.
 * Mirrors `defaultPrompt` in the CLI verbatim.
 */
export function defaultGatePrompt(gate: GateDef): string {
  if (gate.script) {
    return `Run \`${gate.script}\` and, only if it exits 0, record the result with gate-pass.`;
  }
  return `Set the \`${gate.field}\` field so that it satisfies \`${gate.check ?? 'nonempty'}\`.`;
}

/** The gate's own prompt when authored, else the shared default wording. */
export function gatePromptText(gate: GateDef): string {
  return gate.prompt ?? defaultGatePrompt(gate);
}

/**
 * Whether a gate is satisfied by recording a script run or by setting a field.
 * A gate declares exactly one of `script` / `field`; a malformed gate with
 * neither is reported as a field gate so the dialog still renders a row.
 */
export function gateKind(gate: GateDef): 'script' | 'field' {
  return gate.script ? 'script' : 'field';
}

/**
 * Project a core {@link GateResult} onto the webview's {@link MoveBlockedGate}.
 * `promptHtml` is filled in by the caller (host-side markdown rendering).
 */
export function toBlockedGate(result: GateResult): MoveBlockedGate {
  const gate = result.gate;
  return {
    id: gate.id,
    label: gate.label ?? gate.id,
    satisfied: result.satisfied,
    reason: result.reason,
    kind: gateKind(gate),
    ...(gate.script !== undefined ? { script: gate.script } : {}),
    ...(gate.field !== undefined ? { field: gate.field } : {}),
    ...(gate.check !== undefined ? { check: gate.check } : {}),
    prompt: gatePromptText(gate),
  };
}

/**
 * Stable key for a gate's rendered prompt in `DataMessage.gatePromptHtml`.
 * Gate ids repeat across columns, so the column and direction are part of it.
 */
export function gatePromptKey(
  columnId: string,
  direction: 'enter' | 'exit',
  gateId: string,
): string {
  return `${columnId}:${direction}:${gateId}`;
}

/**
 * The column a card would move to "next" — the one after its current column in
 * board order. `undefined` for the last column, or when the card's column is
 * not in the list. `media/board.js` mirrors this by hand (see `nextColumnOf`).
 */
export function nextColumnId(
  columnIds: string[],
  currentId: string | undefined,
): string | undefined {
  if (currentId === undefined) {
    return undefined;
  }
  const at = columnIds.indexOf(currentId);
  if (at === -1 || at + 1 >= columnIds.length) {
    return undefined;
  }
  return columnIds[at + 1];
}

/** Every gate prompt on a board's columns, keyed by {@link gatePromptKey}. */
export function collectGatePrompts(columns: Column[]): Array<{ key: string; prompt: string }> {
  const out: Array<{ key: string; prompt: string }> = [];
  for (const column of columns) {
    for (const direction of ['enter', 'exit'] as const) {
      for (const gate of column[direction] ?? []) {
        out.push({
          key: gatePromptKey(column.id, direction, gate.id),
          prompt: gatePromptText(gate),
        });
      }
    }
  }
  return out;
}
