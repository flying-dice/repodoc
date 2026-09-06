/**
 * Pure card-ordering math for drag-and-drop moves. Given the current card
 * entries (in global order) and a requested move, computes the new global slug
 * order. No I/O, no vscode — trivially unit-testable.
 */

/** The minimal per-card facts the ordering computation needs. */
export interface OrderEntry {
  slug: string;
  column: string;
}

/**
 * New global slug order after moving `cardId` into `toColumnId` at visual
 * position `index` within that column. `index` may be negative or past the
 * column's end; both clamp to the column's top/bottom. Callers guarantee
 * `cardId` exists in `entries`.
 */
export function computeCardOrder(
  entries: OrderEntry[],
  cardId: string,
  toColumnId: string,
  index: number,
): string[] {
  const globalOrder = entries.map((e) => e.slug);
  const targetOrder = entries
    .filter((e) => e.column === toColumnId && e.slug !== cardId)
    .map((e) => e.slug);
  const without = globalOrder.filter((s) => s !== cardId);

  let insertPos: number;
  if (targetOrder.length === 0) {
    insertPos = without.length; // empty column — append at global end
  } else {
    const clamped = Math.max(0, Math.min(index, targetOrder.length));
    if (clamped >= targetOrder.length) {
      // Past the end — right after the target column's last card.
      insertPos = without.indexOf(targetOrder[targetOrder.length - 1]) + 1;
    } else {
      // Immediately before the card currently at `index` in the column.
      insertPos = without.indexOf(targetOrder[clamped]);
    }
  }
  const newOrder = without.slice();
  newOrder.splice(insertPos, 0, cardId);
  return newOrder;
}
