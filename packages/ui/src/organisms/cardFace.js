import { AgentAvatar } from '../atoms/agentAvatar.js';
import { CardGitBadge } from '../atoms/cardGitBadge.js';
import { LabelChip } from '../atoms/labelChip.js';
import { PriorityDot } from '../atoms/priorityDot.js';
import { h } from '../dom.js';

/**
 * A card as it appears on the board.
 *
 * PARTIAL. This covers the labels, title row, id row and meta row of
 * `buildCard`. The live block, gate chips and show-on-card field chips are not
 * extracted yet — they depend on board config and gate evaluation that this
 * package does not carry. Extracting them is the rest of #21, not an omission
 * this story is pretending away.
 *
 * MIRROR: `media/board.js` — `buildCard`.
 */
/**
 * @param {{
 *   card: { id: string, title: string, priority?: string | undefined, agent?: string | undefined },
 *   labels?: Array<{ name: string, color: string }> | undefined,
 *   gitStatus?: 'added' | 'modified' | 'renamed' | undefined,
 *   commentCount?: number | undefined,
 *   updated?: string | undefined,
 * }} props
 * @returns {HTMLElement}
 */
export function CardFace({ card, labels = [], gitStatus, commentCount = 0, updated }) {
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

  children.push(
    h('div', { class: 'card-idrow' }, [h('code', { class: 'card-id', title: 'Card id' }, card.id)]),
  );

  const meta = [];
  if (commentCount > 0) {
    meta.push(h('span', { class: 'meta-item' }, String(commentCount)));
  }
  if (gitStatus) {
    meta.push(CardGitBadge({ status: gitStatus }));
  }
  meta.push(h('div', { class: 'meta-spacer' }));
  if (updated) {
    meta.push(h('span', { class: 'meta-updated' }, updated));
  }
  if (card.agent) {
    meta.push(AgentAvatar({ name: card.agent }));
  }
  children.push(h('div', { class: 'card-meta' }, meta));

  return h('div', { class: 'card', dataset: { cardId: card.id } }, children);
}
