/**
 * Helpers over a {@link GitPort}'s status list. vscode-free, so both the tree
 * decorations and the board panel share one lookup shape instead of each
 * building their own map.
 */

import { GitFileStatus, GitStatusEntry } from './ports';

/** Index status entries by workspace-relative path for per-file lookup. */
export function statusByPath(entries: GitStatusEntry[]): Map<string, GitFileStatus> {
  return new Map(entries.map((entry) => [entry.path, entry.status]));
}
