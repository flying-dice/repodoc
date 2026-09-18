import { h } from '../dom.js';
import { ICON, Icon } from './icon.js';

/**
 * The exit-gate count on a card face: how many of the column's exit gates this
 * card satisfies. The tooltip lists each one, ticked or not, so the count is
 * never the only thing a reader gets.
 *
 * Takes already-evaluated gates: evaluation is core's job
 * (`evaluateTransition`), and a component that re-implemented it would be a
 * second opinion on whether a card may move.
 *
 * MIRROR: `media/board.js` — `exitGateChip`.
 *
 * @param {{ gates: Array<{ label: string, satisfied: boolean }> }} props
 * @returns {HTMLElement | null}
 */
export function GateChip({ gates }) {
  if (!gates || gates.length === 0) {
    return null;
  }
  const satisfied = gates.filter((g) => g.satisfied).length;
  const labels = gates.map((g) => `${g.satisfied ? '✓ ' : '○ '}${g.label}`);
  return h(
    'span',
    {
      class: `gate-chip${satisfied >= gates.length ? ' ok' : ''}`,
      title: `Exit gates\n${labels.join('\n')}`,
    },
    [Icon(ICON.shield, 'icon'), `${satisfied}/${gates.length}`],
  );
}
