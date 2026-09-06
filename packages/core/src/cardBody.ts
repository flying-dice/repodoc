/**
 * Pure editors for a card's markdown body. Every function takes the body text
 * and returns a new body — no I/O, no frontmatter, no store. The store's
 * mutators are thin wrappers around these, which keeps the on-disk shape of a
 * card (title heading, description, `## Checklist` / `## Gates` / `## Comments`
 * sections) described in one place.
 *
 * All of them preserve every byte they do not deliberately rewrite.
 */

/** Where a `## <name>` section sits in a body's lines. */
export interface BodySection {
  /** Index of the heading line itself. */
  headingIdx: number;
  /** Index of the next heading of any level, or the number of lines. */
  end: number;
  /** Index to splice a new line at: after the section's last non-blank line. */
  insertAt: number;
}

/**
 * Locates the first line matching `headingRe` and measures its section: the
 * span from the heading to the next heading of any level (or the end of the
 * body), plus the index a new line should be appended at — after the last
 * non-blank line, so trailing blank lines stay at the bottom of the section.
 * `undefined` when the body has no such heading.
 */
export function findSection(lines: string[], headingRe: RegExp): BodySection | undefined {
  const headingIdx = lines.findIndex((l) => headingRe.test(l));
  if (headingIdx === -1) {
    return undefined;
  }
  let end = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (/^#{1,6}\s+/.test(lines[i] ?? '')) {
      end = i;
      break;
    }
  }
  let insertAt = end;
  while (insertAt > headingIdx + 1 && lines[insertAt - 1]?.trim() === '') {
    insertAt--;
  }
  return { headingIdx, end, insertAt };
}

/**
 * Appends a new `heading` section carrying `block` at the end of `body`,
 * separated by a single blank line and terminated by a newline. An
 * all-whitespace body is replaced by the section alone.
 *
 * Only trailing BLANK LINES are dropped — never trailing spaces on a line that
 * has content. An empty checklist item is written `- [ ] `, and trimming that
 * space turns it into `- [ ]`, which the checklist parser no longer matches:
 * the item would vanish and every later index would shift.
 */
export function appendSection(body: string, heading: string, block: string): string {
  // Anchored at a newline so the run can only ever start at a line boundary:
  // trailing spaces on the last content line are not part of a blank line.
  const trimmed = body.trim() === '' ? '' : body.replace(/(?:\r?\n[ \t]*)+$/, '');
  const prefix = trimmed.length ? `${trimmed}\n\n` : '';
  return `${prefix}${heading}\n\n${block}\n`;
}

/** Rewrites the body's first `# ` heading to `title`, inserting one when absent. */
export function replaceTitle(body: string, title: string): string {
  const lines = body.split('\n');
  const idx = lines.findIndex((l) => /^#\s+/.test(l));
  const heading = `# ${title.replace(/\s+/g, ' ').trim()}`;
  if (idx === -1) {
    return `${heading}\n${body.startsWith('\n') || body === '' ? '' : '\n'}${body}`;
  }
  lines[idx] = heading;
  return lines.join('\n');
}

/**
 * Appends a journal entry to the body's `## Comments` section. The entry is
 * `- **<who>** (<at>): <text>` with any continuation lines of a multi-line text
 * indented two spaces. An existing section gets the entry appended after its
 * last non-blank line; when absent, a `## Comments` section is created at the
 * end of the body (which is after any `## Gates` section).
 */
export function appendCommentLine(body: string, who: string, at: string, text: string): string {
  const textLines = text.split('\n');
  // Continuations are indented two spaces; blank paragraph breaks stay truly
  // empty (the parser keeps them inside the entry when a continuation follows).
  const block = [
    `- **${who}** (${at}): ${textLines[0]}`,
    ...textLines.slice(1).map((l) => (l.trim() === '' ? '' : `  ${l}`)),
  ].join('\n');

  const lines = body.split('\n');
  const section = findSection(lines, /^##\s+comments\s*$/i);
  if (!section) {
    return appendSection(body, '## Comments', block);
  }
  lines.splice(section.insertAt, 0, block);
  return lines.join('\n');
}

/**
 * Appends `- [ ] <text>` to the body's `## Checklist` section, after its last
 * non-blank line. When absent, a `## Checklist` section is inserted right
 * before the first `## Gates` / `## Comments` heading (or at the end of the
 * body when there is neither) — RepoDoc's mandated section order is Checklist,
 * Gates, Comments. `text` is collapsed to a single line.
 */
export function appendChecklistLine(body: string, text: string): string {
  const line = `- [ ] ${text.replace(/\s+/g, ' ').trim()}`;
  const lines = body.split('\n');

  const section = findSection(lines, /^##\s+checklist\s*$/i);
  if (section) {
    lines.splice(section.insertAt, 0, line);
    return lines.join('\n');
  }

  // No existing section — insert a new one before Gates/Comments, else at the end.
  const sectionIdx = lines.findIndex((l) => /^##\s+(gates|comments)\s*$/i.test(l));
  if (sectionIdx === -1) {
    return appendSection(body, '## Checklist', line);
  }
  const before = lines.slice(0, sectionIdx);
  while (before.length && before[before.length - 1]?.trim() === '') {
    before.pop();
  }
  const after = lines.slice(sectionIdx);

  const out: string[] = [...before];
  if (out.length) {
    out.push('');
  }
  out.push('## Checklist', '', line, '', ...after);
  return out.join('\n');
}

/**
 * The ONE heading that ends a card's description: `## Checklist`, `## Gates` or
 * `## Comments`. Any other `## ` heading a card carries — `## Sub`, `## Notes`
 * — is part of the description.
 *
 * The reader ({@link findDescription}, via `cardParse.extractDescription`) and
 * the writer ({@link replaceDescription}) MUST agree on it: when the writer
 * stops earlier than the reader, `describe` writes back the text `show` handed
 * out and the sections between the two boundaries are duplicated on every save.
 */
export const DESCRIPTION_END_RE = /^##\s+(checklist|gates|comments)\s*$/i;

/**
 * The line span of a body's description: from just after the `# ` title line
 * (or line 0 when the body has no title) up to the first
 * {@link DESCRIPTION_END_RE} heading, or the end of the body.
 */
export function findDescription(lines: string[]): { start: number; end: number } {
  const titleIdx = lines.findIndex((l) => /^#\s+/.test(l));
  const start = titleIdx === -1 ? 0 : titleIdx + 1;
  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (DESCRIPTION_END_RE.test(lines[i] ?? '')) {
      end = i;
      break;
    }
  }
  return { start, end };
}

/**
 * Replaces the body text between the `# ` title line and the first
 * `## Checklist` / `## Gates` / `## Comments` heading (or end of body) with
 * `text`, trimmed and surrounded by a single blank line on each side. A body
 * with no `# ` heading treats position 0 as the start of the description.
 * Empty `text` removes the description entirely.
 */
export function replaceDescription(body: string, text: string): string {
  const clean = text.trim();
  const lines = body.split('\n');
  const { start, end } = findDescription(lines);
  const before = lines.slice(0, start);
  const after = lines.slice(end);
  const middle = clean ? clean.split('\n') : [];

  const groups = [before, middle, after].filter((g) => g.length > 0);
  const parts: string[] = [];
  groups.forEach((g, i) => {
    if (i > 0) {
      parts.push('');
    }
    parts.push(...g);
  });
  if (after.length === 0 && parts[parts.length - 1] !== '') {
    parts.push(''); // keep the body's trailing newline
  }
  return parts.join('\n');
}

/** What separates a gate id from its note on an evidence line. */
export const GATE_SEPARATOR = ' — ';

/**
 * Inserts or replaces a done `- [x] <gateId> — <note>` line in the body's
 * `## Gates` section. An existing line for the gate is replaced in place; a new
 * gate is appended to the end of the section. When there is no `## Gates`
 * section, one is appended at the end of the body.
 */
export function upsertGateLine(body: string, gateId: string, note: string): string {
  // The evidence is ONE list line: a newline in the note would orphan the rest
  // of it under `## Gates`, where re-recording the gate can never replace it.
  const line = `- [x] ${gateId}${GATE_SEPARATOR}${note.replace(/[\r\n]+/g, ' ')}`;
  const lines = body.split('\n');

  const section = findSection(lines, /^##\s+gates\s*$/i);
  if (!section) {
    return appendSection(body, '## Gates', line);
  }

  for (let i = section.headingIdx + 1; i < section.end; i++) {
    const m = /^\s*-\s+\[([ xX])\]\s+(.*)$/.exec(lines[i] ?? '');
    if (m?.[2] === undefined) {
      continue;
    }
    const text = m[2].trim();
    const sep = text.indexOf(GATE_SEPARATOR);
    const existingId = sep === -1 ? text : text.slice(0, sep).trim();
    if (existingId === gateId) {
      lines[i] = line;
      return lines.join('\n');
    }
  }

  lines.splice(section.insertAt, 0, line);
  return lines.join('\n');
}
