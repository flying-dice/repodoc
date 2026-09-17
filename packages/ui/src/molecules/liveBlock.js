import { h } from '../dom.js';

/**
 * The live banner on a card an agent is working.
 *
 * An unset progress is not "0% complete": the number and the bar are both
 * omitted rather than implying no work has been done. That distinction is the
 * whole reason this is a component and not two lines in the card face.
 *
 * MIRROR: `media/board.js` — the `live-block` branch of `buildCard`.
 *
 * @param {{ status?: string | undefined, progress?: number | undefined }} props
 * @returns {HTMLElement}
 */
export function LiveBlock({ status, progress }) {
  const hasPct = typeof progress === 'number' && Number.isFinite(progress);
  const pct = `${hasPct ? progress : 0}%`;
  const row = [h('span', { class: 'live-dot' }), h('span', { class: 'live-status' }, status || '')];
  if (hasPct) {
    row.push(h('span', { class: 'live-pct' }, pct));
  }
  const children = [h('div', { class: 'live-row' }, row)];
  if (hasPct) {
    children.push(
      h('div', { class: 'progress-track' }, [
        h('div', { class: 'progress-fill', style: `width:${pct};` }),
      ]),
    );
  }
  return h('div', { class: 'live-block' }, children);
}
