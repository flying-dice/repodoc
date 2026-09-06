import type { BoardData, CardMetaPatch, CustomFieldValue, RepoDocConfig } from '@repodoc/core';

/**
 * Authoritative shapes for the board webview postMessage protocol.
 *
 * NOTE: `media/board.js` mirrors this contract MANUALLY. The webview is
 * deliberately build-step-free (plain JS loaded straight into the webview), so
 * there is no shared compilation between this file and board.js. Any change to
 * these shapes must be reflected by hand in media/board.js.
 *
 * Inbound (webview -> host) messages are UNTRUSTED: the discriminated unions
 * below describe their intended shape, but callers must still validate fields
 * at runtime before acting on them.
 */

/**
 * What the surface being shown supports. A feature set has no comments, custom
 * fields, checklists, or configurable columns, so the webview hides those
 * affordances rather than posting messages the host would ignore.
 */
export interface BoardCapabilities {
  comments: boolean;
  fields: boolean;
  checklist: boolean;
  /** Appending new checklist items (not just toggling existing ones). */
  checklistAdd: boolean;
  addColumn: boolean;
  /**
   * Reserved card metadata (title, labels, priority, agent, live, status,
   * progress) is editable. False for feature sets: a feature's title and tags
   * are owned by the `.feature` file, so they are edited there.
   */
  meta: boolean;
  /** The card body text is editable from the modal. */
  description: boolean;
  /** Script-gate evidence can be recorded from the UI. */
  gateEvidence: boolean;
}

/** Messages sent from the extension host down to the webview. */
export interface DataMessage {
  type: 'data';
  boardId: string;
  board: BoardData;
  config: RepoDocConfig;
  /** Display path of the board's data directory, e.g. `boards/<id>/`. */
  boardPath: string;
  /** Card descriptions rendered to HTML (markdown, host-side), keyed by card id. */
  descHtml: Record<string, string>;
  /** Comment journal entries rendered to HTML (shared renderer), per card id. */
  commentHtml: Record<string, string[]>;
  /** Configured reading width: 'narrow' | 'wide' | 'full' (sizes the modal). */
  readingWidth: string;
  /** The author name prefilled in the comment composer. */
  commentAuthor: string;
  /** Which editing affordances this surface supports. */
  capabilities: BoardCapabilities;
  /**
   * Repo-relative file backing each card (`boards/<id>/NN-slug.md`, or a
   * feature's `.feature`), keyed by card id — the modal's "Open file" action.
   * A card whose file cannot be resolved is simply absent.
   */
  cardFiles: Record<string, string>;
  /**
   * Gate `prompt` text rendered to HTML by the shared renderer, keyed by
   * `<columnId>:<enter|exit>:<gateId>` (see `gatePromptKey` in
   * `gateGuidance.ts`). Gates without an authored prompt carry the same default
   * wording the CLI prints.
   */
  gatePromptHtml: Record<string, string>;
  /** Column `prompt` text rendered to HTML, keyed by column id. */
  columnPromptHtml: Record<string, string>;
}

/** Host-driven card open (tests / automation) — mirrors clicking the card. */
export interface OpenCardMessage {
  type: 'openCard';
  cardId: string;
}

/** One gate blocking a move, as reported to the webview. */
export interface MoveBlockedGate {
  id: string;
  label: string;
  reason: string;
  /** Script gates: the command that must have run green. */
  script?: string;
  /** Field gates: the inspected (custom or reserved) field id. */
  field?: string;
  /** Field gates: the check expression the value must satisfy. */
  check?: string;
  /** The gate's instructions, or the CLI's default wording when unauthored. */
  prompt?: string;
  /** `prompt` rendered to HTML by the shared markdown renderer. */
  promptHtml?: string;
}

/**
 * Sent when a `moveCard` (without override) is blocked by one or more unmet
 * column gates. The webview surfaces the gates and can retry with override.
 */
export interface MoveBlockedMessage {
  type: 'moveBlocked';
  cardId: string;
  toColumn: string;
  results: MoveBlockedGate[];
}

export type HostToWebviewMessage = DataMessage | OpenCardMessage | MoveBlockedMessage;

/** Messages sent from the webview up to the extension host. */
export interface ReadyMessage {
  type: 'ready';
}

export interface MoveCardMessage {
  type: 'moveCard';
  cardId: string;
  toColumn: string;
  index: number;
  /** Force the move past any unsatisfied gates (records overrides). */
  override?: boolean;
  /**
   * Why the move was overridden. Required by the host whenever `override` is
   * true and gates are failing — the CLI requires `--reason` too, so both hosts
   * write the same audit line.
   */
  reason?: string;
}

/** Set (or clear, when `value` is null) a card's custom field. */
export interface SetFieldMessage {
  type: 'setField';
  cardId: string;
  fieldId: string;
  value: CustomFieldValue | null;
}

/** Append a journal entry to a card's `## Comments` section. */
export interface AddCommentMessage {
  type: 'addComment';
  cardId: string;
  text: string;
  /** Author name from the composer; the host falls back to the configured
   * comment author, then the local git identity. */
  who?: string;
}

/** Copy the card's pasteable reference (`<scope>/<id> — <title> (<path>)`) to the clipboard. */
export interface CopyRefMessage {
  type: 'copyRef';
  cardId: string;
}

/**
 * Open a repo file (optionally revealing a line range) from a comment link.
 * `path` is relative to the store root; the host containment-checks it before
 * opening. `line`/`endLine` are 1-based.
 */
export interface OpenFileMessage {
  type: 'openFile';
  path: string;
  line?: number;
  endLine?: number;
}

export interface AddCardMessage {
  type: 'addCard';
  column: string;
  title: string;
}

export interface AddColumnMessage {
  type: 'addColumn';
}

export interface ToggleCheckMessage {
  type: 'toggleCheck';
  cardId: string;
  index: number;
}

/** Append an item to a card's `## Checklist` section. */
export interface AddChecklistItemMessage {
  type: 'addChecklistItem';
  cardId: string;
  text: string;
}

/** Replace a card's description (the body above `## Checklist` / `## Gates` / `## Comments`). */
export interface SetDescriptionMessage {
  type: 'setDescription';
  cardId: string;
  text: string;
}

/** Edit reserved card metadata (title/labels/priority/agent/live/status/progress). */
export interface UpdateMetaMessage {
  type: 'updateMeta';
  cardId: string;
  patch: CardMetaPatch;
}

/**
 * Record a green run of a script gate's command. `result` is what the human
 * saw, e.g. "bun test green, 130 unit + 9 e2e"; the host stamps the author and
 * time. Only a run that actually passed may be recorded.
 */
export interface RecordGatePassMessage {
  type: 'recordGatePass';
  cardId: string;
  gateId: string;
  result: string;
}

export type WebviewToHostMessage =
  | ReadyMessage
  | MoveCardMessage
  | AddCardMessage
  | AddColumnMessage
  | ToggleCheckMessage
  | AddChecklistItemMessage
  | SetDescriptionMessage
  | UpdateMetaMessage
  | RecordGatePassMessage
  | SetFieldMessage
  | AddCommentMessage
  | OpenFileMessage
  | CopyRefMessage;
