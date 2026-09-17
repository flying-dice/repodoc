import { h } from '../dom.js';

/**
 * Initials and a colour derived from an agent's name. There is no roster — any
 * writer may put themselves on a card — so the colour has to come from the name
 * itself and has to be stable across sessions and hosts.
 *
 * MIRROR: `media/board.js` — `agentAvatar`.
 */
/**
 * @param {string} name
 * @returns {{ initials: string, color: string }}
 */
export function agentAvatarValue(name) {
  const words = String(name).trim().split(/\s+/).slice(0, 2);
  const initials =
    words
      .map((w) => w.charAt(0))
      .join('')
      .toUpperCase() || '?';
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return { initials, color: `hsl(${hash % 360}, 45%, 45%)` };
}

/**
 * The avatar as it appears on a card face.
 *
 * @param {{ name: string }} props
 * @returns {HTMLElement}
 */
export function AgentAvatar({ name }) {
  const av = agentAvatarValue(name);
  return h(
    'span',
    { class: 'meta-avatar', title: name, style: `background:${av.color};` },
    av.initials,
  );
}
