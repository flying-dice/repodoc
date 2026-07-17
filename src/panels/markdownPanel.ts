import * as vscode from 'vscode';
import { marked } from 'marked';
import { RepoDocStore } from '../core/store';
import { buildWebviewHtml, escapeHtml } from './webviewHtml';

type PanelKind = 'decision' | 'doc';

interface PanelState {
  kind: PanelKind;
  /** For decisions: the decision id. For docs: the repo-relative path. */
  target: string;
}

/**
 * Renders Decision (ADR) and Docs markdown to HTML in the extension host and
 * shows it in a reusable webview panel. Two singletons are kept: one for
 * decisions, one for docs.
 */
export class MarkdownPanel {
  private static decisionPanel: MarkdownPanel | undefined;
  private static docPanel: MarkdownPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly store: RepoDocStore;
  private state: PanelState;

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    store: RepoDocStore,
    state: PanelState,
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.store = store;
    this.state = state;

    this.panel.onDidDispose(() => {
      if (this.state.kind === 'decision') {
        MarkdownPanel.decisionPanel = undefined;
      } else {
        MarkdownPanel.docPanel = undefined;
      }
    });
  }

  /** Show (or reveal) the decision panel for the given decision id. */
  public static showDecision(
    extensionUri: vscode.Uri,
    store: RepoDocStore,
    decisionId: string,
  ): void {
    const existing = MarkdownPanel.decisionPanel;
    if (existing) {
      existing.state = { kind: 'decision', target: decisionId };
      existing.render();
      existing.panel.reveal(vscode.ViewColumn.One);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'repodoc.decision',
      'Decision',
      vscode.ViewColumn.One,
      MarkdownPanel.panelOptions(extensionUri),
    );
    const instance = new MarkdownPanel(panel, extensionUri, store, {
      kind: 'decision',
      target: decisionId,
    });
    MarkdownPanel.decisionPanel = instance;
    instance.render();
  }

  /** Show (or reveal) the doc panel for the given repo-relative path. */
  public static showDoc(
    extensionUri: vscode.Uri,
    store: RepoDocStore,
    relPath: string,
  ): void {
    const existing = MarkdownPanel.docPanel;
    if (existing) {
      existing.state = { kind: 'doc', target: relPath };
      existing.render();
      existing.panel.reveal(vscode.ViewColumn.One);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'repodoc.doc',
      'Doc',
      vscode.ViewColumn.One,
      MarkdownPanel.panelOptions(extensionUri),
    );
    const instance = new MarkdownPanel(panel, extensionUri, store, {
      kind: 'doc',
      target: relPath,
    });
    MarkdownPanel.docPanel = instance;
    instance.render();
  }

  /**
   * Re-render whichever panels are open from the store. If the underlying
   * record has disappeared, the panel is left as-is.
   */
  public static refreshAll(): void {
    if (MarkdownPanel.decisionPanel) {
      MarkdownPanel.decisionPanel.render();
    }
    if (MarkdownPanel.docPanel) {
      MarkdownPanel.docPanel.render();
    }
  }

  private static panelOptions(
    extensionUri: vscode.Uri,
  ): vscode.WebviewPanelOptions & vscode.WebviewOptions {
    return {
      enableScripts: false,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
    };
  }

  private render(): void {
    if (this.state.kind === 'decision') {
      this.renderDecision();
    } else {
      this.renderDoc();
    }
  }

  private renderDecision(): void {
    const decision = this.store.getDecision(this.state.target);
    if (!decision) {
      // Record disappeared — leave the panel as-is.
      return;
    }
    const bodyHtml = marked.parse(decision.body) as string;
    const fileCrumb = `decisions/${decision.file}`;
    this.panel.title = MarkdownPanel.truncate(
      `ADR-${decision.num} — ${decision.title}`,
      60,
    );
    this.panel.webview.html = this.wrap(
      'Decisions',
      decision.title,
      fileCrumb,
      bodyHtml,
    );
  }

  private renderDoc(): void {
    const doc = this.store.readDoc(this.state.target);
    if (!doc) {
      // Record disappeared — leave the panel as-is.
      return;
    }
    const bodyHtml = marked.parse(doc.body) as string;
    this.panel.title = MarkdownPanel.truncate(doc.title, 60);
    this.panel.webview.html = this.wrap(
      'Docs',
      doc.title,
      this.state.target,
      bodyHtml,
    );
  }

  private wrap(
    section: string,
    leaf: string,
    fileCrumb: string,
    bodyHtml: string,
  ): string {
    const body = `  <div class="page">
    <div class="topbar">
      <div class="crumb">
        <span class="crumb-section">${escapeHtml(section)}</span>
        <span class="crumb-sep">/</span>
        <span class="crumb-leaf">${escapeHtml(leaf)}</span>
      </div>
    </div>
    <div class="content">
      <div class="reading-column">
        <div class="filecrumb">${escapeHtml(fileCrumb)}</div>
        <div class="adr-md">${bodyHtml}</div>
      </div>
    </div>
  </div>`;

    return buildWebviewHtml({
      webview: this.panel.webview,
      extensionUri: this.extensionUri,
      title: leaf,
      bodyHtml: body,
      stylesheets: ['base.css', 'markdown.css'],
      extraImgSrc: ['https:', 'data:'],
    });
  }

  private static truncate(text: string, max: number): string {
    if (text.length <= max) {
      return text;
    }
    return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
  }
}
