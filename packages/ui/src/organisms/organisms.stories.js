import { h } from '../dom.js';
import { CardFace } from './cardFace.js';
import { DiffDocument } from './diffBlock.js';

export default { title: 'Organisms' };

export const Cards = {
  name: 'Card face',
  render: () =>
    h('div', { style: 'display:flex;gap:16px;flex-wrap:wrap;max-width:900px;' }, [
      CardFace({
        card: {
          id: 'add-diff-view',
          title: 'Add the diff view',
          priority: 'high',
          agent: 'starscream',
        },
        labels: [{ name: 'feature', color: '#4c8bf5' }],
        gitStatus: 'modified',
        commentCount: 3,
        updated: '2h ago',
      }),
      CardFace({
        card: { id: 'fix-nested-css', title: 'Fix the nested CSS', priority: 'med' },
        gitStatus: 'added',
        updated: 'just now',
      }),
      CardFace({
        card: { id: 'tidy-docs', title: 'Tidy the docs' },
        labels: [{ name: 'docs', color: '#8b949e' }],
        updated: 'yesterday',
      }),
    ]),
};

/**
 * The story that would have caught the 0.9.0 / 0.9.1 defect on sight: added and
 * removed blocks are supposed to be tinted, struck through and gutter-barred.
 * When the rules were nested inside another selector this rendered as plain
 * unmarked prose while the legend still reported its counts.
 */
export const Diff = {
  name: 'Diff document',
  render: () =>
    h('div', { style: 'max-width:760px;' }, [
      DiffDocument({
        runs: [
          { op: 'same', html: '<h1>REQ 002 Configure Participants</h1>' },
          { op: 'same', html: '<h2>Appendix</h2>' },
          { op: 'del', html: '<h3>Participant types and identity — observed poc context</h3>' },
          { op: 'add', html: '<h3>ONE TWO THREE</h3>' },
          {
            op: 'same',
            html: '<p>This section records POC evidence requested during refinement.</p>',
          },
          {
            op: 'del',
            html: '<ul><li>Select the audit delivery guarantee and retry behaviour.</li></ul>',
          },
          {
            op: 'add',
            html: '<ul><li>Guaranteed audit delivery and durable replay are future improvements.</li></ul>',
          },
        ],
      }),
    ]),
};

export const DiffUnchanged = {
  name: 'Diff document — nothing changed',
  render: () =>
    h('div', { style: 'max-width:760px;' }, [
      DiffDocument({
        runs: [
          { op: 'same', html: '<h1>Nothing moved</h1>' },
          { op: 'same', html: '<p>Every block matches HEAD, so nothing is marked.</p>' },
        ],
      }),
    ]),
};
