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
  const lastInTarget = targetOrder[targetOrder.length - 1];
  if (lastInTarget === undefined) {
    insertPos = without.length; // empty column — append at global end
  } else {
    const clamped = Math.max(0, Math.min(index, targetOrder.length));
    const anchor = targetOrder[clamped];
    insertPos =
      anchor === undefined
        ? // Past the end — right after the target column's last card.
          without.indexOf(lastInTarget) + 1
        : // Immediately before the card currently at `index` in the column.
          without.indexOf(anchor);
  }
  const newOrder = without.slice();
  newOrder.splice(insertPos, 0, cardId);
  return newOrder;
}
