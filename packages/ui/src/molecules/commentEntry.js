import { h } from '../dom.js';

/**
 * One entry in a card's comment journal: who, when, and the body rendered
 * host-side through the same markdown pipeline as everything else.
 *
 * `html` arrives already rendered — the webview never parses markdown itself,
 * and the CSP blocks scripts in what it injects. A missing author shows an
 * em dash rather than an empty gap.
 *
 * MIRROR: `media/board.js` — the entry nodes of `modalComments`.
 *
 * @param {{ who?: string | undefined, when: string, html: string }} props
 * @returns {HTMLElement}
 */
export function CommentEntry({ who, when, html }) {
  return h('div', { class: 'comment-entry' }, [
    h('div', { class: 'comment-meta' }, [
      h('span', { class: 'comment-who' }, who || '—'),
      h('span', { class: 'comment-time' }, when),
    ]),
    h('div', { class: 'comment-text content-md', html }),
  ]);
}
