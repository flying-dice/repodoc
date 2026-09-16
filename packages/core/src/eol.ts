/**
 * Line-ending helpers. RepoDoc rewrites files a human also edits, so a mutation
 * must not convert a CRLF file to LF (or the reverse) as a side effect: that
 * turns a one-line change into a whole-file diff.
 *
 * The rule every writer shares: detect the file's dominant ending on read,
 * normalise to LF for processing, and convert back on write.
 */

export type Eol = '\n' | '\r\n';

/**
 * The dominant line ending of `text`: CRLF when it has more CRLF than lone LF
 * endings, else LF (the default for text with no newline at all).
 */
export function detectEol(text: string): Eol {
  let crlf = 0;
  let lf = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '\n') {
      continue;
    }
    if (i > 0 && text[i - 1] === '\r') {
      crlf++;
    } else {
      lf++;
    }
  }
  return crlf > lf ? '\r\n' : '\n';
}

/** `text` with every CRLF collapsed to LF, ready for line-based processing. */
export function normalizeEol(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

/** LF `text` re-emitted with `eol` — the inverse of {@link normalizeEol}. */
export function applyEol(text: string, eol: Eol): string {
  return eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text;
}
