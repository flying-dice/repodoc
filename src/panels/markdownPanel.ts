import * as vscode from 'vscode';
import { renderMarkdownWithDiagrams } from './diagrams';
import { isPresetWidth, resolveReadingWidth } from './readingWidth';
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
      // Scripts stay nonce-gated by the CSP; needed for mermaid rendering.
      enableScripts: true,
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
    // Frontmatter renders as a meta table between the title and the record.
    const meta = frontmatterTable(decision.frontmatter ?? { status: decision.status });
    const rendered = renderMarkdownWithDiagrams(decision.body, {
      plantUmlServer: plantUmlServer(),
    });
    let bodyHtml = rendered.html;
    const headingEnd = bodyHtml.indexOf('</h1>');
    bodyHtml =
      headingEnd === -1
        ? meta + bodyHtml
        : bodyHtml.slice(0, headingEnd + 5) + meta + bodyHtml.slice(headingEnd + 5);
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
      rendered.hasMermaid,
    );
  }

  private renderDoc(): void {
    const doc = this.store.readDoc(this.state.target);
    if (!doc) {
      // Record disappeared — leave the panel as-is.
      return;
    }
    const meta = doc.frontmatter ? frontmatterTable(doc.frontmatter) : '';
    const rendered = renderMarkdownWithDiagrams(doc.body, { plantUmlServer: plantUmlServer() });
    let bodyHtml = rendered.html;
    if (meta) {
      const headingEnd = bodyHtml.indexOf('</h1>');
      bodyHtml =
        headingEnd === -1
          ? meta + bodyHtml
          : bodyHtml.slice(0, headingEnd + 5) + meta + bodyHtml.slice(headingEnd + 5);
    }
    this.panel.title = MarkdownPanel.truncate(doc.title, 60);
    this.panel.webview.html = this.wrap(
      'Docs',
      doc.title,
      this.state.target,
      bodyHtml,
      rendered.hasMermaid,
    );
  }

  private wrap(
    section: string,
    leaf: string,
    fileCrumb: string,
    bodyHtml: string,
    hasMermaid = false,
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
      <div class="reading-column ${readingColumnAttrs().cls}"${readingColumnAttrs().style}>
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
      extraScripts: hasMermaid ? ['mermaid.min.js', 'mermaid-init.js'] : undefined,
      extraImgSrc: ['https:', 'data:', 'http://localhost:*', 'http://127.0.0.1:*'],
    });
  }

  private static truncate(text: string, max: number): string {
    if (text.length <= max) {
      return text;
    }
    return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
  }
}

/** Renders frontmatter as a compact key/value table for the reading view. */
function frontmatterTable(data: Record<string, unknown>): string {
  const rows = Object.entries(data)
    .map(([key, value]) => {
      const rendered = Array.isArray(value)
        ? value.map((v) => escapeHtml(String(v))).join(', ')
        : typeof value === 'boolean'
          ? value
            ? 'yes'
            : 'no'
          : escapeHtml(String(value));
      return `<tr><th>${escapeHtml(key)}</th><td>${rendered}</td></tr>`;
    })
    .join('');
  if (!rows) {
    return '';
  }
  return `<table class="fm-table"><tbody>${rows}</tbody></table>`;
}

/** Class + optional inline style for the reading column, from the setting. */
function readingColumnAttrs(): { cls: string; style: string } {
  const token = resolveReadingWidth();
  if (isPresetWidth(token)) {
    return { cls: `width-${token}`, style: '' };
  }
  return { cls: 'width-custom', style: ` style="max-width: ${token}"` };
}

/** The configured PlantUML server URL ('' disables PlantUML rendering). */
function plantUmlServer(): string {
  return vscode.workspace.getConfiguration('repodoc').get<string>('plantUmlServer') ?? '';
}
