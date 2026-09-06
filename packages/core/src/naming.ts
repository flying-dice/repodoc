/** Small pure helpers for slugs, labels, and numeric ordering prefixes. */

export function slugify(name: string, fallback = 'untitled'): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || fallback
  );
}

export function titleCase(name: string): string {
  return name
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => (w.length > 0 ? (w[0] ?? '').toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** Strips a leading `NN-` ordering prefix, e.g. "03-intro" -> "intro". */
export function stripNumPrefix(name: string): string {
  return name.replace(/^\d+-/, '');
}

/** The leading `NN` ordering prefix as a number, or `undefined` when absent. */
export function numPrefix(name: string): number | undefined {
  const digits = /^(\d+)-/.exec(name)?.[1];
  return digits === undefined ? undefined : parseInt(digits, 10);
}

export function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

/** Card/doc slug from a file name: drops the `.md` extension and `NN-` prefix. */
export function slugFromFileName(name: string): string {
  return stripNumPrefix(name.replace(/\.md$/i, ''));
}

/**
 * The display title of a markdown document: its first `# ` heading, or a
 * title-cased fallback name when the content has no heading.
 */
export function markdownTitle(content: string, fallbackName: string): string {
  const heading = /^#\s+(.+)$/m.exec(content)?.[1];
  return heading === undefined ? titleCase(fallbackName) : heading.trim();
}

/**
 * `base` when it is free, else the first `base-2`, `base-3`, … not in `taken`.
 * How cards, features, boards and feature sets de-duplicate a slug derived
 * from a title.
 *
 * The comparison is CASE-INSENSITIVE, because the result names a file or a
 * directory: `Login.feature` and `login.feature` are two entries on Linux but
 * ONE file on macOS and Windows, so a case-sensitive check handed out a slug
 * that silently overwrote the existing file there. Comparing lower-cased is
 * done here, not at each call site, so no caller can forget it.
 */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  const lower = new Set([...taken].map((t) => t.toLowerCase()));
  let slug = base;
  let suffix = 2;
  while (lower.has(slug.toLowerCase())) {
    slug = `${base}-${suffix}`;
    suffix++;
  }
  return slug;
}
