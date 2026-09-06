/**
 * Per-card comment drafts — pure, with no `vscode` import, so they run under
 * plain unit tests (like `gateGuidance.ts` and `metaPatch.ts`).
 *
 * The board webview keeps an unsent comment while a card is closed and
 * reopened, which is friendly — but only for THAT card. A draft is therefore
 * keyed by `<boardId>/<cardId>`; closing a card keeps its entry, submitting
 * clears it, and opening a different card finds nothing of its own.
 *
 * NOTE: `media/board.js` mirrors these functions MANUALLY (the webview is
 * deliberately build-step-free — see the note at the top of `protocol.ts`).
 * Any change here must be reflected by hand in `media/board.js`.
 */

/** Drafts keyed by {@link draftKey}. Treated as immutable by every function here. */
export type DraftMap = Record<string, string>;

/** The key a draft is stored under. Board and card together, never the card alone. */
export function draftKey(boardId: string, cardId: string): string {
  return `${boardId}/${cardId}`;
}

/** The draft for one card, or `''` when that card has none. */
export function getDraft(drafts: DraftMap, boardId: string, cardId: string): string {
  const value = drafts[draftKey(boardId, cardId)];
  return typeof value === 'string' ? value : '';
}

/**
 * Store a card's draft, returning a new map. Text that is empty (or only
 * whitespace) removes the entry instead of leaving a blank one behind, so an
 * emptied composer does not keep the card marked as having a draft.
 */
export function setDraft(
  drafts: DraftMap,
  boardId: string,
  cardId: string,
  text: string,
): DraftMap {
  if (text.trim() === '') {
    return clearDraft(drafts, boardId, cardId);
  }
  return { ...drafts, [draftKey(boardId, cardId)]: text };
}

/** Drop one card's draft (on submit, or on an explicit discard). */
export function clearDraft(drafts: DraftMap, boardId: string, cardId: string): DraftMap {
  const key = draftKey(boardId, cardId);
  if (!Object.hasOwn(drafts, key)) {
    return drafts;
  }
  const next: DraftMap = { ...drafts };
  delete next[key];
  return next;
}
