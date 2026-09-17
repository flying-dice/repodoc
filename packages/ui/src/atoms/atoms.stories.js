import { h } from '../dom.js';
import { AgentAvatar } from './agentAvatar.js';
import { CARD_GIT_STATUSES, CardGitBadge } from './cardGitBadge.js';
import { DiffLegend, DiffSwatch } from './diffSwatch.js';
import { FieldChip } from './fieldChip.js';
import { GateChip } from './gateChip.js';
import { GhostButton } from './ghostButton.js';
import { ICON, Icon } from './icon.js';
import { LabelChip } from './labelChip.js';
import { PriorityDot } from './priorityDot.js';
import { relativeTime } from './relativeTime.js';
import { ScenarioKeyword } from './scenarioKeyword.js';

export default { title: 'Atoms' };

/** Lays several variants side by side so one story covers the whole set. */
/** @param {unknown} children */
const row = (children) =>
  h('div', { style: 'display:flex;align-items:center;gap:14px;flex-wrap:wrap;' }, children);

export const AgentAvatars = {
  name: 'Agent avatar',
  render: () =>
    row(
      ['starscream', 'Thundercracker', 'skywarp', 'Jonathan Turnock', 'x'].map((name) =>
        AgentAvatar({ name }),
      ),
    ),
};

export const CardGitBadges = {
  name: 'Card change badge',
  render: () => row(CARD_GIT_STATUSES.map((status) => CardGitBadge({ status }))),
};

export const DiffSwatches = {
  name: 'Diff swatch',
  render: () => row([DiffSwatch({ kind: 'add' }), DiffSwatch({ kind: 'del' })]),
};

export const DiffLegends = {
  name: 'Diff legend',
  render: () => DiffLegend({ added: 2, removed: 2, elapsedMs: 3 }),
};

export const GhostButtons = {
  name: 'Ghost button',
  render: () =>
    row([
      GhostButton({ label: 'Edit' }),
      GhostButton({ label: 'HEAD → working tree' }),
      GhostButton({ label: 'Hide changes', on: true }),
    ]),
};

export const LabelChips = {
  name: 'Label chip',
  render: () =>
    row([
      LabelChip({ name: 'bug', color: '#e5534b' }),
      LabelChip({ name: 'docs', color: '#4c8bf5' }),
      LabelChip({ name: 'chore', color: '#8b949e' }),
    ]),
};

export const PriorityDots = {
  name: 'Priority dot',
  render: () =>
    row([
      PriorityDot({ priority: 'high' }),
      PriorityDot({ priority: 'med' }),
      // low and none draw nothing at all — the empty slot is the behaviour.
      h(
        'span',
        { style: 'color:var(--vscode-descriptionForeground);font-size:11px;' },
        'low / none draw nothing',
      ),
    ]),
};

export const Icons = {
  name: 'Icon',
  render: () => row(Object.values(ICON).map((markup) => Icon(markup, 'icon'))),
};

export const GateChips = {
  name: 'Gate chip',
  render: () =>
    row([
      GateChip({ gates: [{ label: 'Tests green', satisfied: true }] }),
      GateChip({
        gates: [
          { label: 'Tests green', satisfied: true },
          { label: 'Peer reviewed', satisfied: false },
        ],
      }),
    ]),
};

export const FieldChips = {
  name: 'Field chip',
  render: () =>
    row([
      FieldChip({ label: 'Severity', value: 'high' }),
      FieldChip({ label: 'Tags', value: ['ui', 'css'] }),
      FieldChip({ label: 'Blocked', value: true, type: 'boolean' }),
      // A false boolean and an empty value both render nothing at all.
      h(
        'span',
        { style: 'color:var(--vscode-descriptionForeground);font-size:11px;' },
        'false / empty draw nothing',
      ),
    ]),
};

export const ScenarioKeywords = {
  name: 'Scenario keyword',
  render: () =>
    row([
      ScenarioKeyword({ keyword: 'Scenario' }),
      ScenarioKeyword({ keyword: 'Scenario Outline' }),
      ScenarioKeyword({}),
    ]),
};

export const RelativeTimes = {
  name: 'Relative time',
  render: () => {
    const now = Date.parse('2026-09-17T12:00:00Z');
    const samples = [
      ['2026-09-17T11:59:30Z', 'seconds'],
      ['2026-09-17T11:30:00Z', 'minutes'],
      ['2026-09-17T06:00:00Z', 'hours'],
      ['2026-09-15T12:00:00Z', 'days'],
      ['2026-08-20T12:00:00Z', 'weeks'],
    ];
    return row(
      samples.map(([iso, note]) =>
        h('span', { class: 'meta-updated', title: String(note) }, relativeTime(String(iso), now)),
      ),
    );
  },
};
