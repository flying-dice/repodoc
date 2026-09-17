import { ICON, Icon } from '../atoms/icon.js';
import { h } from '../dom.js';

/**
 * The board's top bar: the breadcrumb, then the search box pushed to the right.
 *
 * The noun is passed in rather than assumed: the same surface renders a board
 * of cards and a set of features, and "Search cards" on a feature set would be
 * a small lie in a prominent place.
 *
 * MIRROR: `media/board.js` — `buildTopBar`.
 *
 * @param {{
 *   name: string,
 *   noun?: string | undefined,
 *   query?: string | undefined,
 *   onInput?: ((e: Event) => void) | undefined,
 * }} props
 * @returns {HTMLElement}
 */
export function TopBar({ name, noun = 'cards', query = '', onInput }) {
  const crumb = h('div', { class: 'crumb' }, [
    h('span', { class: 'crumb-section' }, 'Boards'),
    h('span', { class: 'crumb-sep' }, '/'),
    h('span', { class: 'crumb-leaf' }, name),
  ]);
  const searchInput = /** @type {HTMLInputElement} */ (
    h('input', { id: 'search-input', placeholder: `Search ${noun}`, onInput })
  );
  searchInput.value = query;
  const search = h('div', { class: 'search' }, [Icon(ICON.search), searchInput]);
  return h('div', { class: 'topbar' }, [
    crumb,
    h('div', { class: 'topbar-spacer' }),
    h('div', { class: 'topbar-right' }, [search]),
  ]);
}
