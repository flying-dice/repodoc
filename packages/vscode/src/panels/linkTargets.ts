/**
 * Where a link in a rendered markdown page points — pure, with no `vscode`
 * import, so it runs under plain unit tests (like `gateGuidance.ts`).
 *
 * A reading view is a webview, so a relative `href` resolves against a
 * `vscode-webview://` origin and navigates nowhere. The host therefore resolves
 * every clicked link itself, against the repo-relative path of the document the
 * link was written in, and routes it to the right surface.
 *
 * Every path is contained: a target that climbs out of the workspace root is
 * refused here, before any caller can open it.
 */

export type LinkTarget =
  /** Same-page anchor; the webview scrolls, the host is not involved. */
  | { kind: 'fragment'; fragment: string }
  /** `http(s)` link for `vscode.env.openExternal`. */
  | { kind: 'external'; url: string }
  /** A `decisions/<id>.md` record — open it in the decision reading view. */
  | { kind: 'decision'; id: string; path: string; fragment?: string }
  /** A `.md` under `docs/` — open it in the docs reading view. */
  | { kind: 'doc'; path: string; fragment?: string }
  /** Any other in-repo file — open it in an editor (containment re-checked there). */
  | { kind: 'file'; path: string; fragment?: string }
  /** Refused: unsupported scheme, or a path outside the workspace root. */
  | { kind: 'blocked'; reason: string };

/** `http:` / `https:` only; every other scheme is refused. */
const SCHEME_RE = /^([a-z][a-z0-9+.-]*):/i;

/**
 * Resolve `href`, as written in the document at `fromRelPath`, to the surface
 * that should open it.
 *
 * @param fromRelPath repo-relative path of the document containing the link,
 *   e.g. `docs/01-getting-started/03-architecture.md`.
 * @param href the raw `href` attribute.
 */
export function resolveRelativeLink(fromRelPath: string, href: string): LinkTarget {
  const raw = (href ?? '').trim();
  if (raw === '') {
    return { kind: 'blocked', reason: 'empty link' };
  }
  if (raw.includes('\0')) {
    return { kind: 'blocked', reason: 'illegal character in link' };
  }
  if (raw.startsWith('#')) {
    return { kind: 'fragment', fragment: raw.slice(1) };
  }
  if (raw.startsWith('//')) {
    // Protocol-relative URL — not a repo path, and not an http(s) link we can
    // vouch for.
    return { kind: 'blocked', reason: 'unsupported link' };
  }
  const scheme = SCHEME_RE.exec(raw);
  if (scheme) {
    const name = scheme[1]?.toLowerCase();
    if (name === 'http' || name === 'https') {
      return { kind: 'external', url: raw };
    }
    return { kind: 'blocked', reason: `unsupported link scheme: ${name}:` };
  }

  // Split the fragment (and drop any query) before touching the path.
  const hashAt = raw.indexOf('#');
  const fragment = hashAt === -1 ? '' : raw.slice(hashAt + 1);
  let pathPart = hashAt === -1 ? raw : raw.slice(0, hashAt);
  const queryAt = pathPart.indexOf('?');
  if (queryAt !== -1) {
    pathPart = pathPart.slice(0, queryAt);
  }
  if (pathPart === '') {
    // `#anchor` was handled above; `?q=1` alone points at this same document.
    return { kind: 'fragment', fragment };
  }
  const decoded = decodePath(pathPart);
  if (decoded === undefined) {
    return { kind: 'blocked', reason: 'malformed link' };
  }
  // Backslashes are separators for the purpose of containment, so a Windows-
  // style `..\..\x` cannot slip past the `..` check below.
  const slashed = decoded.replace(/\\/g, '/');
  if (/^[a-z]:/i.test(slashed)) {
    return { kind: 'blocked', reason: 'absolute path outside the workspace' };
  }
  // A leading `/` in a repo document means the repository root, not the disk.
  const base = slashed.startsWith('/') ? '' : dirOf(fromRelPath);
  const resolved = normalizeRelative(base, slashed.replace(/^\/+/, ''));
  if (resolved === undefined) {
    return { kind: 'blocked', reason: 'link escapes the workspace root' };
  }
  if (resolved === '') {
    return { kind: 'blocked', reason: 'link resolves to the workspace root' };
  }
  const withFragment = fragment === '' ? {} : { fragment };
  const decisionId = decisionIdOf(resolved);
  if (decisionId !== undefined) {
    return { kind: 'decision', id: decisionId, path: resolved, ...withFragment };
  }
  if (resolved.startsWith('docs/') && isMarkdown(resolved)) {
    return { kind: 'doc', path: resolved, ...withFragment };
  }
  return { kind: 'file', path: resolved, ...withFragment };
}

/** `decisions/03-x.md` -> `03-x`; undefined for anything else (including nested files). */
function decisionIdOf(relPath: string): string | undefined {
  const match = /^decisions\/([^/]+)\.md$/i.exec(relPath);
  return match?.[1];
}

function isMarkdown(relPath: string): boolean {
  return /\.(md|markdown)$/i.test(relPath);
}

/** The directory part of a repo-relative file path (`''` for a top-level file). */
function dirOf(relPath: string): string {
  const normalized = (relPath ?? '').replace(/\\/g, '/');
  const at = normalized.lastIndexOf('/');
  return at === -1 ? '' : normalized.slice(0, at);
}

/** `decodeURIComponent`, but a malformed escape is a refusal rather than a throw. */
function decodePath(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

/**
 * Join `base` and `rel` and fold away `.` / `..`. Returns undefined when the
 * result would climb above the root — the containment check.
 */
function normalizeRelative(base: string, rel: string): string | undefined {
  const parts: string[] = [];
  for (const segment of `${base}/${rel}`.split('/')) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (parts.length === 0) {
        return undefined;
      }
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return parts.join('/');
}
