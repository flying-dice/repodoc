import { h } from '../dom.js';

/**
 * A card-modal section heading: the label, then actions pushed to the end by a
 * spacer. The Description section uses it to carry Edit and, when the
 * description differs from HEAD, the diff toggle.
 *
 * MIRROR: `media/board.js` — `modalDescription` and the scenario sections.
 */
/**
 * @param {{ label: string, actions?: HTMLElement[] | undefined }} props
 * @returns {HTMLElement}
 */
export function SectionHead({ label, actions = [] }) {
  const children = [h('div', { class: 'field-label', style: 'margin-bottom:0;' }, label)];
  if (actions.length > 0) {
    children.push(h('div', { class: 'section-head-spacer' }));
    for (const action of actions) {
      children.push(action);
    }
  }
  return h('div', { class: 'section-head' }, children);
}
