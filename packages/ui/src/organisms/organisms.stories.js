import { h } from '../dom.js';
import { BlockedDialog } from './blockedDialog.js';
import { CardFace } from './cardFace.js';
import { Column } from './column.js';
import { DiffDocument } from './diffBlock.js';
import { ScenarioBlock } from './scenarioBlock.js';
import { StatusBar } from './statusBar.js';
import { TopBar } from './topBar.js';

export default { title: 'Organisms' };

/** @param {unknown} children */
const stack = (children) =>
  h('div', { style: 'display:flex;flex-direction:column;gap:24px;max-width:860px;' }, children);

const GATES = [
  { id: 'tests-green', label: 'Tests green', satisfied: true },
  { id: 'peer-reviewed', label: 'Peer reviewed', satisfied: false, reason: 'no evidence recorded' },
];

export const Cards = {
  name: 'Card face',
  render: () =>
    h(
      'div',
      { style: 'display:flex;gap:16px;flex-wrap:wrap;max-width:900px;align-items:flex-start;' },
      [
        CardFace({
          card: {
            id: 'add-diff-view',
            title: 'Add the diff view',
            priority: 'high',
            agent: 'starscream',
          },
          labels: [{ name: 'feature', color: '#4c8bf5' }],
          gitStatus: 'modified',
          comments: 3,
          checklist: { done: 2, total: 5 },
          gates: GATES,
          updated: '2h',
        }),
        CardFace({
          card: { id: 'fix-nested-css', title: 'Fix the nested CSS', priority: 'med' },
          gitStatus: 'added',
          fields: [{ label: 'Severity', value: 'high' }],
          updated: 'just now',
        }),
        CardFace({
          card: { id: 'tidy-docs', title: 'Tidy the docs' },
          labels: [{ name: 'docs', color: '#8b949e' }],
          updated: 'yesterday',
        }),
      ],
    ),
};

export const LiveCard = {
  name: 'Card face — an agent is working it',
  render: () =>
    h('div', { style: 'display:flex;gap:16px;align-items:flex-start;' }, [
      CardFace({
        card: {
          id: 'migrate-ui',
          title: 'Migrate the webview to components',
          priority: 'high',
          agent: 'skywarp',
          live: true,
          status: 'editing packages/ui/src/organisms/column.js',
          progress: 60,
        },
        updated: 'just now',
      }),
      // An unset progress omits the number and the bar rather than showing 0%.
      CardFace({
        card: {
          id: 'unknown-progress',
          title: 'Working, progress unknown',
          agent: 'thundercracker',
          live: true,
          status: 'reviewing',
        },
        updated: '5m',
      }),
    ]),
};

export const Columns = {
  name: 'Column',
  render: () =>
    h('div', { style: 'display:flex;gap:16px;align-items:flex-start;' }, [
      Column({
        name: 'In Progress',
        color: '#4c8bf5',
        wip: 2,
        cards: [
          { card: { id: 'a', title: 'Extract the atoms', priority: 'high' }, updated: '1h' },
          { card: { id: 'b', title: 'Extract the organisms' }, updated: '3h' },
        ],
      }),
      Column({
        name: 'Done',
        color: '#89d185',
        cards: [{ card: { id: 'c', title: 'Ship 0.9.2' }, updated: '1d' }],
      }),
      Column({ name: 'Backlog', color: '#8b949e', cards: [] }),
    ]),
};

export const TopBars = {
  name: 'Top bar',
  render: () =>
    stack([
      TopBar({ name: 'Project Backlog' }),
      TopBar({ name: 'Project Backlog', query: 'diff' }),
      TopBar({ name: 'Spec Set', noun: 'features' }),
    ]),
};

export const StatusBars = {
  name: 'Status bar',
  render: () => stack([StatusBar({ path: 'boards/project-backlog/' })]),
};

export const Blocked = {
  name: 'Blocked move dialog',
  render: () =>
    stack([
      BlockedDialog({
        cardTitle: 'Add the diff view',
        toColumn: 'Done',
        gates: [
          { id: 'tests-green', label: 'Tests green', satisfied: true },
          {
            id: 'peer-reviewed',
            label: 'Peer reviewed',
            satisfied: false,
            reason: 'no evidence recorded',
            promptHtml: '<p>Record a review with <code>repodoc card gate-pass</code>.</p>',
          },
        ],
      }),
      BlockedDialog({
        cardTitle: 'Add the diff view',
        toColumn: 'Done',
        overriding: true,
        reason: '',
        gates: [
          {
            id: 'peer-reviewed',
            label: 'Peer reviewed',
            satisfied: false,
            reason: 'no evidence recorded',
          },
        ],
      }),
    ]),
};

export const Scenarios = {
  name: 'Scenario block',
  render: () =>
    stack([
      ScenarioBlock({
        scenario: {
          keyword: 'Scenario',
          name: 'A refused move prints every failing gate',
          steps: [
            'Given a card with an unsatisfied gate',
            'When it is moved',
            'Then the move is refused',
          ],
        },
      }),
      ScenarioBlock({
        scenario: {
          keyword: 'Scenario Outline',
          name: 'Just saved',
          steps: ['Given a draft', 'When saved'],
        },
        saved: true,
      }),
      ScenarioBlock({
        scenario: { name: 'Changed under an open editor', steps: ['Given a draft'] },
        stale: true,
      }),
      ScenarioBlock({
        scenario: { name: 'About to be removed', steps: ['Given a draft'] },
        confirmingRemove: true,
      }),
      // A scenario with no steps says so rather than rendering an empty box.
      ScenarioBlock({ scenario: { name: 'Nothing written yet', steps: [] } }),
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
