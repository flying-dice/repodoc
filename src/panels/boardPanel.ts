import * as vscode from 'vscode';
import * as path from 'path';
import { RepoDocStore } from '../store';
import { BoardData, RepoDocConfig } from '../types';

/**
 * A single kanban board rendered in a webview. One panel is kept per board id.
 */
export class BoardPanel {
  public static readonly viewType = 'repodoc.board';

  private static readonly panels = new Map<string, BoardPanel>();

  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly store: RepoDocStore,
    private readonly boardId: string,
  ) {
    this.panel.webview.html = this.getHtml(this.panel.webview);

    this.panel.webview.onDidReceiveMessage(
      (msg) => this.onMessage(msg),
      undefined,
      this.disposables,
    );

    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
  }

  public static createOrShow(
    extensionUri: vscode.Uri,
    store: RepoDocStore,
    boardId: string,
  ): void {
    const existing = BoardPanel.panels.get(boardId);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    const mediaUri = vscode.Uri.joinPath(extensionUri, 'media');
    const board = store.getBoard(boardId);
    const title = board ? board.name : boardId;

    const panel = vscode.window.createWebviewPanel(
      BoardPanel.viewType,
      title,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [mediaUri],
        retainContextWhenHidden: true,
      },
    );

    BoardPanel.panels.set(boardId, new BoardPanel(panel, extensionUri, store, boardId));
  }

  /** Re-post data to every open panel and refresh panel titles. */
  public static refreshAll(): void {
    for (const panel of BoardPanel.panels.values()) {
      panel.postData();
    }
  }

  private dispose(): void {
    BoardPanel.panels.delete(this.boardId);
    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) {
        d.dispose();
      }
    }
  }

  private postData(): void {
    const board = this.store.getBoard(this.boardId);
    if (!board) {
      return;
    }
    this.panel.title = board.name;
    const config = this.store.getConfig();
    void this.panel.webview.postMessage({
      type: 'data',
      boardId: this.boardId,
      board,
      config,
      dataDirName: this.store.dataDirName,
    } satisfies { type: string; boardId: string; board: BoardData; config: RepoDocConfig; dataDirName: string });
  }

  private onMessage(msg: unknown): void {
    if (!msg || typeof msg !== 'object') {
      return;
    }
    const m = msg as Record<string, unknown>;
    switch (m.type) {
      case 'ready': {
        this.postData();
        break;
      }
      case 'moveCard': {
        if (
          typeof m.cardId === 'string' &&
          typeof m.toColumn === 'string' &&
          typeof m.index === 'number'
        ) {
          this.store.moveCard(this.boardId, m.cardId, m.toColumn, m.index);
        }
        break;
      }
      case 'addCard': {
        if (typeof m.column === 'string' && typeof m.title === 'string') {
          const title = m.title.trim();
          if (title) {
            this.store.addCard(this.boardId, m.column, title);
          }
        }
        break;
      }
      case 'addColumn': {
        void this.promptAddColumn();
        break;
      }
      case 'toggleCheck': {
        if (typeof m.cardId === 'string' && typeof m.index === 'number') {
          this.store.toggleChecklistItem(this.boardId, m.cardId, m.index);
        }
        break;
      }
      case 'openFile': {
        if (typeof m.path === 'string') {
          void this.openFile(m.path);
        }
        break;
      }
      default:
        break;
    }
  }

  private async promptAddColumn(): Promise<void> {
    const name = await vscode.window.showInputBox({ prompt: 'List name' });
    if (name && name.trim()) {
      this.store.addColumn(this.boardId, name.trim());
    }
  }

  private async openFile(relPath: string): Promise<void> {
    const root = this.store.root;
    if (!root) {
      void vscode.window.showWarningMessage(`RepoDoc: no workspace open for "${relPath}".`);
      return;
    }
    const abs = path.resolve(root, relPath);
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      void vscode.window.showWarningMessage(`RepoDoc: "${relPath}" is outside the workspace.`);
      return;
    }
    try {
      const uri = vscode.Uri.file(abs);
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc);
    } catch {
      void vscode.window.showWarningMessage(`RepoDoc: could not open "${relPath}".`);
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'board.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'board.css'),
    );
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource}`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>RepoDoc Board</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
