/**
 * Components rendered into a real DOM and inspected.
 *
 * These cover the decisions the markup encodes — an unset progress is not 0%, a
 * false boolean draws nothing, a checklist box is a real checkbox — rather than
 * snapshotting HTML, which would fail on every whitespace change and pass on
 * every meaningful one.
 */

import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register();

import { describe, test } from 'bun:test';
import * as assert from 'node:assert';
import { AgentAvatar } from '../src/atoms/agentAvatar.js';
import { CardGitBadge } from '../src/atoms/cardGitBadge.js';
import { FieldChip } from '../src/atoms/fieldChip.js';
import { GateChip } from '../src/atoms/gateChip.js';
import { GhostButton } from '../src/atoms/ghostButton.js';
import { PriorityDot } from '../src/atoms/priorityDot.js';
import { relativeTime } from '../src/atoms/relativeTime.js';
import { CardMetaRow } from '../src/molecules/cardMetaRow.js';
import { ChecklistItem } from '../src/molecules/checklistItem.js';
import { GateRow } from '../src/molecules/gateRow.js';
import { LiveBlock } from '../src/molecules/liveBlock.js';
import { BlockedDialog } from '../src/organisms/blockedDialog.js';
import { CardFace } from '../src/organisms/cardFace.js';
import { Column } from '../src/organisms/column.js';
import { DiffDocument } from '../src/organisms/diffBlock.js';
import { TopBar } from '../src/organisms/topBar.js';

describe('atoms', () => {
  test('given a name, when an avatar renders, then its colour is stable across calls', () => {
    const a = AgentAvatar({ name: 'starscream' });
    const b = AgentAvatar({ name: 'starscream' });
    assert.strictEqual(a.getAttribute('style'), b.getAttribute('style'));
    assert.strictEqual(a.textContent, 'S');
  });

  test('given two names, when avatars render, then they do not share a colour', () => {
    const a = AgentAvatar({ name: 'starscream' });
    const b = AgentAvatar({ name: 'thundercracker' });
    assert.notStrictEqual(a.getAttribute('style'), b.getAttribute('style'));
  });

  test('given a two-word name, when an avatar renders, then it takes two initials', () => {
    assert.strictEqual(AgentAvatar({ name: 'Jonathan Turnock' }).textContent, 'JT');
  });

  test('given each status, when a badge renders, then it carries its own class', () => {
    for (const status of ['added', 'modified', 'renamed'] as const) {
      const badge = CardGitBadge({ status });
      assert.ok(badge.className.includes(`card-git-${status}`));
      assert.strictEqual(badge.textContent, status.charAt(0).toUpperCase());
    }
  });

  test('given low or unset priority, when a dot renders, then there is no dot', () => {
    assert.strictEqual(PriorityDot({ priority: 'low' }), null);
    assert.strictEqual(PriorityDot({}), null);
    assert.ok(PriorityDot({ priority: 'high' }));
  });

  test('given a false boolean field, when a chip renders, then nothing is drawn', () => {
    assert.strictEqual(FieldChip({ label: 'Blocked', value: false, type: 'boolean' }), null);
    assert.strictEqual(FieldChip({ label: 'Tags', value: [] }), null);
    assert.strictEqual(FieldChip({ label: 'Note', value: '' }), null);
    assert.strictEqual(
      FieldChip({ label: 'Blocked', value: true, type: 'boolean' })?.textContent,
      'Blocked',
      'a true boolean shows its label alone, not "Blocked: true"',
    );
  });

  test('given an array field, when a chip renders, then the values are joined', () => {
    assert.strictEqual(
      FieldChip({ label: 'Tags', value: ['ui', 'css'] })?.textContent,
      'Tags: ui, css',
    );
  });

  test('given gates, when a chip renders, then it counts the satisfied ones', () => {
    const chip = GateChip({
      gates: [
        { label: 'Tests green', satisfied: true },
        { label: 'Peer reviewed', satisfied: false },
      ],
    });
    assert.ok(chip);
    assert.ok(chip.textContent?.includes('1/2'));
    assert.strictEqual(chip.className.includes('ok'), false);
    assert.ok(
      chip.getAttribute('title')?.includes('○ Peer reviewed'),
      'the tooltip names what is missing',
    );
  });

  test('given every gate satisfied, when a chip renders, then it reads as ok', () => {
    const chip = GateChip({ gates: [{ label: 'Tests green', satisfied: true }] });
    assert.ok(chip?.className.includes('ok'));
  });

  test('given no gates, when a chip renders, then there is no chip', () => {
    assert.strictEqual(GateChip({ gates: [] }), null);
  });

  test('given a toggled button, when it renders, then the on state is marked', () => {
    assert.strictEqual(GhostButton({ label: 'Edit' }).className.includes('is-on'), false);
    assert.ok(GhostButton({ label: 'Hide changes', on: true }).className.includes('is-on'));
  });

  test('given a click handler, when the button is clicked, then it fires', () => {
    let clicked = 0;
    const button = GhostButton({ label: 'Edit', onClick: () => clicked++ });
    button.dispatchEvent(new Event('click'));
    assert.strictEqual(clicked, 1);
  });

  test('given an instant, when relative time renders, then it coarsens with distance', () => {
    const now = Date.parse('2026-09-17T12:00:00Z');
    assert.strictEqual(relativeTime('2026-09-17T11:59:30Z', now), 'just now');
    assert.strictEqual(relativeTime('2026-09-17T11:30:00Z', now), '30m');
    assert.strictEqual(relativeTime('2026-09-17T06:00:00Z', now), '6h');
    assert.strictEqual(relativeTime('2026-09-15T12:00:00Z', now), '2d');
    assert.strictEqual(relativeTime('2026-08-20T12:00:00Z', now), '4w');
  });

  test('given something unparseable, when relative time renders, then it is handed back', () => {
    assert.strictEqual(relativeTime('not a date'), 'not a date');
    assert.strictEqual(relativeTime(undefined), '');
  });
});

describe('molecules', () => {
  test('given no progress, when a live block renders, then there is no bar and no 0%', () => {
    const block = LiveBlock({ status: 'reviewing' });
    assert.strictEqual(block.querySelector('.progress-track'), null);
    assert.strictEqual(block.querySelector('.live-pct'), null);
    assert.strictEqual(
      block.textContent?.includes('0%'),
      false,
      'an unset progress is not "no work done"',
    );
  });

  test('given a progress, when a live block renders, then the bar matches it', () => {
    const block = LiveBlock({ status: 'working', progress: 60 });
    assert.strictEqual(block.querySelector('.live-pct')?.textContent, '60%');
    assert.ok(block.querySelector('.progress-fill')?.getAttribute('style')?.includes('60%'));
  });

  test('given a checklist item, when it renders, then it is a real labelled checkbox', () => {
    const item = ChecklistItem({ id: 'check-a-0', text: 'Extract the atoms', done: true });
    const box = /** @type {HTMLInputElement} */ (item.querySelector('.check-box'));
    assert.strictEqual(box?.tagName, 'INPUT');
    assert.strictEqual(box?.getAttribute('type'), 'checkbox');
    assert.strictEqual((box as HTMLInputElement).checked, true);
    const label = item.querySelector('.check-text');
    assert.strictEqual(label?.getAttribute('for'), 'check-a-0', 'the label drives the box');
    assert.ok(label?.className.includes('done'));
  });

  test('given a read-only surface, when a checklist item renders, then it cannot be toggled', () => {
    const item = ChecklistItem({ id: 'c', text: 'x', done: false, disabled: true });
    assert.strictEqual((item.querySelector('.check-box') as HTMLInputElement).disabled, true);
  });

  test('given an unsatisfied gate, when a row renders, then the reason and id are shown', () => {
    const row = GateRow({
      id: 'peer-reviewed',
      label: 'Peer reviewed',
      satisfied: false,
      reason: 'no evidence recorded',
    });
    assert.ok(row.textContent?.includes('no evidence recorded'));
    assert.strictEqual(
      row.querySelector('.gate-id')?.textContent,
      'peer-reviewed',
      'the id is what `card gate-pass` takes, so it has to be readable',
    );
  });

  test('given a satisfied gate, when a row renders, then the glyph carries the tick', () => {
    const row = GateRow({ id: 'tests', label: 'Tests green', satisfied: true });
    assert.ok(row.querySelector('.gate-status')?.className.includes('ok'));
    assert.strictEqual(
      row.querySelector('.gate-note')?.textContent,
      'Satisfied',
      'a passing gate says so rather than leaving an empty note',
    );
  });

  test('given the row, when it renders, then the glyph is a sibling of the body', () => {
    const row = GateRow({ id: 'g', label: 'g', satisfied: false, reason: 'why' });
    // Nesting the glyph inside gate-main collapses the row's two columns and
    // the text runs over itself — which is exactly what it did at first.
    assert.strictEqual(row.children.length, 2);
    assert.ok(row.children[0]?.className.includes('gate-status'));
    assert.ok(row.children[1]?.className.includes('gate-main'));
  });

  test('given a prompt, when a row renders, then the instructions are shown', () => {
    const row = GateRow({
      id: 'g',
      label: 'g',
      satisfied: false,
      promptHtml: '<p>do the thing</p>',
    });
    assert.ok(row.textContent?.includes('do the thing'));
  });

  test('given nothing to report, when a meta row renders, then only the spacer is there', () => {
    const row = CardMetaRow({});
    assert.strictEqual(row.querySelectorAll('.meta-item').length, 0);
    assert.ok(row.querySelector('.meta-spacer'));
  });

  test('given every signal, when a meta row renders, then they keep their order', () => {
    const row = CardMetaRow({
      checklist: { done: 2, total: 5 },
      comments: 3,
      gates: [{ label: 'g', satisfied: false }],
      fields: [{ label: 'Severity', value: 'high' }],
      gitStatus: 'modified',
      updated: '2h',
      agent: 'starscream',
    });
    const classes = [...row.children].map((c) => c.className);
    const gitAt = classes.findIndex((c) => c.includes('card-git'));
    const spacerAt = classes.findIndex((c) => c.includes('meta-spacer'));
    assert.ok(gitAt > 0 && gitAt < spacerAt, 'git sits with the chips, before the spacer');
    assert.ok(classes[classes.length - 1]?.includes('meta-avatar'));
  });
});

describe('organisms', () => {
  test('given a live card, when the face renders, then the live block is included', () => {
    const face = CardFace({
      card: { id: 'a', title: 'Working', live: true, status: 'editing', progress: 10 },
    });
    assert.ok(face.querySelector('.live-block'));
  });

  test('given a card that is not live, when the face renders, then there is no live block', () => {
    const face = CardFace({ card: { id: 'a', title: 'Idle' } });
    assert.strictEqual(face.querySelector('.live-block'), null);
  });

  test('given a card, when the face renders, then its id is always visible', () => {
    const face = CardFace({ card: { id: 'add-diff-view', title: 'Add the diff view' } });
    assert.strictEqual(
      face.querySelector('.card-id')?.textContent,
      'add-diff-view',
      'the id is what every CLI command and chat message references',
    );
  });

  test('given a column exactly on its WIP limit, when it renders, then it is NOT marked over', () => {
    const atLimit = Column({
      name: 'Doing',
      color: '#000',
      wip: 2,
      cards: [{ card: { id: 'a', title: 'A' } }, { card: { id: 'b', title: 'B' } }],
    });
    assert.strictEqual(
      atLimit.querySelector('.wip')?.className.includes('over'),
      false,
      'at capacity is not over capacity; marking it would cry wolf on every full column',
    );
    assert.strictEqual(atLimit.querySelector('.wip')?.textContent, '2/2');
  });

  test('given a column past its WIP limit, when it renders, then it is marked', () => {
    const over = Column({
      name: 'Doing',
      color: '#000',
      wip: 1,
      cards: [{ card: { id: 'a', title: 'A' } }, { card: { id: 'b', title: 'B' } }],
    });
    assert.ok(over.querySelector('.wip')?.className.includes('over'));
  });

  test('given no WIP limit, when a column renders, then no limit is shown', () => {
    const none = Column({
      name: 'Doing',
      color: '#000',
      cards: [{ card: { id: 'a', title: 'A' } }],
    });
    assert.strictEqual(none.querySelector('.wip'), null);
    assert.strictEqual(none.querySelector('.col-count')?.textContent, '1');
  });

  test('given a surface noun, when the top bar renders, then the placeholder uses it', () => {
    const cards = TopBar({ name: 'B' }).querySelector('#search-input');
    const features = TopBar({ name: 'B', noun: 'features' }).querySelector('#search-input');
    assert.strictEqual(cards?.getAttribute('placeholder'), 'Search cards');
    assert.strictEqual(
      features?.getAttribute('placeholder'),
      'Search features',
      'the same surface renders features; "Search cards" there would be a lie',
    );
  });

  test('given a query, when the top bar renders, then the box carries it', () => {
    const bar = TopBar({ name: 'B', query: 'diff' });
    assert.strictEqual((bar.querySelector('#search-input') as HTMLInputElement).value, 'diff');
  });

  test('given unsatisfied gates and no reason, when the dialog renders, then move is unavailable', () => {
    const dialog = BlockedDialog({
      cardTitle: 'A card',
      toColumn: 'Done',
      gates: [{ id: 'peer-reviewed', label: 'Peer reviewed', satisfied: false }],
      overriding: true,
      reason: '   ',
    });
    assert.ok(
      dialog.querySelector('.btn-primary')?.hasAttribute('disabled'),
      'the CLI refuses an override without a reason; the board must not be weaker',
    );
  });

  test('given an override, when the dialog renders, then the reason field is labelled required', () => {
    const dialog = BlockedDialog({
      cardTitle: 'A card',
      toColumn: 'Done',
      gates: [{ id: 'g', label: 'g', satisfied: false }],
      overriding: true,
    });
    assert.ok(dialog.querySelector('.override-box'));
    assert.strictEqual(
      dialog.querySelector('.override-box .field-label')?.textContent,
      'Reason (required)',
    );
  });

  test('given one gate, when the dialog renders, then the lead is not pluralised', () => {
    const one = BlockedDialog({
      cardTitle: 'A',
      toColumn: 'Done',
      gates: [{ id: 'g', label: 'g', satisfied: false }],
    });
    assert.strictEqual(
      one.querySelector('.blocked-lead')?.textContent,
      '1 gate must be satisfied first',
    );
  });

  test('given a reason, when the dialog renders, then move becomes available', () => {
    const dialog = BlockedDialog({
      cardTitle: 'A card',
      toColumn: 'Done',
      gates: [{ id: 'peer-reviewed', label: 'Peer reviewed', satisfied: false }],
      overriding: true,
      reason: 'shipping the hotfix',
    });
    assert.strictEqual(dialog.querySelector('.btn-primary')?.hasAttribute('disabled'), false);
  });

  test('given a diff, when a document renders, then only changed runs are marked', () => {
    const doc = DiffDocument({
      runs: [
        { op: 'same', html: '<p>unchanged</p>' },
        { op: 'del', html: '<p>gone</p>' },
        { op: 'add', html: '<p>new</p>' },
      ],
    });
    assert.strictEqual(doc.querySelectorAll('.diff-run').length, 2);
    assert.strictEqual(doc.querySelectorAll('.diff-del').length, 1);
    assert.strictEqual(doc.querySelectorAll('.diff-add').length, 1);
    assert.strictEqual(
      doc.querySelector('.diff-del')?.getAttribute('aria-label'),
      'removed',
      'a marked block says what it is to a screen reader, not just in colour',
    );
  });

  test('given an unchanged document, when it renders, then nothing is marked', () => {
    const doc = DiffDocument({ runs: [{ op: 'same', html: '<p>same</p>' }] });
    assert.strictEqual(doc.querySelectorAll('.diff-run').length, 0);
  });
});
