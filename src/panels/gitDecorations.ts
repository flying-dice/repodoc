import * as path from 'path';
import * as vscode from 'vscode';
import { statusByPath } from '../core/gitStatus';
import { GitFileStatus, GitPort } from '../core/ports';

interface Decoration {
  badge: string;
  color: string;
  tooltip: string;
}

/**
 * Badge and theme colour per status, matching VS Code's own SCM decorations.
 *
 * `deleted` is deliberately absent. Every RepoDoc tree is built from files the
 * store can read, so a deleted file has no node left to paint — a `D` entry
 * here could never reach the screen. Showing deletions needs the trees to
 * overlay paths that exist only in `HEAD`, which this does not do.
 */
const DECORATIONS: Partial<Record<GitFileStatus, Decoration>> = {
  added: { badge: 'A', color: 'gitDecoration.addedResourceForeground', tooltip: 'Added' },
  modified: { badge: 'M', color: 'gitDecoration.modifiedResourceForeground', tooltip: 'Modified' },
  renamed: { badge: 'R', color: 'gitDecoration.renamedResourceForeground', tooltip: 'Renamed' },
};

/** What a directory gets when something beneath it changed. */
const CONTAINS_CHANGES: Decoration = {
  badge: 'M',
  color: 'gitDecoration.modifiedResourceForeground',
  tooltip: 'Contains uncommitted changes',
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

  private statuses: Map<string, GitFileStatus> | undefined;

  constructor(
    private readonly git: GitPort,
    private readonly root: string | undefined,
  ) {}

  /** Drop the cached statuses and ask VS Code to re-query every decoration. */
  refresh(): void {
    this.statuses = undefined;
    this.emitter.fire(undefined);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    const relPath = this.toRelative(uri);
    if (relPath === undefined) {
      return undefined;
    }
    const decoration = this.decorationFor(relPath);
    if (!decoration) {
      return undefined;
    }
    return {
      badge: decoration.badge,
      tooltip: decoration.tooltip,
      color: new vscode.ThemeColor(decoration.color),
      propagate: true,
    };
  }

  dispose(): void {
    this.emitter.dispose();
  }

  /**
   * The decoration for one tree node. Porcelain reports files, but the trees
   * also carry container nodes — a board folder, a docs directory — so a path
   * with no status of its own is decorated when anything beneath it changed.
   * `propagate` does not do this: VS Code asks about the container URI, which
   * was never in the status map.
   */
  private decorationFor(relPath: string): Decoration | undefined {
    const statuses = this.cachedStatuses();
    const own = statuses.get(relPath);
    if (own !== undefined) {
      return DECORATIONS[own];
    }
    const prefix = relPath + '/';
    for (const [changed, status] of statuses) {
      if (changed.startsWith(prefix) && DECORATIONS[status]) {
        return CONTAINS_CHANGES;
      }
    }
    return undefined;
  }

  private cachedStatuses(): Map<string, GitFileStatus> {
    if (!this.statuses) {
      this.statuses = statusByPath(this.git.status());
    }
    return this.statuses;
  }

  /** Workspace-relative path with forward slashes, or `undefined` if outside. */
  private toRelative(uri: vscode.Uri): string | undefined {
    if (this.root === undefined || uri.scheme !== 'file') {
      return undefined;
    }
    const rel = path.relative(this.root, uri.fsPath);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
      return undefined;
    }
    return rel.split(path.sep).join('/');
  }
}
