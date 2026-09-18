import { GhostButton } from '../atoms/ghostButton.js';
import { h } from '../dom.js';
import { CardMetaRow } from './cardMetaRow.js';
import { ChecklistItem } from './checklistItem.js';
import { CommentEntry } from './commentEntry.js';
import { EditConflictNotice } from './editConflictNotice.js';
import { GateRow } from './gateRow.js';
import { LiveBlock } from './liveBlock.js';
import { SectionHead } from './sectionHead.js';

export default { title: 'Molecules' };

export const SectionHeads = {
  name: 'Section head',
  render: () =>
    h('div', { style: 'display:flex;flex-direction:column;gap:18px;max-width:560px;' }, [
      SectionHead({ label: 'Description' }),
      SectionHead({ label: 'Description', actions: [GhostButton({ label: 'Edit' })] }),
      SectionHead({
        label: 'Description',
        actions: [GhostButton({ label: 'HEAD → working tree' }), GhostButton({ label: 'Edit' })],
      }),
    ]),
};

export const EditConflict = {
  name: 'Edit conflict notice',
  render: () => h('div', { style: 'max-width:560px;' }, EditConflictNotice({})),
};

export const CardMetaRows = {
  name: 'Card meta row',
  render: () =>
    h('div', { style: 'display:flex;flex-direction:column;gap:18px;max-width:320px;' }, [
      CardMetaRow({ updated: '3h' }),
      CardMetaRow({
        checklist: { done: 2, total: 5 },
        comments: 3,
        gates: [
          { label: 'Tests green', satisfied: true },
          { label: 'Peer reviewed', satisfied: false },
        ],
        fields: [{ label: 'Severity', value: 'high' }],
        gitStatus: 'modified',
        updated: '2h',
        agent: 'starscream',
      }),
    ]),
};

export const LiveBlocks = {
  name: 'Live block',
  render: () =>
    h('div', { style: 'display:flex;flex-direction:column;gap:18px;max-width:320px;' }, [
      LiveBlock({ status: 'editing packages/ui/src/organisms/column.js', progress: 60 }),
      // No progress means no number and no bar — not a 0% bar.
      LiveBlock({ status: 'reviewing' }),
    ]),
};

export const ChecklistItems = {
  name: 'Checklist item',
  render: () =>
    h('div', { style: 'display:flex;flex-direction:column;gap:6px;max-width:420px;' }, [
      ChecklistItem({ id: 'story-check-0', text: 'Extract the atoms', done: true }),
      ChecklistItem({ id: 'story-check-1', text: 'Extract the organisms', done: false }),
      ChecklistItem({
        id: 'story-check-2',
        text: 'Read-only surface',
        done: false,
        disabled: true,
      }),
    ]),
};

export const Comments = {
  name: 'Comment entry',
  render: () =>
    h('div', { style: 'display:flex;flex-direction:column;gap:12px;max-width:560px;' }, [
      CommentEntry({
        who: 'starscream',
        when: '2h',
        html: '<p>Reproduced on the reviewed head before changing anything.</p>',
      }),
      CommentEntry({
        who: 'shockwave-bot',
        when: 'just now',
        html: '<p>Re-measured. <code>812</code> pass / 0 fail.</p>',
      }),
    ]),
};

export const GateRows = {
  name: 'Gate row',
  render: () =>
    h('div', { style: 'display:flex;flex-direction:column;gap:12px;max-width:560px;' }, [
      GateRow({ id: 'tests-green', label: 'Tests green', satisfied: true }),
      GateRow({
        id: 'peer-reviewed',
        label: 'Peer reviewed',
        satisfied: false,
        reason: 'no evidence recorded',
      }),
      GateRow({
        id: 'peer-reviewed',
        label: 'Peer reviewed',
        satisfied: false,
        reason: 'no evidence recorded',
        promptHtml: '<p>Record a review with <code>repodoc card gate-pass</code>.</p>',
      }),
    ]),
};
