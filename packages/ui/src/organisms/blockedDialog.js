import { h } from '../dom.js';
import { GateRow } from '../molecules/gateRow.js';

/**
 * The guided dialog a refused move opens.
 *
 * Framed as "before this can move" rather than as a rejection, listing every
 * failing gate with the instructions for satisfying it.
 *
 * Three actions, and which is enabled is the whole policy:
 *
 *  - **Move** is enabled only when every gate passes. Doing the work is the
 *    intended route out of this dialog.
 *  - **Override…** opens the reason box. It does not move anything.
 *  - **Override & move** appears only once overriding, and stays disabled until
 *    a reason is typed — enabled live on input, not on the next render, so the
 *    button unlocks as you type. The CLI refuses `--override` without
 *    `--reason`; the board must not write a weaker audit line than an agent
 *    does.
 *
 * The panel is an `aria-modal` dialog inside an overlay that closes on click,
 * with its own close control. Rendering it bare would leave focus, escape and
 * overlay-dismiss regressions invisible to a story.
 *
 * MIRROR: `media/board.js` — `buildBlockedDialog`, `syncOverrideButton`.
 *
 * @param {{
 *   cardTitle: string,
 *   toColumn: string,
 *   gates: Array<{ id: string, label: string, satisfied: boolean, reason?: string | undefined, promptHtml?: string | undefined }>,
 *   overriding?: boolean | undefined,
 *   reason?: string | undefined,
 *   onCancel?: ((e: Event) => void) | undefined,
 *   onStartOverride?: ((e: Event) => void) | undefined,
 *   onOverrideMove?: ((e: Event) => void) | undefined,
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
  onStartOverride,
  onOverrideMove,
  onMove,
}) {
  const allOk = gates.every((g) => g.satisfied);
  const title = `Before ${cardTitle} can move to ${toColumn}`;

  const body = [
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

  /** Enabled live as the reason is typed; a re-render would come too late. */
  const overrideMoveButton = h(
    'button',
    {
      id: 'override-move-btn',
      class: 'btn-secondary',
      disabled: reason.trim() ? null : 'disabled',
      onClick: onOverrideMove,
    },
    'Override & move',
  );

  if (overriding) {
    const reasonInput = /** @type {HTMLInputElement} */ (
      h('input', {
        id: 'override-reason',
        class: 'field-input',
        placeholder: 'Why are you bypassing these gates?',
        'aria-label': 'Override reason',
        onInput: (/** @type {Event} */ e) => {
          const value = /** @type {HTMLInputElement} */ (e.target).value;
          if (value.trim()) {
            overrideMoveButton.removeAttribute('disabled');
          } else {
            overrideMoveButton.setAttribute('disabled', 'disabled');
          }
        },
      })
    );
    reasonInput.value = reason;
    body.push(
      h('div', { class: 'override-box' }, [
        h('div', { class: 'field-label' }, 'Reason (required)'),
        reasonInput,
        h('div', { class: 'gate-hint' }, 'Only a human may override — say why.'),
      ]),
    );
  } else {
    body.push(h('div', { class: 'blocked-foot-note' }, 'Do the work above, then move again.'));
  }

  const actions = [h('button', { class: 'btn-cancel-text', onClick: onCancel }, 'Cancel')];
  actions.push(
    overriding
      ? overrideMoveButton
      : h('button', { class: 'btn-secondary', onClick: onStartOverride }, 'Override…'),
  );
  actions.push(
    h(
      'button',
      {
        class: 'btn-primary',
        disabled: allOk ? null : 'disabled',
        title: allOk ? 'Move now' : 'Satisfy every gate above first',
        onClick: allOk ? onMove : null,
      },
      'Move',
    ),
  );
  body.push(h('div', { class: 'blocked-actions' }, actions));

  // A gate carrying instructions needs the room to show them.
  const wide = gates.some((g) => !!g.promptHtml);
  const panel = h(
    'div',
    {
      class: `modal blocked-modal${wide ? ' blocked-wide' : ''}`,
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': title,
      tabindex: '-1',
      onClick: (/** @type {Event} */ e) => e.stopPropagation(),
    },
    [
      h('div', { class: 'modal-head' }, [
        h('div', { class: 'modal-head-row' }, [
          h('div', { class: 'modal-head-main' }, [
            h('div', { class: 'modal-title blocked-title' }, title),
          ]),
          h('button', { class: 'modal-close', 'aria-label': 'Close', onClick: onCancel }, '✕'),
        ]),
      ]),
      h('div', { class: 'modal-body' }, body),
    ],
  );
  return h('div', { class: 'modal-overlay', onClick: onCancel }, [panel]);
}
