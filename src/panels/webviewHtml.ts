import * as vscode from 'vscode';

/** Escape text for safe interpolation into HTML markup. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

export interface BuildWebviewHtmlOptions {
  webview: vscode.Webview;
  extensionUri: vscode.Uri;
  /** Document title (escaped for you). */
  title: string;
  /** Trusted, pre-built body markup placed inside <body>. */
  bodyHtml: string;
  /**
   * Media-relative stylesheet filenames, linked in order. By convention
   * `base.css` (shared rules) comes first, then the view-specific stylesheet.
   */
  stylesheets: string[];
  /** Optional media-relative script to load with a generated nonce. */
  scriptFileName?: string;
  /** Additional media-relative scripts, loaded (in order) with the same nonce. */
  extraScripts?: string[];
  /** Extra img-src tokens appended after the webview csp source (e.g. `https:`, `data:`). */
  extraImgSrc?: string[];
}

/**
 * Build a complete webview HTML document with a locked-down CSP, the shared
 * document skeleton, and ordered stylesheet links. Used by every RepoDoc panel
 * so the CSP and skeleton live in one place.
 */
export function buildWebviewHtml(options: BuildWebviewHtmlOptions): string {
  const {
    webview,
    extensionUri,
    title,
    bodyHtml,
    stylesheets,
    scriptFileName,
    extraScripts,
    extraImgSrc,
  } =
    options;
  const cspSource = webview.cspSource;
  // Extra scripts load BEFORE the main script (e.g. mermaid before board.js).
  const allScripts = [...(extraScripts ?? []), ...(scriptFileName ? [scriptFileName] : [])];
  const nonce = allScripts.length > 0 ? getNonce() : undefined;

  const mediaUri = (fileName: string): vscode.Uri =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', fileName));

  const imgSrc = [cspSource, ...(extraImgSrc ?? [])].join(' ');
  const cspParts = [
    `default-src 'none'`,
    `img-src ${imgSrc}`,
    `style-src ${cspSource} 'unsafe-inline'`,
  ];
  if (nonce) {
    cspParts.push(`script-src 'nonce-${nonce}'`);
  }
  const csp = cspParts.join('; ');

  const styleLinks = stylesheets
    .map((fileName) => `  <link href="${mediaUri(fileName)}" rel="stylesheet" />`)
    .join('\n');

  const scriptTag =
    allScripts.length > 0 && nonce
      ? allScripts
          .map((f) => `\n  <script nonce="${nonce}" src="${mediaUri(f)}"></script>`)
          .join('')
      : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
${styleLinks}
  <title>${escapeHtml(title)}</title>
</head>
<body>
${bodyHtml}${scriptTag}
</body>
</html>`;
}
