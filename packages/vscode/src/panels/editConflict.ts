/**
 * The one decision behind "Changed on disk" for the description and title
 * editors — pure, with no `vscode` import, so it runs under plain unit tests
 * (like `scenarioDrafts.ts`, `commentDrafts.ts` and `metaPatch.ts`).
 *
 * A managed editor is opened over a value that was current at that moment. By
 * the time Save is pressed, the file may hold something else: another agent,
 * `repodoc feature describe`, or the human's own editor may have written it.
 * Saving then destroys the newer text, and nothing says so. So every save
 * carries the value it was opened from (`base`), the host compares it with what
 * the store holds now, and a mismatch is refused and reported instead of
 * written — the same Reload / Keep mine choice a scenario block already offers.
 *
 * NOTE: `media/board.js` mirrors these functions MANUALLY (the webview is
 * deliberately build-step-free — see the note at the top of `protocol.ts`).
 * Any change here must be reflected by hand in `media/board.js`.
 */

/** Which editor a conflict belongs to. */
export type EditField = 'description' | 'title';

/**
 * Whether the stored value has moved away from what the editor was opened
 * over. Compared verbatim: the host hands the webview the exact stored string
 * and gets the exact same string back, so any difference at all is someone
 * else's edit and is never guessed away.
 */
export function hasEditConflict(base: string, current: string): boolean {
  return base !== current;
}

/**
 * The `base` field of an inbound save, or undefined when the message did not
 * carry one. Inbound messages are untrusted, and an absent base is not treated
 * as "no conflict": the host refuses the save outright, so a stale webview
 * cannot write through the check by simply omitting the field.
 */
export function editBase(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
