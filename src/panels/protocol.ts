import { BoardData, CustomFieldValue, RepoDocConfig } from '../core/types';

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
  /** Configured reading width: 'narrow' | 'wide' | 'full' (sizes the modal). */
  readingWidth: string;
  /** The author name prefilled in the comment composer. */
  commentAuthor: string;
}


/** Host-driven card open (tests / automation) — mirrors clicking the card. */
export interface OpenCardMessage {
  type: 'openCard';
  cardId: string;
}

/** One unsatisfied (or satisfied) gate as reported to the webview. */
export interface MoveBlockedGate {
  id: string;
  label: string;
  satisfied: boolean;
  reason: string;
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

export type WebviewToHostMessage =
  | ReadyMessage
  | MoveCardMessage
  | AddCardMessage
  | AddColumnMessage
  | ToggleCheckMessage
  | SetFieldMessage
  | AddCommentMessage
  | OpenFileMessage;
