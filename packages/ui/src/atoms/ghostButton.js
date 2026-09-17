import { h } from '../dom.js';

/**
 * The modal's quiet action button — Edit, Add, Reload, Keep mine, and the card
 * view's `HEAD → working tree` toggle, which reuses it rather than growing its
 * own chrome.
 *
 * MIRROR: `media/board.js` — `.ghost-btn` call sites.
 */
/**
 * @param {{ label: string, on?: boolean | undefined, title?: string | undefined, onClick?: ((e: Event) => void) | undefined }} props
 * @returns {HTMLElement}
 */
export function GhostButton({ label, on = false, title, onClick }) {
  return h(
    'button',
    {
      type: 'button',
      class: `ghost-btn${on ? ' git-toggle is-on' : ''}`,
      title,
      onClick,
    },
    label,
  );
}
