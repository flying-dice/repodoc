import * as vscode from 'vscode';
import { renderMarkdownWithDiagrams } from './diagrams';
import { renderMarkdownDiff } from './diffView';
import { plantUmlServer } from './plantUml';
import { isPresetWidth, resolveReadingWidth } from './readingWidth';
import { hasMarkdownChanges } from '../core/diff';
import { statusByPath } from '../core/gitStatus';
import { parseFrontmatter } from '../core/frontmatter';
import { GitPort } from '../core/ports';
import { RepoDocStore } from '../core/store';
import { DIFF_OFF_LABEL, DIFF_ON_LABEL } from './protocol';
import { buildWebviewHtml, escapeHtml } from './webviewHtml';

/**
 * The reading view's entire webview→host contract: one message, sent when the
 * top-bar toggle is clicked.
 *
 * NOTE: `media/markdown.js` mirrors this MANUALLY — that webview is loaded as
 * plain JS with no build step, so there is no shared compilation. Inbound
 * messages are untrusted; the handler validates the discriminant before acting.
 */
export const TOGGLE_DIFF = 'toggleDiff';

export interface ToggleDiffMessage {
  type: typeof TOGGLE_DIFF;
}

type PanelKind = 'decision' | 'doc';

/** Reading the current file, or comparing it against `HEAD`. */
type ViewMode = 'read' | 'diff';

/** Added/removed counts and render time, shown in the top bar's legend. */
interface DiffSummary {
  added: number;
  removed: number;
  elapsedMs: number;
}

interface RenderedBody {
  html: string;
  hasMermaid: boolean;
  /** Present only when a diff actually rendered. */
  diff?: DiffSummary;
  /** Whether this file's rendered body has something to compare against `HEAD`. */
  canDiffAgainstHead: boolean;
  /**
   * The file differs from `HEAD` but its body does not — only frontmatter
   * moved. There is nothing for the diff view to show, so the top bar says so
   * rather than offering a toggle that would render an identical page.
   */
  metadataOnly: boolean;
}

interface PanelState {
  kind: PanelKind;
  /** For decisions: the decision id. For docs: the repo-relative path. */
  target: string;
  mode: ViewMode;
}

/**
 * Renders Decision (ADR) and Docs markdown to HTML in the extension host and
 * shows it in a reusable webview panel. Two singletons are kept: one for
 * decisions, one for docs.
 *
 * When the workspace is a git repository and the file differs from `HEAD`, the
 * top bar offers a diff mode that renders the same document with added and
 * removed blocks marked in place.
 */
export class MarkdownPanel {
  private static decisionPanel: MarkdownPanel | undefined;
  private static docPanel: MarkdownPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly store: RepoDocStore;
  private readonly git: GitPort;
  private state: PanelState;
  /** Whether the last render actually produced a diff (not a fallback to reading). */
  private showingDiff = false;

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    store: RepoDocStore,
    git: GitPort,
    state: PanelState,
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.store = store;
    this.git = git;
    this.state = state;

    this.panel.webview.onDidReceiveMessage((message: unknown) => {
      // Untrusted input from the webview — validate before acting.
      if (
        message &&
        typeof message === 'object' &&
        (message as { type?: unknown }).type === TOGGLE_DIFF
      ) {
        this.toggle();
      }
    });

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
    git: GitPort,
    decisionId: string,
  ): void {
    const existing = MarkdownPanel.decisionPanel;
    if (existing) {
      existing.state = { kind: 'decision', target: decisionId, mode: 'read' };
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
    const instance = new MarkdownPanel(panel, extensionUri, store, git, {
      kind: 'decision',
      target: decisionId,
      mode: 'read',
    });
    MarkdownPanel.decisionPanel = instance;
    instance.render();
  }

  /** Show (or reveal) the doc panel for the given repo-relative path. */
  public static showDoc(
    extensionUri: vscode.Uri,
    store: RepoDocStore,
    git: GitPort,
    relPath: string,
  ): void {
    const existing = MarkdownPanel.docPanel;
    if (existing) {
      existing.state = { kind: 'doc', target: relPath, mode: 'read' };
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
    const instance = new MarkdownPanel(panel, extensionUri, store, git, {
      kind: 'doc',
      target: relPath,
      mode: 'read',
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

  /**
   * Flip the visible panel between reading and diff. Returns false when no
   * panel is open or the file has nothing to compare. Used by the command and
   * by e2e tests.
   */
  public static toggleDiff(): boolean {
    const panel = MarkdownPanel.focused();
    return panel ? panel.toggle() : false;
  }

  /**
   * The panel the command should act on: the active one, else whichever is
   * visible, else the only one open. Preferring Docs unconditionally would
   * toggle the wrong view whenever both are open.
   */
  private static focused(): MarkdownPanel | undefined {
    const open = [MarkdownPanel.docPanel, MarkdownPanel.decisionPanel].filter(
      (panel): panel is MarkdownPanel => panel !== undefined,
    );
    return (
      open.find((p) => p.panel.active) ?? open.find((p) => p.panel.visible) ?? open[0]
    );
  }

  /**
   * Flip between reading and diff and re-render. Returns whether a diff is now
   * on screen: asking for one with nothing to compare falls back to reading,
   * which the render path already handles, so there is nothing to pre-check.
   */
  private toggle(): boolean {
    // The working tree may have moved since the last render — never diff
    // against a stale cache.
    this.git.invalidate();
    this.state = { ...this.state, mode: this.state.mode === 'diff' ? 'read' : 'diff' };
    this.render();
    if (!this.showingDiff) {
      // The diff fell back to reading; leave the mode where the view actually
      // is, or the next click would look like it did nothing.
      this.state = { ...this.state, mode: 'read' };
    }
    return this.showingDiff;
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
    const fileCrumb = `decisions/${decision.file}`;
    const rendered = this.renderBody(decision.body);
    const bodyHtml = rendered.diff ? rendered.html : insertAfterHeading(rendered.html, meta);
    this.panel.title = MarkdownPanel.title(
      `ADR-${decision.num} — ${decision.title}`,
      rendered.diff !== undefined,
    );
    this.panel.webview.html = this.wrap(
      'Decisions',
      decision.title,
      fileCrumb,
      bodyHtml,
      rendered,
    );
  }

  private renderDoc(): void {
    const doc = this.store.readDoc(this.state.target);
    if (!doc) {
      // Record disappeared — leave the panel as-is.
      return;
    }
    const meta = doc.frontmatter ? frontmatterTable(doc.frontmatter) : '';
    const rendered = this.renderBody(doc.body);
    const bodyHtml =
      rendered.diff || !meta ? rendered.html : insertAfterHeading(rendered.html, meta);
    this.panel.title = MarkdownPanel.title(doc.title, rendered.diff !== undefined);
    this.panel.webview.html = this.wrap(
      'Docs',
      doc.title,
      this.state.target,
      bodyHtml,
      rendered,
    );
  }

  /**
   * Render the body in whichever mode is active. Falls back to reading mode
   * when a diff was asked for but there is no baseline to compare against —
   * outside a repository, or once the file matches `HEAD` again.
   */
  private renderBody(body: string): RenderedBody {
    const head = this.headBody();
    const canDiffAgainstHead = head !== undefined && hasMarkdownChanges(head, body);
    const metadataOnly = !canDiffAgainstHead && this.fileChanged();
    if (this.state.mode === 'diff' && head !== undefined && canDiffAgainstHead) {
      // Timing is reported in the top bar, so it is measured here, at the call
      // site, rather than baked into the renderer.
      const startedAt = Date.now();
      const result = renderMarkdownDiff(head, body, { plantUmlServer: plantUmlServer() });
      this.showingDiff = true;
      return {
        html: result.html,
        hasMermaid: result.hasMermaid,
        diff: { added: result.added, removed: result.removed, elapsedMs: Date.now() - startedAt },
        canDiffAgainstHead,
        metadataOnly,
      };
    }
    const rendered = renderMarkdownWithDiagrams(body, { plantUmlServer: plantUmlServer() });
    this.showingDiff = false;
    return {
      html: rendered.html,
      hasMermaid: rendered.hasMermaid,
      canDiffAgainstHead,
      metadataOnly,
    };
  }

  /** Workspace-relative path of the file behind the panel, if it still exists. */
  private filePath(): string | undefined {
    if (this.state.kind === 'doc') {
      return this.state.target;
    }
    const decision = this.store.getDecision(this.state.target);
    return decision ? `decisions/${decision.file}` : undefined;
  }

  /** Whether git reports this file as differing from `HEAD` in any way at all. */
  private fileChanged(): boolean {
    const relPath = this.filePath();
    if (relPath === undefined || !this.git.isRepo()) {
      return false;
    }
    return statusByPath(this.git.status()).has(relPath);
  }

  /** Body of this file at `HEAD`, or `undefined` outside a repository. */
  private headBody(): string | undefined {
    if (!this.git.isRepo()) {
      return undefined;
    }
    const path = this.filePath();
    if (path === undefined) {
      return undefined;
    }
    const head = this.git.readAtHead(path);
    // A file absent from HEAD is new: its whole body reads as an addition.
    return head === undefined ? '' : parseFrontmatter(head).body;
  }

  private wrap(
    section: string,
    leaf: string,
    fileCrumb: string,
    bodyHtml: string,
    rendered: RenderedBody,
  ): string {
    const body = `  <div class="page">
    <div class="topbar">
      <div class="crumb">
        <span class="crumb-section">${escapeHtml(section)}</span>
        <span class="crumb-sep">/</span>
        <span class="crumb-leaf">${escapeHtml(leaf)}</span>
      </div>
${gitBar(rendered)}
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
      scriptFileName: 'markdown.js',
      extraScripts: rendered.hasMermaid ? ['mermaid.min.js', 'mermaid-init.js'] : undefined,
      extraImgSrc: ['https:', 'data:', 'http://localhost:*', 'http://127.0.0.1:*'],
    });
  }

  /** Panel tab title: the leaf name, shortened, with the mode spelled out. */
  private static title(text: string, isDiff: boolean): string {
    const suffix = isDiff ? ` (${DIFF_ON_LABEL})` : '';
    const room = 60 - suffix.length;
    const head = text.length <= room ? text : `${text.slice(0, Math.max(0, room - 1)).trimEnd()}…`;
    return head + suffix;
  }
}

/**
 * The git strip in the top bar: a toggle when the file differs from `HEAD`,
 * plus the legend and timing once a diff is on screen. Renders nothing at all
 * outside a repository or when the file matches `HEAD`.
 */
function gitBar(rendered: RenderedBody): string {
  if (!rendered.canDiffAgainstHead) {
    // Frontmatter moved but the prose did not: say so, offer nothing to click.
    return rendered.metadataOnly
      ? `      <div class="gitbar"><span class="git-note">metadata changed</span></div>`
      : '';
  }
  const diff = rendered.diff;
  const legend = diff
    ? `      <span class="git-legend">
        <span class="git-swatch git-swatch-add"></span>${diff.added} added
        <span class="git-swatch git-swatch-del"></span>${diff.removed} removed
        <span class="git-timing">${diff.elapsedMs} ms</span>
      </span>\n`
    : '';
  const label = diff ? DIFF_OFF_LABEL : DIFF_ON_LABEL;
  return `      <div class="gitbar">
${legend}        <button type="button" id="diff-toggle" class="git-toggle${diff ? ' is-on' : ''}">${label}</button>
      </div>`;
}

/**
 * Splice a block in after the document's `<h1>`, or at the top when the
 * document has no heading.
 */
function insertAfterHeading(html: string, block: string): string {
  if (!block) {
    return html;
  }
  const headingEnd = html.indexOf('</h1>');
  return headingEnd === -1
    ? block + html
    : html.slice(0, headingEnd + 5) + block + html.slice(headingEnd + 5);
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
