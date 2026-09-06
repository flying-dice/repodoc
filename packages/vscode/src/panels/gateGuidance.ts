/**
 * Pure gate-guidance helpers — no `vscode` import, so they run under plain unit
 * tests (like `readingWidthValue.ts`).
 *
 * The prompt wording itself is owned by core (`gatePromptText`), so the blocked-
 * move dialog and a refused `repodoc card move` say the same thing.
 */

import { type Column, type GateResult, gatePromptText } from '@repodoc/core';
import type { MoveBlockedGate } from './protocol';

/**
 * Project a core {@link GateResult} onto the webview's {@link MoveBlockedGate}.
 * `promptHtml` is filled in by the caller (host-side markdown rendering).
 */
export function toBlockedGate(result: GateResult): MoveBlockedGate {
  const gate = result.gate;
  return {
    id: gate.id,
    label: gate.label ?? gate.id,
    reason: result.reason,
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
