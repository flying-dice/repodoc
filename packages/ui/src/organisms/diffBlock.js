import { h } from '../dom.js';

/**
 * A run of added or removed blocks inside a rendered document.
 *
 * This is the component the 0.9.0/0.9.1 defect hid in. The markup was always
 * right; a merge nested `.diff-add` and `.diff-del` inside another rule, so the
 * document rendered its old and new text with no marking on either while the
 * legend cheerfully reported the counts. A story that renders this against the
 * real `base.css` shows that immediately.
 *
 * MIRROR: `src/panels/diffView.ts` — `renderMarkdownDiff`, which emits the same
 * wrappers as an HTML string.
 */
/**
 * @typedef {{ op: 'same' | 'add' | 'del', html: string }} Run
 *
 * @param {Run} props
 * @returns {HTMLElement}
 */
export function DiffRun({ op, html }) {
  if (op === 'same') {
    return h('div', { html });
  }
  const label = op === 'add' ? 'added' : 'removed';
  return h('div', { class: `diff-run diff-${op}`, role: 'group', 'aria-label': label, html });
}

/** A whole document in diff mode: runs in order, inside the reading column. */
/**
 * @param {{ runs: Run[] }} props
 * @returns {HTMLElement}
 */
export function DiffDocument({ runs }) {
  return h(
    'div',
    { class: 'adr-md' },
    runs.map((run) => DiffRun(run)),
  );
}
