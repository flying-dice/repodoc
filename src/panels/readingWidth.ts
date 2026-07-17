import * as vscode from 'vscode';

/**
 * Resolves `repodoc.readingWidth` to a safe token: one of the presets
 * (`narrow` | `wide` | `full`) or a sanitized CSS length for custom widths.
 * Anything unrecognized falls back to `wide`.
 */
export function resolveReadingWidth(): string {
  return sanitizeReadingWidth(
    vscode.workspace.getConfiguration('repodoc').get<string>('readingWidth'),
  );
}

/** Pure sanitizer — exported for unit tests. */
export function sanitizeReadingWidth(raw: string | undefined): string {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === 'narrow' || value === 'normal') {
    return 'narrow';
  }
  if (value === 'wide' || value === 'full') {
    return value;
  }
  // A bare number means pixels.
  if (/^\d+$/.test(value)) {
    return `${value}px`;
  }
  // A strict CSS length: digits + a known unit. Nothing else can pass, so the
  // value is safe to inline into a style attribute.
  if (/^\d+(\.\d+)?(px|%|rem|em|ch|vw)$/.test(value)) {
    return value;
  }
  return 'wide';
}

/** True when the token is one of the named presets. */
export function isPresetWidth(token: string): boolean {
  return token === 'narrow' || token === 'wide' || token === 'full';
}
