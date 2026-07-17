import * as vscode from 'vscode';
import { marked } from 'marked';
import * as path from 'path';
import { RepoDocStore } from '../core/store';
import { resolveReadingWidth } from './readingWidth';
import { buildWebviewHtml } from './webviewHtml';
import {
  DataMessage,
  MoveBlockedMessage,
  OpenCardMessage,
  WebviewToHostMessage,
} from './protocol';
import { localIdentity } from './identity';
import { CustomFieldValue } from '../core/types';

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
   * Test/automation: ask an open board's webview to re-post `message` through
   * the real webview->host channel. Returns false when no panel is open.
   */
  public static postBounce(boardId: string, message: WebviewToHostMessage): boolean {
    const panel = BoardPanel.panels.get(boardId);
    if (!panel) {
      return false;
    }
    void panel.panel.webview.postMessage({ type: 'bounce', message });
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
    const descHtml: Record<string, string> = {};
    for (const card of Object.values(board.cards)) {
      if (card.desc) {
        descHtml[card.id] = marked.parse(card.desc) as string;
      }
    }
    const message: DataMessage = {
      type: 'data',
      boardId: this.boardId,
      board,
      config,
      boardPath: this.store.displayPath(this.boardId),
      descHtml,
      readingWidth: resolveReadingWidth(),
      commentAuthor: resolveCommentAuthor(this.store.root),
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
          this.handleMove(m.cardId, m.toColumn, m.index, m.override === true);
        }
        break;
      }
      case 'setField': {
        if (typeof m.cardId === 'string' && typeof m.fieldId === 'string') {
          const value = m.value;
          const ok =
            value === null ||
            typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'boolean' ||
            (Array.isArray(value) && value.every((v) => typeof v === 'string'));
          if (ok) {
            this.store.setCardField(
              this.boardId,
              m.cardId,
              m.fieldId,
              (value as CustomFieldValue | null) ?? undefined,
            );
          }
        }
        break;
      }
      case 'addComment': {
        if (typeof m.cardId === 'string' && typeof m.text === 'string') {
          const text = m.text.trim();
          const who = sanitizeAuthor(typeof m.who === 'string' ? m.who : '');
          if (text) {
            const author = who || resolveCommentAuthor(this.store.root);
            this.store.addComment(this.boardId, m.cardId, author, text);
            // Persist an edited name so it sticks across sessions.
            const config = vscode.workspace.getConfiguration('repodoc');
            if (who && who !== (config.get<string>('commentAuthor') ?? '').trim()) {
              void config.update('commentAuthor', who, vscode.ConfigurationTarget.Global);
            }
          }
        }
        break;
      }
      case 'openFile': {
        if (typeof m.path === 'string') {
          const line = m.line;
          const endLine = m.endLine;
          const lineOk =
            line === undefined ||
            (typeof line === 'number' && isFinite(line) && line > 0);
          const endOk =
            endLine === undefined ||
            (typeof endLine === 'number' && isFinite(endLine) && endLine > 0);
          if (lineOk && endOk) {
            void this.openFile(
              m.path,
              typeof line === 'number' ? line : undefined,
              typeof endLine === 'number' ? endLine : undefined,
            );
          }
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

  /**
   * Evaluate a proposed move against the target column's gates. When gates
   * block and the move is not overridden, tell the webview and hold. When
   * overridden, attribute an override to the local identity for each blocking
   * gate, then move.
   */
  private handleMove(
    cardId: string,
    toColumn: string,
    index: number,
    override: boolean,
  ): void {
    const results = this.store.evaluateMove(this.boardId, cardId, toColumn);
    const blocking = results.filter((r) => !r.satisfied);
    if (blocking.length && !override) {
      const message: MoveBlockedMessage = {
        type: 'moveBlocked',
        cardId,
        toColumn,
        results: blocking.map((r) => ({
          id: r.gate.id,
          label: r.gate.label ?? r.gate.id,
          satisfied: r.satisfied,
          reason: r.reason,
        })),
      };
      void this.panel.webview.postMessage(message);
      return;
    }
    if (blocking.length && override) {
      const who = localIdentity(this.store.root);
      for (const r of blocking) {
        this.store.recordGateOverride(this.boardId, cardId, r.gate.id, who);
      }
    }
    this.store.moveCard(this.boardId, cardId, toColumn, index);
  }

  /**
   * Open a repo file referenced from a comment link and reveal an optional line
   * range. The path is resolved against — and containment-checked to — the store
   * root; anything outside it (or any failure) is ignored with a warning.
   */
  private async openFile(rel: string, line?: number, endLine?: number): Promise<void> {
    const root = this.store.root;
    if (!root) {
      return;
    }
    try {
      const rootResolved = path.resolve(root);
      const abs = path.resolve(rootResolved, rel);
      if (abs !== rootResolved && !abs.startsWith(rootResolved + path.sep)) {
        return;
      }
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(abs));
      const editor = await vscode.window.showTextDocument(doc);
      if (line !== undefined) {
        const start = new vscode.Position(Math.max(0, line - 1), 0);
        const end = new vscode.Position(Math.max(0, endLine ?? line), 0);
        const selection = new vscode.Selection(start, end);
        editor.selection = selection;
        editor.revealRange(selection, vscode.TextEditorRevealType.InCenter);
      }
    } catch {
      void vscode.window.showWarningMessage(`RepoDoc: could not open ${rel}`);
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

/** The comment author: the setting when set, else the local git identity. */
function resolveCommentAuthor(root: string | undefined): string {
  const configured = sanitizeAuthor(
    vscode.workspace.getConfiguration('repodoc').get<string>('commentAuthor') ?? '',
  );
  return configured || localIdentity(root);
}

/** One line, trimmed, capped — author names never carry markup or newlines. */
function sanitizeAuthor(raw: string): string {
  return raw.replace(/[\r\n*]/g, ' ').trim().slice(0, 60);
}
