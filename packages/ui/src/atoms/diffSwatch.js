import { h } from '../dom.js';

/**
 * The legend swatches beside the `HEAD → working tree` toggle.
 *
 * MIRROR: `src/panels/markdownPanel.ts` — `gitBar`, which builds this as an
 * HTML string host-side rather than as DOM.
 */
/**
 * @param {{ kind: 'add' | 'del' }} props
 * @returns {HTMLElement}
 */
export function DiffSwatch({ kind }) {
  return h('span', { class: `git-swatch git-swatch-${kind}` });
}

/** The whole legend: counts, swatches and the render time. */
/**
 * @param {{ added: number, removed: number, elapsedMs: number }} props
 * @returns {HTMLElement}
 */
export function DiffLegend({ added, removed, elapsedMs }) {
  return h('span', { class: 'git-legend' }, [
    DiffSwatch({ kind: 'add' }),
    `${added} added`,
    DiffSwatch({ kind: 'del' }),
    `${removed} removed`,
    h('span', { class: 'git-timing' }, `${elapsedMs} ms`),
  ]);
}
