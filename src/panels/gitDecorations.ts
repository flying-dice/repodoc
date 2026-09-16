import * as vscode from 'vscode';
import { GitFileStatus, GitPort } from '../core/ports';

/** Badge and theme colour per status, matching VS Code's own SCM decorations. */
const DECORATIONS: Record<GitFileStatus, { badge: string; color: string; tooltip: string }> = {
  added: { badge: 'A', color: 'gitDecoration.addedResourceForeground', tooltip: 'Added' },
  modified: { badge: 'M', color: 'gitDecoration.modifiedResourceForeground', tooltip: 'Modified' },
  deleted: { badge: 'D', color: 'gitDecoration.deletedResourceForeground', tooltip: 'Deleted' },
  renamed: { badge: 'R', color: 'gitDecoration.renamedResourceForeground', tooltip: 'Renamed' },
};

/**
 * Decorates RepoDoc tree items whose file differs from `HEAD`. Tree items opt
 * in by carrying a `resourceUri`; everything else is left undecorated.
 *
 * VS Code asks per resource, so the status lookup is indexed once per refresh
 * rather than scanned per node.
 */
export class GitDecorationProvider implements vscode.FileDecorationProvider {
  private readonly emitter = new vscode.EventEmitter<undefined>();
  readonly onDidChangeFileDecorations = this.emitter.event;

  private index: Map<string, GitFileStatus> | undefined;

  constructor(
    private readonly git: GitPort,
    private readonly root: string | undefined,
  ) {}

  /** Drop the cached index and ask VS Code to re-query every decoration. */
  refresh(): void {
    this.index = undefined;
    this.emitter.fire(undefined);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    const relPath = this.toRelative(uri);
    if (relPath === undefined) {
      return undefined;
    }
    const status = this.statusIndex().get(relPath);
    if (!status) {
      return undefined;
    }
    const { badge, color, tooltip } = DECORATIONS[status];
    return {
      badge,
      tooltip,
      color: new vscode.ThemeColor(color),
      propagate: true,
    };
  }

  dispose(): void {
    this.emitter.dispose();
  }

  private statusIndex(): Map<string, GitFileStatus> {
    if (!this.index) {
      this.index = new Map(this.git.status().map((entry) => [entry.path, entry.status]));
    }
    return this.index;
  }

  /** Workspace-relative path with forward slashes, or `undefined` if outside. */
  private toRelative(uri: vscode.Uri): string | undefined {
    if (this.root === undefined || uri.scheme !== 'file') {
      return undefined;
    }
    const rel = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
    // asRelativePath hands back the original path when it is outside the folder.
    return rel.startsWith('/') || /^[a-zA-Z]:/.test(rel) ? undefined : rel;
  }
}
