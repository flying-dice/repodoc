import { h } from '../dom.js';

/**
 * The Gherkin keyword introducing a scenario block. Kept as its own chip
 * because `Scenario Outline:` and `Scenario:` read differently and the file is
 * the source of truth for which one this is.
 *
 * MIRROR: `media/board.js` — `scenarioKeywordChip`.
 *
 * @param {{ keyword?: string | undefined }} props
 * @returns {HTMLElement}
 */
export function ScenarioKeyword({ keyword }) {
  return h('span', { class: 'scenario-keyword' }, `${keyword || 'Scenario'}:`);
}
