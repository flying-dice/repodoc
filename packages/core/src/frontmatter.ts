/**
 * Minimal YAML-subset parser/serializer for RepoDoc card frontmatter.
 *
 * Understood: `key: value` pairs whose values are unquoted / single- / double-
 * quoted strings, numbers, booleans, and inline string arrays `[a, b]`. Those
 * are the only values RepoDoc reads or writes.
 *
 * A trailing ` # comment` after a scalar is a comment, not part of the value.
 *
 * Everything else in the block — a key whose value continues on the lines below
 * it (a YAML block list, indented or at column 0, or a nested map), whole-line
 * `#` comments, blank lines, malformed lines — is kept as an OPAQUE chunk and
 * re-emitted byte-for-byte, so editing a card never destroys frontmatter this
 * parser does not model. {@link parseFrontmatter}
 * hands those chunks back as `raw`; pass them to {@link serializeFrontmatter} to
 * preserve them. A caller writing a fresh file simply omits `raw`.
 *
 * Deliberately tolerant: text without frontmatter parses to empty data and the
 * whole text as the body. An opening `---` whose block declares no key at all is
 * a horizontal rule in the body, not frontmatter — the prose under it is never
 * swallowed.
 */

/**
 * One entry of a frontmatter block, in file order.
 *  - `pair`   — a `key: value` line this module understands.
 *  - `block`  — a key whose value continues on the lines below it (indented, or
 *               a `- item` sequence at column 0); opaque, but it owns its key,
 *               so setting that key replaces the WHOLE block and nothing is
 *               left orphaned under a rewritten line.
 *  - `opaque` — comments, blank lines, malformed lines: emitted verbatim.
 */
export type FrontmatterEntry =
  | { kind: 'pair'; key: string; value: unknown; line: string }
  | { kind: 'block'; key: string; lines: string[] }
  | { kind: 'opaque'; lines: string[] };

export interface Frontmatter {
  data: Record<string, unknown>;
  body: string;
  /** The original block, for byte-preserving re-serialization. */
  raw: FrontmatterEntry[];
}

export function parseFrontmatter(text: string): Frontmatter {
  const normalized = text.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const noFrontmatter: Frontmatter = { data: {}, body: text, raw: [] };
  if ((lines[0] ?? '').trim() !== '---') {
    return noFrontmatter;
  }

  let closing = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === '---') {
      closing = i;
      break;
    }
  }
  if (closing === -1) {
    return noFrontmatter;
  }

  const data: Record<string, unknown> = {};
  const raw: FrontmatterEntry[] = [];
  let sawKey = false;
  let i = 1;
  while (i < closing) {
    const line = lines[i] ?? '';
    const key = topLevelKey(line);
    if (key === undefined) {
      raw.push({ kind: 'opaque', lines: [line] });
      i++;
      continue;
    }
    // Indented non-blank lines under a key are its value (a block sequence, a
    // nested map, a folded scalar). Keep the whole group verbatim.
    //
    // A key with an EMPTY value also owns the `- item` lines under it, even at
    // column 0 — YAML allows an unindented block sequence, and reading those
    // lines as unrelated opaque chunks left them stranded below the rewritten
    // key (`labels: [x]` followed by orphaned `- a` lines).
    const group = [line];
    const ownsBlockSequence = line.slice(line.indexOf(':') + 1).trim() === '';
    let j = i + 1;
    while (j < closing) {
      const next = lines[j] ?? '';
      if (!isContinuation(next) && !(ownsBlockSequence && isBlockSequenceItem(next))) {
        break;
      }
      group.push(next);
      j++;
    }
    sawKey = true;
    if (group.length > 1) {
      raw.push({ kind: 'block', key, lines: group });
    } else {
      const value = parseValue(line.slice(line.indexOf(':') + 1).trim());
      data[key] = value;
      raw.push({ kind: 'pair', key, value, line });
    }
    i = j;
  }

  // A block with content but no key at all is a horizontal rule opening the
  // body (`---\n\nSome prose\n\n---`). Treating it as frontmatter would drop
  // that prose on the next write, so it stays body.
  if (!sawKey && lines.slice(1, closing).some((l) => l.trim() !== '')) {
    return noFrontmatter;
  }

  return { data, body: lines.slice(closing + 1).join('\n'), raw };
}

/**
 * Renders `data` + `body` as a frontmatter document. With `raw` (from
 * {@link parseFrontmatter}) the original block is rebuilt in place: a known key
 * keeps its line when its value is unchanged and is rewritten when it is not, a
 * key removed from `data` loses its line, opaque chunks are emitted byte-for-
 * byte, and keys new to `data` are appended before the closing fence.
 */
export function serializeFrontmatter(
  data: Record<string, unknown>,
  body: string,
  raw: readonly FrontmatterEntry[] = [],
): string {
  const lines = ['---'];
  const emitted = new Set<string>();
  for (const entry of raw) {
    switch (entry.kind) {
      case 'pair': {
        if (emitted.has(entry.key) || !hasValue(data, entry.key)) {
          continue; // a duplicate line, or a key the caller removed
        }
        emitted.add(entry.key);
        const value = data[entry.key];
        // An untouched value keeps its exact line — quoting, spacing and all.
        lines.push(value === entry.value ? entry.line : `${entry.key}: ${serializeValue(value)}`);
        break;
      }
      case 'block': {
        // An explicit set replaces the block; otherwise it survives verbatim.
        if (!emitted.has(entry.key) && hasValue(data, entry.key)) {
          lines.push(`${entry.key}: ${serializeValue(data[entry.key])}`);
        } else {
          lines.push(...entry.lines);
        }
        emitted.add(entry.key);
        break;
      }
      case 'opaque':
        lines.push(...entry.lines);
        break;
    }
  }
  for (const key of Object.keys(data)) {
    if (emitted.has(key) || data[key] === undefined) {
      continue;
    }
    lines.push(`${key}: ${serializeValue(data[key])}`);
  }
  lines.push('---');
  return `${lines.join('\n')}\n${body}`;
}

// ---------------------------------------------------------------------------

/** The key of a top-level `key: value` line; undefined for anything else. */
function topLevelKey(line: string): string | undefined {
  if (line === '' || /^\s/.test(line) || line.startsWith('#')) {
    return undefined; // blank, indented, or a comment
  }
  const idx = line.indexOf(':');
  if (idx === -1) {
    return undefined; // malformed — not a key line
  }
  const key = line.slice(0, idx).trim();
  return key === '' ? undefined : key;
}

/** An indented, non-blank line: part of the value above it. */
function isContinuation(line: string): boolean {
  return /^[ \t]+\S/.test(line);
}

/** A `- item` line at column 0 — an unindented YAML block-sequence entry. */
function isBlockSequenceItem(line: string): boolean {
  return /^-(?:[ \t]|$)/.test(line);
}

/** Whether `data` carries a writable value for `key` (absent/undefined = no). */
function hasValue(data: Record<string, unknown>, key: string): boolean {
  return key in data && data[key] !== undefined;
}

function parseValue(text: string): unknown {
  const raw = stripInlineComment(text);
  if (raw === '') {
    return '';
  }
  if (raw.startsWith('[') && raw.endsWith(']')) {
    const inner = raw.slice(1, -1).trim();
    if (!inner) {
      return [];
    }
    return splitTopLevel(inner).map((item) => unquote(item.trim()));
  }
  if (isQuoted(raw)) {
    return unquote(raw);
  }
  if (raw === 'true') {
    return true;
  }
  if (raw === 'false') {
    return false;
  }
  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    return Number(raw);
  }
  return raw;
}

/**
 * The value with an unquoted trailing ` # comment` cut off. YAML ends a scalar
 * at a `#` that follows whitespace, so `priority: high # why` is the value
 * `high`; keeping the comment made it part of the priority, and a card that
 * merely round-tripped could be written back with the comment inside the value.
 *
 * A `#` inside quotes, inside an inline `[…]` array, or at the very start of
 * the value (`color: #fff`) is part of the value — only a ` #` suffix is a
 * comment. The comment itself is not lost: an unchanged pair keeps its original
 * line byte-for-byte (see {@link serializeFrontmatter}).
 */
function stripInlineComment(raw: string): string {
  let quote: string | null = null;
  let depth = 0;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (quote !== null) {
      if (ch === quote && raw[i - 1] !== '\\') {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '[') {
      depth++;
    } else if (ch === ']' && depth > 0) {
      depth--;
    } else if (ch === '#' && depth === 0 && i > 0 && /[ \t]/.test(raw[i - 1] ?? '')) {
      return raw.slice(0, i).trimEnd();
    }
  }
  return raw;
}

/** Split on commas that sit outside single/double quotes. */
function splitTopLevel(inner: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (quote) {
      current += ch;
      if (ch === quote && inner[i - 1] !== '\\') {
        quote = null;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ',') {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

function isQuoted(s: string): boolean {
  return (
    s.length >= 2 &&
    ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'"))
  );
}

function unquote(s: string): string {
  if (isQuoted(s)) {
    return s.slice(1, -1).replace(/\\"/g, '"');
  }
  return s;
}

function serializeValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => serializeString(String(item), true)).join(', ')}]`;
  }
  if (typeof value === 'boolean' || typeof value === 'number') {
    return String(value);
  }
  return serializeString(String(value), false);
}

function serializeString(raw: string, inArray: boolean): string {
  // The frontmatter format is one key per line; a newline inside a scalar
  // would become a new key on re-read. Collapse it so no caller can inject one.
  const s = raw.replace(/[\r\n]+/g, ' ');
  if (needsQuote(s, inArray)) {
    return `"${s.replace(/"/g, '\\"')}"`;
  }
  return s;
}

function needsQuote(s: string, inArray: boolean): boolean {
  if (s === '' || s !== s.trim()) {
    return true;
  }
  if (/^(true|false)$/.test(s) || /^-?\d+(\.\d+)?$/.test(s)) {
    return true;
  }
  if (/^[["'#]/.test(s)) {
    return true;
  }
  // ` #` starts a comment on re-read, so an unquoted value carrying one would
  // come back truncated: `status: fixing bug #12` -> `fixing bug`.
  if (/[ \t]#/.test(s)) {
    return true;
  }
  // Splitting on the first colon means a colon in the value is safe, but commas
  // and closing brackets break inline arrays.
  if (inArray && /[,\]]/.test(s)) {
    return true;
  }
  return false;
}
