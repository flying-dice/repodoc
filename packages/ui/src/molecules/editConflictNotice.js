import { GhostButton } from '../atoms/ghostButton.js';
import { h } from '../dom.js';

/**
 * Shown when the file moved under an open editor. Neither side wins silently:
 * the text stays put and the human picks.
 *
 * MIRROR: `media/board.js` — `editConflictNotice` and the scenario block's
 * "Changed on disk" strip.
 */
/**
 * @param {{ onReload?: ((e: Event) => void) | undefined, onKeepMine?: ((e: Event) => void) | undefined }} props
 * @returns {HTMLElement}
 */
export function EditConflictNotice({ onReload, onKeepMine }) {
  return h('div', { class: 'scenario-notice', role: 'alert' }, [
    h('span', {}, 'Changed on disk while you were editing.'),
    GhostButton({ label: 'Reload', onClick: onReload }),
    GhostButton({ label: 'Keep mine', onClick: onKeepMine }),
  ]);
}
