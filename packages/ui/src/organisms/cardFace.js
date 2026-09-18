import { ICON, Icon } from '../atoms/icon.js';
import { LabelChip } from '../atoms/labelChip.js';
import { PriorityDot } from '../atoms/priorityDot.js';
import { h } from '../dom.js';
import { CardMetaRow } from '../molecules/cardMetaRow.js';
import { LiveBlock } from '../molecules/liveBlock.js';

/**
 * A card as it appears on the board.
 *
 * Composed from the meta row and live block rather than rebuilding them, so a
 * change to how a card reports its state lands in one place.
 *
 * Gates and fields arrive already evaluated and already labelled: deciding
 * whether a gate passes is core's job, and a component with its own opinion on
 * it would be a second answer to "may this card move".
 *
 * MIRROR: `media/board.js` — `buildCard`.
 */
/**
 * @typedef {{
 *   card: {
 *     id: string,
 *     title: string,
 *     priority?: string | undefined,
 *     agent?: string | undefined,
 *     live?: boolean | undefined,
 *     status?: string | undefined,
 *     progress?: number | undefined,
 *   },
 *   labels?: Array<{ name: string, color: string }> | undefined,
 *   gitStatus?: 'added' | 'modified' | 'renamed' | undefined,
 *   comments?: number | undefined,
 *   checklist?: { done: number, total: number } | undefined,
 *   gates?: Array<{ label: string, satisfied: boolean }> | undefined,
 *   fields?: Array<{ label: string, value: unknown, type?: string | undefined }> | undefined,
 *   updated?: string | undefined,
 *   onCopyRef?: ((e: Event) => void) | undefined,
 * }} CardFaceProps
 */

/**
 * @param {CardFaceProps} props
 * @returns {HTMLElement}
 */
export function CardFace({
  card,
  labels = [],
  gitStatus,
  comments = 0,
  checklist,
  gates,
  fields = [],
  updated,
  onCopyRef,
}) {
  const children = [];

  if (labels.length > 0) {
    children.push(
      h(
        'div',
        { class: 'card-labels' },
        labels.map((l) => LabelChip(l)),
      ),
    );
  }

  children.push(
    h('div', { class: 'card-titlerow' }, [
      PriorityDot({ priority: card.priority }),
      h('div', { class: 'card-title' }, card.title),
    ]),
  );

  // The id is what every CLI command and chat message references — always
  // visible, with a one-click copy of the full ref beside it.
  children.push(
    h('div', { class: 'card-idrow' }, [
      h('code', { class: 'card-id', title: 'Card id' }, card.id),
      h(
        'button',
        {
          class: 'card-copy',
          title: 'Copy ref',
          'aria-label': `Copy ref for ${card.id}`,
          onClick: onCopyRef,
        },
        Icon(ICON.copy, 'icon'),
      ),
    ]),
  );

  if (card.live) {
    children.push(LiveBlock({ status: card.status, progress: card.progress }));
  }

  children.push(
    CardMetaRow({
      checklist,
      comments,
      gates,
      fields,
      gitStatus,
      updated,
      agent: card.agent,
    }),
  );

  return h('div', { class: 'card', dataset: { cardId: card.id } }, children);
}
