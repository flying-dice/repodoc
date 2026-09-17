import { h } from '../dom.js';
import { GateRow } from '../molecules/gateRow.js';

/**
 * The guided dialog a refused move opens.
 *
 * Framed as "before this can move" rather than as a rejection, listing every
 * failing gate with the instructions for satisfying it. The dialog survives a
 * data refresh so gates can be ticked one after another.
 *
 * An override needs a reason before it is offered. The CLI refuses
 * `--override` without `--reason`; the board must not write a weaker audit line
 * than an agent does.
 *
 * MIRROR: `media/board.js` — `buildBlockedDialog`.
 *
 * @param {{
 *   cardTitle: string,
 *   toColumn: string,
 *   gates: Array<{ id: string, label: string, satisfied: boolean, reason?: string | undefined, promptHtml?: string | undefined }>,
 *   overriding?: boolean | undefined,
 *   reason?: string | undefined,
 *   onCancel?: ((e: Event) => void) | undefined,
 *   onMove?: ((e: Event) => void) | undefined,
 * }} props
 * @returns {HTMLElement}
 */
export function BlockedDialog({
  cardTitle,
  toColumn,
  gates,
  overriding = false,
  reason = '',
  onCancel,
  onMove,
}) {
  const allSatisfied = gates.every((g) => g.satisfied);
  const body = [
    h('div', { class: 'modal-title blocked-title' }, `Before ${cardTitle} can move to ${toColumn}`),
    h(
      'div',
      { class: 'blocked-lead' },
      `${gates.length} ${gates.length === 1 ? 'gate' : 'gates'} must be satisfied first`,
    ),
    h(
      'div',
      { class: 'blocked-gates' },
      gates.map((gate) => GateRow(gate)),
    ),
  ];
  if (overriding) {
    const reasonInput = /** @type {HTMLInputElement} */ (
      h('input', {
        id: 'override-reason',
        class: 'field-input',
        placeholder: 'Why are you bypassing these gates?',
        'aria-label': 'Override reason',
      })
    );
    reasonInput.value = reason;
    body.push(
      h('div', { class: 'override-box' }, [
        h('div', { class: 'field-label' }, 'Reason (required)'),
        reasonInput,
      ]),
    );
    body.push(
      h(
        'div',
        { class: 'blocked-foot-note' },
        'An override is recorded on the card with your name.',
      ),
    );
  }
  body.push(
    h('div', { class: 'blocked-actions' }, [
      h('button', { class: 'btn-secondary', type: 'button', onClick: onCancel }, 'Cancel'),
      h(
        'button',
        {
          class: 'btn-primary',
          type: 'button',
          // Unsatisfied gates can only be passed with a reason, so the button
          // stays out of reach until there is one.
          disabled: allSatisfied || (overriding && reason.trim()) ? null : 'disabled',
          onClick: onMove,
        },
        allSatisfied ? 'Move' : 'Override and move',
      ),
    ]),
  );
  return h(
    'div',
    { class: 'modal blocked-modal', role: 'dialog', 'aria-label': 'Move blocked' },
    body,
  );
}
