import * as path from 'node:path';
import * as vscode from 'vscode';

/**
 * Open a repo-relative file in an editor and optionally reveal a 1-based line
 * range. `relPath` is resolved against — and containment-checked to — the
 * workspace root; anything outside it is ignored, and a failure to open is
 * reported as a warning rather than thrown.
 *
 * The one place the extension turns a repo-relative path into an editor, so the
 * containment check cannot be forgotten by a new caller.
 */
export async function openRepoFile(
  root: string | undefined,
  relPath: string,
  range?: { line: number; endLine?: number },
): Promise<void> {
  if (!root) {
    return;
  }
  const rootResolved = path.resolve(root);
  const abs = path.resolve(rootResolved, relPath);
  if (abs !== rootResolved && !abs.startsWith(rootResolved + path.sep)) {
    return;
  }
  try {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(abs));
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    if (range) {
      const start = new vscode.Position(Math.max(0, range.line - 1), 0);
      const end = new vscode.Position(Math.max(0, range.endLine ?? range.line), 0);
      const selection = new vscode.Selection(start, end);
      editor.selection = selection;
      editor.revealRange(selection, vscode.TextEditorRevealType.InCenter);
    }
  } catch {
    void vscode.window.showWarningMessage(`RepoDoc: could not open ${relPath}`);
  }
}
