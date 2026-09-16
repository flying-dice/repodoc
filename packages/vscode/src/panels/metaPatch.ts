/**
 * Narrowing for the webview's `updateMeta` payload — pure, with no `vscode`
 * import, so it runs under plain unit tests (like `readingWidthValue.ts` and
 * `gateGuidance.ts`).
 *
 * Everything arriving from a webview is untrusted: it is JSON a page sent, not
 * a typed call. This is the one place that decides what of it may reach a card
 * file.
 */

import type { CardMetaPatch, Priority } from '@repodoc/core';

const PRIORITIES: Priority[] = ['high', 'med', 'low'];

/**
 * Narrow an untrusted `updateMeta` payload to a {@link CardMetaPatch}. Unknown
 * keys and wrong-typed values are dropped; `null` is kept, because clearing is
 * how the webview mirrors the CLI's `--priority ""` convention. Returns
 * undefined when nothing usable survives.
 *
 * Every string is flattened to one line: card frontmatter is one `key: value`
 * per line, so a newline in a value could otherwise forge another key.
 */
export function sanitizeMetaPatch(raw: Record<string, unknown>): CardMetaPatch | undefined {
  const patch: CardMetaPatch = {};
  let any = false;

  if (typeof raw['title'] === 'string' && raw['title'].trim()) {
    patch.title = oneLine(raw['title']);
    any = true;
  }
  if (raw['labels'] === null) {
    patch.labels = null;
    any = true;
  } else if (Array.isArray(raw['labels']) && raw['labels'].every((l) => typeof l === 'string')) {
    // Labels are written as one frontmatter line; a newline in one would forge
    // another key, so each is flattened exactly as the title is.
    patch.labels = (raw['labels'] as string[]).map(oneLine);
    any = true;
  }
  if (raw['priority'] === null) {
    patch.priority = null;
    any = true;
  } else if (PRIORITIES.includes(raw['priority'] as Priority)) {
    patch.priority = raw['priority'] as Priority;
    any = true;
  }
  for (const key of ['agent', 'status'] as const) {
    const value = raw[key];
    if (value === null) {
      patch[key] = null;
      any = true;
    } else if (typeof value === 'string') {
      const trimmed = oneLine(value);
      patch[key] = trimmed === '' ? null : trimmed;
      any = true;
    }
  }
  if (raw['live'] === null || typeof raw['live'] === 'boolean') {
    patch.live = raw['live'] as boolean | null;
    any = true;
  }
  if (raw['progress'] === null) {
    patch.progress = null;
    any = true;
  } else if (typeof raw['progress'] === 'number' && Number.isFinite(raw['progress'])) {
    patch.progress = Math.max(0, Math.min(100, Math.round(raw['progress'])));
    any = true;
  }

  return any ? patch : undefined;
}

function oneLine(value: string): string {
  return value.replace(/[\r\n]/g, ' ').trim();
}
