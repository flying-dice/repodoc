import { BoardData, RepoDocConfig } from '../core/types';

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
}


/** Host-driven card open (tests / automation) — mirrors clicking the card. */
export interface OpenCardMessage {
  type: 'openCard';
  cardId: string;
}

export type HostToWebviewMessage = DataMessage | OpenCardMessage;

/** Messages sent from the webview up to the extension host. */
export interface ReadyMessage {
  type: 'ready';
}

export interface MoveCardMessage {
  type: 'moveCard';
  cardId: string;
  toColumn: string;
  index: number;
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
  | ToggleCheckMessage;
