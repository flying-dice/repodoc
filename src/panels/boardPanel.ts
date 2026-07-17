import * as vscode from 'vscode';
import { RepoDocStore } from '../core/store';
import { buildWebviewHtml } from './webviewHtml';
import { DataMessage, OpenCardMessage, WebviewToHostMessage } from './protocol';

/**
 * A single kanban board rendered in a webview. One panel is kept per board id.
 */
export class BoardPanel {
  public static readonly viewType = 'repodoc.board';

  private static readonly panels = new Map<string, BoardPanel>();

  private readonly disposables: vscode.Disposable[] = [];

  /** Card to open once the webview reports `ready` (see revealCard). */
  private pendingCardId: string | undefined;

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

  /**
   * Open a card's detail modal in an already-open board panel (tests /
   * automation). Returns false when the board has no open panel.
   */
  public static postOpenCard(boardId: string, cardId: string): boolean {
    const panel = BoardPanel.panels.get(boardId);
    if (!panel) {
      return false;
    }
    const msg: OpenCardMessage = { type: 'openCard', cardId };
    void panel.panel.webview.postMessage(msg);
    return true;
  }

  /**
   * Open (or reveal) a board panel and show a card's detail modal. If the
   * webview is still loading, the open is queued and flushed on its `ready`.
   */
  public static revealCard(
    extensionUri: vscode.Uri,
    store: RepoDocStore,
    boardId: string,
    cardId: string,
  ): void {
    const existed = BoardPanel.panels.has(boardId);
    BoardPanel.createOrShow(extensionUri, store, boardId);
    const panel = BoardPanel.panels.get(boardId);
    if (!panel) {
      return;
    }
    if (existed) {
      // Live webview — the message lands now; queuing it would re-pop the
      // modal on a later webview reload.
      BoardPanel.postOpenCard(boardId, cardId);
    } else {
      panel.pendingCardId = cardId;
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
    const config = this.store.getBoardConfig(this.boardId);
    const message: DataMessage = {
      type: 'data',
      boardId: this.boardId,
      board,
      config,
      boardPath: this.store.displayPath(this.boardId),
    };
    void this.panel.webview.postMessage(message);
  }

  private onMessage(msg: unknown): void {
    // Inbound messages are untrusted: narrow to the protocol union by
    // validating the discriminant and payload fields at runtime.
    if (!msg || typeof msg !== 'object') {
      return;
    }
    const m = msg as Record<string, unknown>;
    switch (m.type as WebviewToHostMessage['type']) {
      case 'ready': {
        this.postData();
        if (this.pendingCardId) {
          const msg: OpenCardMessage = { type: 'openCard', cardId: this.pendingCardId };
          this.pendingCardId = undefined;
          void this.panel.webview.postMessage(msg);
        }
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

  private getHtml(webview: vscode.Webview): string {
    return buildWebviewHtml({
      webview,
      extensionUri: this.extensionUri,
      title: 'RepoDoc Board',
      bodyHtml: '  <div id="app"></div>',
      stylesheets: ['base.css', 'board.css'],
      scriptFileName: 'board.js',
    });
  }
}
