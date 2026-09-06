/**
 * Minimal YAML-subset parser/serializer for RepoDoc card frontmatter.
 *
 * Supported: `key: value` pairs whose values are unquoted / single- / double-
 * quoted strings, numbers, booleans, and inline string arrays `[a, b]`.
 * Deliberately tolerant: text without frontmatter parses to empty data and the
 * whole text as the body; malformed lines are skipped. Round-trips stably for
 * the keys RepoDoc actually uses.
 */

export interface Frontmatter {
  data: Record<string, unknown>;
  body: string;
}

export function parseFrontmatter(text: string): Frontmatter {
  const normalized = text.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  if (lines[0].trim() !== '---') {
    return { data: {}, body: text };
  }

  let closing = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      closing = i;
      break;
    }
  }
  if (closing === -1) {
    return { data: {}, body: text };
  }

  const data: Record<string, unknown> = {};
  for (let i = 1; i < closing; i++) {
    const line = lines[i];
    if (!line.trim()) {
      continue;
    }
    const idx = line.indexOf(':');
    if (idx === -1) {
      continue; // malformed — skip
    }
    const key = line.slice(0, idx).trim();
    if (!key) {
      continue;
    }
    data[key] = parseValue(line.slice(idx + 1).trim());
  }

  const body = lines.slice(closing + 1).join('\n');
  return { data, body };
}

export function serializeFrontmatter(data: Record<string, unknown>, body: string): string {
  const lines = ['---'];
  for (const key of Object.keys(data)) {
    const value = data[key];
    if (value === undefined) {
      continue;
    }
    lines.push(`${key}: ${serializeValue(value)}`);
  }
  lines.push('---');
  return lines.join('\n') + '\n' + body;
}

// ---------------------------------------------------------------------------

function parseValue(raw: string): unknown {
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
    return '[' + value.map((item) => serializeString(String(item), true)).join(', ') + ']';
  }
  if (typeof value === 'boolean' || typeof value === 'number') {
    return String(value);
  }
  return serializeString(String(value), false);
}

function serializeString(s: string, inArray: boolean): string {
  if (needsQuote(s, inArray)) {
    return '"' + s.replace(/"/g, '\\"') + '"';
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
  // Splitting on the first colon means a colon in the value is safe, but commas
  // and closing brackets break inline arrays.
  if (inArray && /[,\]]/.test(s)) {
    return true;
  }
  return false;
}
