import { h } from '../dom.js';
import { CardFace } from './cardFace.js';

/**
 * A board column: a header carrying its dot, name and count, then its cards.
 *
 * A WIP limit is marked only once it is **exceeded** — a column sitting exactly
 * on its limit is at capacity, not over it, and colouring that would cry wolf
 * on every full column.
 *
 * The limit marks the header rather than refusing anything. It is a signal to a
 * human; gates are enforced in core, and only on a move.
 *
 * MIRROR: `media/board.js` — `buildColumn`.
 *
 * @param {{
 *   name: string,
 *   color: string,
 *   wip?: number | undefined,
 *   cards?: Array<import('./cardFace.js').CardFaceProps> | undefined,
 * }} props
 * @returns {HTMLElement}
 */
export function Column({ name, color, wip, cards = [] }) {
  const total = cards.length;
  const head = [
    h('span', { class: 'col-dot', style: `background:${color};` }),
    h('span', { class: 'col-name' }, name),
    h('span', { class: 'col-count' }, String(total)),
    h('div', { class: 'col-head-spacer' }),
  ];
  if (wip) {
    const over = total > wip;
    head.push(
      h(
        'span',
        { class: `wip${over ? ' over' : ''}`, title: 'Work-in-progress limit' },
        `${total}/${wip}`,
      ),
    );
  }
  return h('div', { class: 'column' }, [
    h('div', { class: 'col-head' }, head),
    h(
      'div',
      { class: 'card-list' },
      cards.map((card) => CardFace(card)),
    ),
  ]);
}
