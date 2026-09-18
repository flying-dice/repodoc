import { ICON, Icon } from '../atoms/icon.js';
import { ScenarioKeyword } from '../atoms/scenarioKeyword.js';
import { h } from '../dom.js';
import { EditConflictNotice } from '../molecules/editConflictNotice.js';

/**
 * One Gherkin scenario in the feature detail view.
 *
 * The steps render in a `<pre>`: a scenario body is carried verbatim rather
 * than interpreted, so tags, doc strings, `Examples:` tables and comments all
 * survive a round trip because nothing here tries to model them. A scenario
 * with no steps says so instead of rendering an empty box.
 *
 * Removing asks first, inline, rather than opening a dialog — and the confirm
 * button is the destructive one, so the quiet default is to keep.
 *
 * A save that collided with the file shows the notice and keeps the typed text.
 * Neither side wins silently — the host refuses the write and the human picks.
 *
 * MIRROR: `media/board.js` — `scenarioReader`.
 *
 * @param {{
 *   scenario: { keyword?: string | undefined, name: string, steps?: string[] | undefined },
 *   confirmingRemove?: boolean | undefined,
 *   saved?: boolean | undefined,
 *   stale?: boolean | undefined,
 *   onEdit?: ((e: Event) => void) | undefined,
 *   onRemove?: ((e: Event) => void) | undefined,
 *   onKeep?: ((e: Event) => void) | undefined,
 * }} props
 * @returns {HTMLElement}
 */
export function ScenarioBlock({
  scenario,
  confirmingRemove = false,
  saved = false,
  stale = false,
  onEdit,
  onRemove,
  onKeep,
}) {
  const actions = [];
  if (saved) {
    actions.push(
      h('span', { class: 'scenario-saved', role: 'status' }, [Icon(ICON.check, 'icon'), ' Saved']),
    );
  }
  if (confirmingRemove) {
    actions.push(
      h('span', { class: 'scenario-confirm' }, 'Remove this scenario?'),
      h(
        'button',
        {
          class: 'ghost-btn danger',
          'aria-label': `Confirm removing scenario ${scenario.name}`,
          onClick: onRemove,
        },
        'Remove',
      ),
      h('button', { class: 'ghost-btn', onClick: onKeep }, 'Keep'),
    );
  } else {
    actions.push(
      h(
        'button',
        { class: 'ghost-btn', 'aria-label': `Edit scenario ${scenario.name}`, onClick: onEdit },
        'Edit',
      ),
      h(
        'button',
        { class: 'ghost-btn', 'aria-label': `Remove scenario ${scenario.name}`, onClick: onRemove },
        'Remove',
      ),
    );
  }

  const steps = scenario.steps || [];
  const children = [
    h('div', { class: 'scenario-head' }, [
      h('div', { class: 'scenario-title' }, [
        ScenarioKeyword({ keyword: scenario.keyword }),
        ' ',
        scenario.name,
      ]),
      h('div', { class: 'section-head-spacer' }),
      h('div', { class: 'scenario-actions' }, actions),
    ]),
  ];
  if (stale) {
    children.push(EditConflictNotice({}));
  }
  children.push(
    steps.length
      ? h('pre', { class: 'scenario-steps' }, steps.join('\n'))
      : h('div', { class: 'scenario-steps empty' }, 'No steps yet.'),
  );
  return h('div', { class: 'scenario' }, children);
}
