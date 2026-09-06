/**
 * A card reference: one line a human can paste into a chat and an agent can
 * act on directly. `<scope>/<id>` is exactly what every `repodoc card …` /
 * `repodoc feature …` command takes; the title makes it readable and the
 * repo-relative path makes it clickable in an editor.
 *
 *   repodoc/add-csv-export — Add CSV export (boards/repodoc/03-add-csv-export.md)
 */
export function formatRef(scope: string, id: string, title: string, path?: string): string {
  const head = `${scope}/${id} — ${title.trim() || id}`;
  return path ? `${head} (${path})` : head;
}
