/**
 * How long ago something happened, in the board's shorthand.
 *
 * Deliberately coarse: a card's exact timestamp is in the file, and a board is
 * read at a glance. Anything unparseable is handed back verbatim rather than
 * guessed at or blanked.
 *
 * MIRROR: `media/board.js` — `humanizeTime`.
 *
 * @param {string | undefined} iso
 * @param {number} [now] epoch ms, injectable so a story or a test is stable
 * @returns {string}
 */
export function relativeTime(iso, now = Date.now()) {
  if (!iso) {
    return '';
  }
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return String(iso);
  }
  const secs = Math.max(0, Math.floor((now - then) / 1000));
  if (secs < 60) {
    return 'just now';
  }
  const mins = Math.floor(secs / 60);
  if (mins < 60) {
    return `${mins}m`;
  }
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d`;
  }
  return `${Math.floor(days / 7)}w`;
}
