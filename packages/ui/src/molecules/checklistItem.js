import { h } from '../dom.js';

/**
 * One checklist line in the card modal.
 *
 * A real `<input type="checkbox">` with a real `<label for>`: focusable,
 * Space-operable, and announced with its checked state. The visual box is CSS
 * on the input, so nothing here reimplements a control the platform already has.
 *
 * MIRROR: `media/board.js` — the item nodes of `modalChecklist`.
 *
 * @param {{
 *   id: string,
 *   text: string,
 *   done: boolean,
 *   disabled?: boolean | undefined,
 *   onToggle?: ((e: Event) => void) | undefined,
 * }} props
 * @returns {HTMLElement}
 */
export function ChecklistItem({ id, text, done, disabled = false, onToggle }) {
  const box = /** @type {HTMLInputElement} */ (
    h('input', { type: 'checkbox', id, class: 'check-box', onChange: onToggle })
  );
  box.checked = done === true;
  box.disabled = disabled;
  return h('div', { class: 'check-item' }, [
    box,
    h('label', { class: `check-text${done ? ' done' : ''}`, for: id }, text),
  ]);
}
