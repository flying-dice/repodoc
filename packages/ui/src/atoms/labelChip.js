import { h } from '../dom.js';

/**
 * A board label, tinted from the colour its config declares.
 *
 * MIRROR: `media/board.js` — `labelChip` and `tintStyle`.
 */
/**
 * @param {string} color
 * @returns {string}
 */
export function tintStyle(color) {
  return `color:${color};background:${color}22;border:1px solid ${color}44;`;
}

/**
 * @param {{ name: string, color: string }} props
 * @returns {HTMLElement}
 */
export function LabelChip({ name, color }) {
  return h('span', { class: 'label-chip', style: tintStyle(color) }, name);
}
