/**
 * The one-line explanation for a refused store mutation.
 *
 * Both hosts show it: `repodoc card move` prints it, and the board panel raises
 * it as a warning. Keeping the wording here means a user who works the board in
 * the morning and the CLI in the afternoon is told the same thing by both, and
 * a new {@link StoreError} cannot be added without the compiler demanding one.
 */

import type { StoreError } from './types';

export function storeErrorMessage(error: StoreError): string {
  switch (error.code) {
    case 'unknown-board':
      return `unknown board ${error.boardId}`;
    case 'unknown-card':
      return `unknown card ${error.cardId}`;
    case 'unknown-column':
      return `unknown column ${error.columnId}`;
    case 'duplicate-slugs':
      return `two card files share the slug "${error.slug}"; rename one before reordering`;
    case 'unreadable-card':
      return `could not read card ${error.cardId}`;
    case 'renumber-failed':
      // Deliberately says what DID happen: this is the one error that is a
      // partial success, and a message implying nothing changed would be a lie.
      return `the card moved column, but the files in board ${error.boardId} could not be renumbered and were left as they were; re-run the move once nothing else is holding them open`;
  }
}
