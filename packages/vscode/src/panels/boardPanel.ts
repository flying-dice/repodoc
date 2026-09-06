import * as vscode from 'vscode';
import * as path from 'path';
import { CardMetaPatch, CustomFieldValue, Priority, RepoDocStore } from '@repodoc/core';
import { type BoardSource, CardBoardSource } from './boardSource';
import { resolveReadingWidth } from './readingWidth';
import { renderMarkdownWithDiagrams } from './diagrams';
import { plantUmlServer } from './plantUml';
import { buildWebviewHtml } from './webviewHtml';
import {
  BoardCapabilities,
  DataMessage,
  MoveBlockedMessage,
  OpenCardMessage,
  WebviewToHostMessage,
} from './protocol';
import { localIdentity } from './identity';
import { collectGatePrompts, toBlockedGate } from './gateGuidance';

/**
 * A kanban surface rendered in a webview — a card board or a feature set,
 * behind the {@link BoardSource} interface. One panel is kept per
 * `<kind>:<id>`.
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
    private readonly source: BoardSource,
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
    source: BoardSource,
  ): void {
    const key = panelKey(source.kind, source.id);
    const existing = BoardPanel.panels.get(key);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    const mediaUri = vscode.Uri.joinPath(extensionUri, 'media');
    const board = source.getBoard();
    const title = board ? board.name : source.id;

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

    BoardPanel.panels.set(key, new BoardPanel(panel, extensionUri, store, source));
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
    const panel = BoardPanel.panels.get(panelKey('board', boardId));
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
    const panel = BoardPanel.panels.get(panelKey('board', boardId));
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
    const key = panelKey('board', boardId);
    const existed = BoardPanel.panels.has(key);
    BoardPanel.createOrShow(extensionUri, store, new CardBoardSource(store, boardId));
    const panel = BoardPanel.panels.get(key);
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
    BoardPanel.panels.delete(panelKey(this.source.kind, this.source.id));
    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) {
        d.dispose();
      }
    }
  }

  private postData(): void {
    const board = this.source.getBoard();
    if (!board) {
      return;
    }
    this.panel.title = board.name;
    const config = this.source.getConfig();

    // Every content block (descriptions, comment journal entries) is rendered
    // through the one shared renderer used by the Docs and Decision views:
    // GitHub Flavored Markdown, Mermaid, and PlantUML.
    const server = plantUmlServer();
    const render = (md: string): string => renderMarkdownWithDiagrams(md, { plantUmlServer: server }).html;
    const descHtml: Record<string, string> = {};
    const commentHtml: Record<string, string[]> = {};
    const cardFiles: Record<string, string> = {};
    for (const card of Object.values(board.cards)) {
      if (card.desc) {
        descHtml[card.id] = render(card.desc);
      }
      if (card.comments && card.comments.length) {
        commentHtml[card.id] = card.comments.map((c) => render(c.text));
      }
      const file = this.source.cardFilePath?.(card.id);
      if (file) {
        cardFiles[card.id] = file;
      }
    }

    // Gate and column prompts are authored markdown, so they go through the
    // same renderer as descriptions and comments — one renderer, every block.
    const gatePromptHtml: Record<string, string> = {};
    for (const { key, prompt } of collectGatePrompts(board.columns)) {
      gatePromptHtml[key] = render(prompt);
    }
    const columnPromptHtml: Record<string, string> = {};
    for (const column of board.columns) {
      if (column.prompt) {
        columnPromptHtml[column.id] = render(column.prompt);
      }
    }

    const message: DataMessage = {
      type: 'data',
      boardId: this.source.id,
      board,
      config,
      boardPath: this.source.displayPath(),
      descHtml,
      commentHtml,
      readingWidth: resolveReadingWidth(),
      commentAuthor: resolveCommentAuthor(this.store.root),
      capabilities: this.capabilities(),
      cardFiles,
      gatePromptHtml,
      columnPromptHtml,
    };
    void this.panel.webview.postMessage(message);
  }

  /** The optional {@link BoardSource} methods this surface implements. */
  private capabilities(): BoardCapabilities {
    return {
      comments: this.source.addComment !== undefined,
      fields: this.source.setCardField !== undefined,
      checklist: this.source.toggleChecklistItem !== undefined,
      checklistAdd: this.source.addChecklistItem !== undefined,
      addColumn: this.source.addColumn !== undefined,
      meta: this.source.updateCardMeta !== undefined,
      description: this.source.setCardDescription !== undefined,
      gateEvidence: this.source.recordGateEvidence !== undefined,
    };
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
          this.handleMove(
            m.cardId,
            m.toColumn,
            m.index,
            m.override === true,
            typeof m.reason === 'string' ? m.reason : undefined,
          );
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
            this.source.setCardField?.(
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
          if (text && this.source.addComment) {
            const author = who || resolveCommentAuthor(this.store.root);
            this.source.addComment(m.cardId, author, text);
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
            this.source.addCard(m.column, title);
          }
        }
        break;
      }
      case 'addColumn': {
        void this.promptAddColumn();
        break;
      }
      case 'addChecklistItem': {
        if (typeof m.cardId === 'string' && typeof m.text === 'string') {
          const text = m.text.trim();
          if (text) {
            this.source.addChecklistItem?.(m.cardId, text);
          }
        }
        break;
      }
      case 'setDescription': {
        if (typeof m.cardId === 'string' && typeof m.text === 'string') {
          this.source.setCardDescription?.(m.cardId, m.text);
        }
        break;
      }
      case 'updateMeta': {
        if (typeof m.cardId === 'string' && m.patch && typeof m.patch === 'object') {
          const patch = sanitizeMetaPatch(m.patch as Record<string, unknown>);
          if (patch) {
            this.source.updateCardMeta?.(m.cardId, patch);
          }
        }
        break;
      }
      case 'recordGatePass': {
        if (
          typeof m.cardId === 'string' &&
          typeof m.gateId === 'string' &&
          typeof m.result === 'string'
        ) {
          const result = m.result.replace(/[\r\n]/g, ' ').trim();
          if (result) {
            this.source.recordGateEvidence?.(
              m.cardId,
              m.gateId,
              result,
              resolveCommentAuthor(this.store.root),
            );
          }
        }
        break;
      }
      case 'toggleCheck': {
        if (typeof m.cardId === 'string' && typeof m.index === 'number') {
          this.source.toggleChecklistItem?.(m.cardId, m.index);
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
    reason?: string,
  ): void {
    const results = this.source.evaluateMove(cardId, toColumn);
    const blocking = results.filter((r) => !r.satisfied);
    const why = (reason ?? '').replace(/[\r\n]/g, ' ').trim();
    if (blocking.length && !override) {
      const server = plantUmlServer();
      const message: MoveBlockedMessage = {
        type: 'moveBlocked',
        cardId,
        toColumn,
        results: blocking.map((r) => {
          const gate = toBlockedGate(r);
          gate.promptHtml = renderMarkdownWithDiagrams(gate.prompt ?? '', {
            plantUmlServer: server,
          }).html;
          return gate;
        }),
      };
      void this.panel.webview.postMessage(message);
      return;
    }
    if (blocking.length && override) {
      // The CLI refuses `--override` without `--reason` (commands.ts:209-211);
      // the UI must not write a weaker audit line than an agent does.
      if (!why) {
        void vscode.window.showWarningMessage(
          'RepoDoc: an override needs a reason — say why the gate was bypassed.',
        );
        return;
      }
      // Same identity rule as comments, so both hosts write the same name.
      const who = resolveCommentAuthor(this.store.root);
      for (const r of blocking) {
        this.source.recordGateOverride(cardId, r.gate.id, who, why);
      }
    }
    this.source.moveCard(cardId, toColumn, index);
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
    if (!this.source.addColumn) {
      return;
    }
    const name = await vscode.window.showInputBox({ prompt: 'List name' });
    if (name && name.trim()) {
      this.source.addColumn(name.trim());
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
      // Mermaid backs diagrams inside content blocks (descriptions, comments).
      extraScripts: ['mermaid.min.js'],
      // PlantUML content blocks load images from the configured/local server.
      extraImgSrc: ['https:', 'data:', 'http://localhost:*', 'http://127.0.0.1:*'],
    });
  }
}

/** Panel identity: two surfaces may share an id, so the kind is part of it. */
function panelKey(kind: BoardSource['kind'], id: string): string {
  return `${kind}:${id}`;
}

/** The comment author: the setting when set, else the local git identity. */
function resolveCommentAuthor(root: string | undefined): string {
  const configured = sanitizeAuthor(
    vscode.workspace.getConfiguration('repodoc').get<string>('commentAuthor') ?? '',
  );
  return configured || localIdentity(root);
}

const PRIORITIES: Priority[] = ['high', 'med', 'low'];

/**
 * Narrow an untrusted `updateMeta` payload to a {@link CardMetaPatch}. Unknown
 * keys and wrong-typed values are dropped; `null` is kept, because clearing is
 * how the webview mirrors the CLI's `--priority ""` convention. Returns
 * undefined when nothing usable survives.
 */
function sanitizeMetaPatch(raw: Record<string, unknown>): CardMetaPatch | undefined {
  const patch: CardMetaPatch = {};
  let any = false;

  if (typeof raw.title === 'string' && raw.title.trim()) {
    patch.title = raw.title.replace(/[\r\n]/g, ' ').trim();
    any = true;
  }
  if (raw.labels === null) {
    patch.labels = null;
    any = true;
  } else if (Array.isArray(raw.labels) && raw.labels.every((l) => typeof l === 'string')) {
    patch.labels = raw.labels as string[];
    any = true;
  }
  if (raw.priority === null) {
    patch.priority = null;
    any = true;
  } else if (PRIORITIES.includes(raw.priority as Priority)) {
    patch.priority = raw.priority as Priority;
    any = true;
  }
  for (const key of ['agent', 'status'] as const) {
    const value = raw[key];
    if (value === null) {
      patch[key] = null;
      any = true;
    } else if (typeof value === 'string') {
      const trimmed = value.replace(/[\r\n]/g, ' ').trim();
      patch[key] = trimmed === '' ? null : trimmed;
      any = true;
    }
  }
  if (raw.live === null || typeof raw.live === 'boolean') {
    patch.live = raw.live as boolean | null;
    any = true;
  }
  if (raw.progress === null) {
    patch.progress = null;
    any = true;
  } else if (typeof raw.progress === 'number' && Number.isFinite(raw.progress)) {
    patch.progress = Math.max(0, Math.min(100, Math.round(raw.progress)));
    any = true;
  }

  return any ? patch : undefined;
}

/** One line, trimmed, capped — author names never carry markup or newlines. */
function sanitizeAuthor(raw: string): string {
  return raw.replace(/[\r\n*]/g, ' ').trim().slice(0, 60);
}
