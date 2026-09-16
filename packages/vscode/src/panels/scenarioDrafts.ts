/**
 * Unsaved scenario edits in the board webview — pure, with no `vscode` import,
 * so they run under plain unit tests (like `commentDrafts.ts` and
 * `metaPatch.ts`).
 *
 * A feature's scenarios are edited in place in the card modal, and the modal is
 * rebuilt from scratch every time the host re-posts the board — which happens
 * whenever ANY file in the workspace changes, including the `.feature` file
 * itself. Unsaved text must therefore live outside the DOM, and it must be
 * keyed narrowly enough that it can only ever come back to the block it was
 * typed in: `<boardId>/<cardId>/<index>`.
 *
 * Each draft also remembers the stored value it started from (`base`). That is
 * what makes an external edit visible instead of silent: when the file on disk
 * no longer matches `base`, the block says so and offers Reload / Keep mine
 * rather than overwriting either side.
 *
 * NOTE: `media/board.js` mirrors these functions MANUALLY (the webview is
 * deliberately build-step-free — see the note at the top of `protocol.ts`).
 * Any change here must be reflected by hand in `media/board.js`.
 */

/** The scenario being composed rather than edited. */
export const NEW_SCENARIO = 'new';

/** One block's unsaved state: what is typed, and what it was typed over. */
export interface ScenarioDraft {
  name: string;
  /** The steps textarea, verbatim: one step per line. */
  steps: string;
  /** The stored value when editing began — an external edit no longer matches it. */
  base: { name: string; steps: string };
}

/** Drafts keyed by {@link scenarioDraftKey}. Treated as immutable throughout. */
export type ScenarioDraftMap = Record<string, ScenarioDraft>;

/**
 * The key a draft is stored under. The board, the card AND the index: a draft
 * belongs to one scenario of one feature, never to "the third block" of
 * whatever card is open.
 */
export function scenarioDraftKey(
  boardId: string,
  cardId: string,
  index: number | typeof NEW_SCENARIO,
): string {
  return `${boardId}/${cardId}/${index}`;
}

/** The draft at `key`, or undefined when that block is not being edited. */
export function getScenarioDraft(drafts: ScenarioDraftMap, key: string): ScenarioDraft | undefined {
  return Object.hasOwn(drafts, key) ? drafts[key] : undefined;
}

/** Store a draft, returning a new map. */
export function setScenarioDraft(
  drafts: ScenarioDraftMap,
  key: string,
  draft: ScenarioDraft,
): ScenarioDraftMap {
  return { ...drafts, [key]: draft };
}

/** Drop one draft — on save, on cancel, or when its card is gone. */
export function clearScenarioDraft(drafts: ScenarioDraftMap, key: string): ScenarioDraftMap {
  if (!Object.hasOwn(drafts, key)) {
    return drafts;
  }
  const next: ScenarioDraftMap = { ...drafts };
  delete next[key];
  return next;
}

/** Every draft belonging to one card — used to drop them all when it closes. */
export function clearCardDrafts(
  drafts: ScenarioDraftMap,
  boardId: string,
  cardId: string,
): ScenarioDraftMap {
  const prefix = `${boardId}/${cardId}/`;
  const next: ScenarioDraftMap = {};
  for (const key of Object.keys(drafts)) {
    const draft = drafts[key];
    if (!key.startsWith(prefix) && draft !== undefined) {
      next[key] = draft;
    }
  }
  return next;
}

/**
 * A textarea's text as the `steps` array the host expects: one step per line,
 * CRLF normalised, with the blank lines at the top and bottom dropped (they are
 * how a textarea ends, not content). Blank lines BETWEEN steps are kept — a
 * doc string may contain one.
 */
export function splitSteps(text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length > 0 && (lines[0] ?? '').trim() === '') {
    lines.shift();
  }
  while (lines.length > 0 && (lines[lines.length - 1] ?? '').trim() === '') {
    lines.pop();
  }
  return lines;
}

/** The steps of a scenario as one textarea value — the inverse of {@link splitSteps}. */
export function joinSteps(steps: readonly string[]): string {
  return steps.join('\n');
}

/**
 * Whether the stored scenario has moved away from what a draft was started
 * from — i.e. someone edited the `.feature` file (or another agent did) while
 * an edit was open here. The block then offers Reload / Keep mine instead of
 * one side quietly winning.
 */
export function scenarioChangedUnderDraft(
  draft: ScenarioDraft,
  stored: { name: string; steps: readonly string[] } | undefined,
): boolean {
  if (stored === undefined) {
    return true; // the scenario it was typed over is gone
  }
  return draft.base.name !== stored.name || draft.base.steps !== joinSteps(stored.steps);
}

/** Whether a draft still says exactly what is stored — nothing to save. */
export function draftMatchesStored(
  draft: ScenarioDraft,
  stored: { name: string; steps: readonly string[] } | undefined,
): boolean {
  if (stored === undefined) {
    return false;
  }
  return (
    draft.name.replace(/\s+/g, ' ').trim() === stored.name &&
    joinSteps(splitSteps(draft.steps)) === joinSteps(stored.steps)
  );
}
