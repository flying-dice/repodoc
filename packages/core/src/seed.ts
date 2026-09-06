/**
 * First-run seed content: just the starter board config. Pure data builder — the
 * store writes it through the FileSystemPort on `init`. Bootstrap deliberately
 * creates config ONLY (never cards, decisions, or docs), so initializing on an
 * existing repo can never touch user content.
 */

import { BoardConfig, DEFAULT_LABELS, defaultColumns } from './boardConfig';

export function seedBoardConfig(): BoardConfig {
  return {
    name: 'Project Backlog',
    columns: defaultColumns(),
    labels: { ...DEFAULT_LABELS },
    fields: [],
  };
}
