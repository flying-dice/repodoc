import { h } from '../dom.js';

/**
 * The priority dot on a card face. Only high and medium draw one — an unset
 * priority is "None", not a quieter dot, and low does not earn the ink.
 *
 * MIRROR: `media/board.js` — the `priority-dot` branch of `buildCard`.
 */
/** @type {Record<string, string>} */
const PRIORITY_TOKEN = {
  high: '--vscode-charts-red',
  med: '--vscode-charts-yellow',
};

/**
 * @param {{ priority?: string | undefined }} props
 * @returns {HTMLElement | null}
 */
export function PriorityDot({ priority }) {
  const token = priority === undefined ? undefined : PRIORITY_TOKEN[priority];
  if (!token) {
    return null;
  }
  const color = `var(${token})`;
  const glowAlpha = priority === 'high' ? '18%' : '16%';
  const glow = `color-mix(in srgb, ${color} ${glowAlpha}, transparent)`;
  return h('span', {
    class: 'priority-dot',
    title: 'Priority',
    style: `background:${color};box-shadow:0 0 0 3px ${glow};`,
  });
}
