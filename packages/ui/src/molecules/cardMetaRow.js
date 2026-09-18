import { AgentAvatar } from '../atoms/agentAvatar.js';
import { CardGitBadge } from '../atoms/cardGitBadge.js';
import { FieldChip } from '../atoms/fieldChip.js';
import { GateChip } from '../atoms/gateChip.js';
import { ICON, Icon } from '../atoms/icon.js';
import { h } from '../dom.js';

/**
 * The foot of a card: counts and chips on the left, time and agent pushed to
 * the right by a spacer.
 *
 * Order matters and is the same one `buildCard` uses — checklist, comments,
 * gates, fields, then git. A reader scanning a column reads down this row, so
 * moving an item changes what they find first.
 *
 * MIRROR: `media/board.js` — the `card-meta` row of `buildCard`.
 *
 * @param {{
 *   checklist?: { done: number, total: number } | undefined,
 *   comments?: number | undefined,
 *   gates?: Array<{ label: string, satisfied: boolean }> | undefined,
 *   fields?: Array<{ label: string, value: unknown, type?: string | undefined }> | undefined,
 *   gitStatus?: 'added' | 'modified' | 'renamed' | undefined,
 *   updated?: string | undefined,
 *   agent?: string | undefined,
 * }} props
 * @returns {HTMLElement}
 */
export function CardMetaRow({
  checklist,
  comments,
  gates,
  fields = [],
  gitStatus,
  updated,
  agent,
}) {
  const meta = [];
  if (checklist && checklist.total > 0) {
    meta.push(
      h('span', { class: 'meta-item' }, [
        Icon(ICON.checklist, 'icon'),
        `${checklist.done}/${checklist.total}`,
      ]),
    );
  }
  if (comments && comments > 0) {
    meta.push(h('span', { class: 'meta-item' }, [Icon(ICON.comment, 'icon'), String(comments)]));
  }
  if (gates && gates.length > 0) {
    meta.push(GateChip({ gates }));
  }
  for (const field of fields) {
    const chip = FieldChip(field);
    if (chip) {
      meta.push(chip);
    }
  }
  if (gitStatus) {
    meta.push(CardGitBadge({ status: gitStatus }));
  }
  meta.push(h('div', { class: 'meta-spacer' }));
  if (updated) {
    meta.push(h('span', { class: 'meta-updated' }, updated));
  }
  if (agent) {
    meta.push(AgentAvatar({ name: agent }));
  }
  return h('div', { class: 'card-meta' }, meta);
}
