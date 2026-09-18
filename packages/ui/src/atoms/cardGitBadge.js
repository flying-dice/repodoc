import { h } from '../dom.js';

/**
 * The SCM status letter on a card face, in the theme's own decoration colours.
 *
 * There is deliberately no `deleted` variant: a deleted card file leaves no card
 * to mark, so a `D` here could never reach the screen.
 *
 * MIRROR: `media/board.js` — the `card-git` chip inside `buildCard`.
 */
/** @type {Array<'added' | 'modified' | 'renamed'>} */
export const CARD_GIT_STATUSES = ['added', 'modified', 'renamed'];

/**
 * @param {{ status: 'added' | 'modified' | 'renamed' }} props
 * @returns {HTMLElement}
 */
export function CardGitBadge({ status }) {
  return h(
    'span',
    { class: `meta-item card-git card-git-${status}`, title: `Uncommitted: ${status}` },
    status.charAt(0).toUpperCase(),
  );
}
