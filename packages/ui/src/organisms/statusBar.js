import { h } from '../dom.js';

/**
 * The strip along the foot of the board naming the directory its data lives in.
 *
 * It is a button, not a label: everything on this board is a file, and the
 * shortest route to the one you want is the point of the whole product.
 *
 * MIRROR: `media/board.js` — `buildStatusBar`.
 *
 * @param {{ path: string, onOpen?: ((e: Event) => void) | undefined }} props
 * @returns {HTMLElement}
 */
export function StatusBar({ path, onOpen }) {
  return h('div', { class: 'statusbar' }, [
    h(
      'button',
      {
        class: 'status-datadir status-link',
        type: 'button',
        title: 'Open the board config',
        onClick: onOpen,
      },
      path,
    ),
    h('div', { class: 'status-spacer' }),
  ]);
}
