import { ICON } from '../atoms/icon.js';
import { h } from '../dom.js';

/**
 * One gate in the blocked-move dialog.
 *
 * The status glyph is a sibling of the body, not a child of it: the row is laid
 * out as glyph-then-content, so nesting the tick inside `gate-main` collapses
 * the column and the text runs over itself.
 *
 * Every gate carries its id beside its label, because `repodoc card gate-pass`
 * takes the id — a reader who can only see the label cannot act on it. A
 * satisfied gate says "Satisfied" rather than showing an empty note.
 *
 * The prompt is the point. A gate that only says "no" makes the board an
 * obstacle; core gives every gate a prompt precisely so both hosts can show the
 * same instructions.
 *
 * MIRROR: `media/board.js` — the gate rows of `buildBlockedDialog`.
 *
 * @param {{
 *   id: string,
 *   label: string,
 *   satisfied: boolean,
 *   reason?: string | undefined,
 *   promptHtml?: string | undefined,
 * }} props
 * @returns {HTMLElement}
 */
export function GateRow({ id, label, satisfied, reason, promptHtml }) {
  const main = [
    h('div', { class: 'gate-label' }, [label, h('span', { class: 'gate-id' }, id)]),
    h('div', { class: 'gate-note' }, satisfied ? 'Satisfied' : reason),
  ];
  if (!satisfied && promptHtml) {
    main.push(h('div', { class: 'gate-prompt content-md', html: promptHtml }));
  }
  return h('div', { class: 'blocked-gate' }, [
    satisfied
      ? h('span', { class: 'gate-status ok', html: ICON.check })
      : h('span', { class: 'gate-status' }),
    h('div', { class: 'gate-main' }, main),
  ]);
}
