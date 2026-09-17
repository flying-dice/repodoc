import { h } from '../dom.js';

/**
 * A custom field shown on the card face. A boolean renders its label alone when
 * true and nothing when false — "Blocked: no" is noise on a card.
 *
 * MIRROR: `media/board.js` — `showOnCardChip`.
 *
 * @param {{ label: string, value: unknown, type?: string | undefined }} props
 * @returns {HTMLElement | null}
 */
export function FieldChip({ label, value, type }) {
  if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) {
    return null;
  }
  if (type === 'boolean') {
    return value ? h('span', { class: 'field-chip' }, label) : null;
  }
  const shown = Array.isArray(value) ? value.join(', ') : String(value);
  return h('span', { class: 'field-chip' }, `${label}: ${shown}`);
}
