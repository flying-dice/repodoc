import { execFileSync } from 'child_process';
import * as path from 'path';
import { GitFileStatus, GitPort, GitStatusEntry } from '../core/ports';

/** Git calls are cheap but not free; nothing may hang the extension host. */
const GIT_TIMEOUT_MS = 5000;

/**
 * Git-backed GitPort that shells out to the `git` binary.
 *
 * The workspace root is not necessarily the repository root, so every path
 * crosses a prefix: workspace-relative going in, repository-relative going to
 * git, and back again on the way out. Paths outside the workspace are dropped
 * rather than reported with a `..` segment.
 *
 * `status()` and `readAtHead()` results are cached until {@link invalidate} is
 * called, so a tree render costs one `git status` rather than one per node.
 */
export class NodeGitAdapter implements GitPort {
  /** Repository-relative path of the workspace root; '' when they coincide. */
  private readonly prefix: string | undefined;
  private statusCache: GitStatusEntry[] | undefined;
  private readonly headCache = new Map<string, string | undefined>();

  constructor(private readonly root: string) {
    this.prefix = this.resolvePrefix();
  }

  isRepo(): boolean {
    return this.prefix !== undefined && this.headSha() !== undefined;
  }

  headSha(): string | undefined {
    if (this.prefix === undefined) {
      return undefined;
    }
    // Fails on an unborn HEAD — a repository with no commits yet.
    return this.git(['rev-parse', 'HEAD'])?.trim() || undefined;
  }

  readAtHead(relPath: string): string | undefined {
    const repoPath = this.toRepoPath(relPath);
    if (repoPath === undefined) {
      return undefined;
    }
    if (this.headCache.has(repoPath)) {
      return this.headCache.get(repoPath);
    }
    const content = this.git(['show', `HEAD:${repoPath}`]);
    this.headCache.set(repoPath, content);
    return content;
  }

  status(): GitStatusEntry[] {
    if (this.statusCache) {
      return this.statusCache;
    }
    if (this.prefix === undefined) {
      this.statusCache = [];
      return this.statusCache;
    }
    const raw = this.git([
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
      '--find-renames',
      // Scope to the workspace folder: in a monorepo the rest of the
      // repository is none of this workspace's business, and not asking for it
      // is cheaper than filtering it afterwards.
      '--',
      '.',
    ]);
    this.statusCache = raw === undefined ? [] : this.parseStatus(raw);
    return this.statusCache;
  }

  invalidate(): void {
    this.statusCache = undefined;
    this.headCache.clear();
  }

  /**
   * Parse `git status --porcelain=v1 -z`. Records are NUL-terminated; a rename
   * record is followed by a second NUL-terminated field holding the old path.
   */
  private parseStatus(raw: string): GitStatusEntry[] {
    const fields = raw.split('\0');
    const entries: GitStatusEntry[] = [];
    for (let i = 0; i < fields.length; i++) {
      const record = fields[i];
      if (record.length < 4) {
        continue; // trailing empty field from the final NUL
      }
      const index = record[0];
      const worktree = record[1];
      const repoPath = record.slice(3);
      let from: string | undefined;
      if (index === 'R' || index === 'C') {
        from = fields[++i];
      }
      const status = classify(index, worktree);
      if (!status) {
        continue;
      }
      const workspacePath = this.toWorkspacePath(repoPath);
      if (workspacePath === undefined) {
        continue; // outside the workspace folder
      }
      const fromWorkspace = from === undefined ? undefined : this.toWorkspacePath(from);
      entries.push({
        path: workspacePath,
        status,
        ...(fromWorkspace === undefined ? {} : { from: fromWorkspace }),
      });
    }
    return entries;
  }

  /** Repository-relative path of the workspace root, or `undefined` if not a repo. */
  private resolvePrefix(): string | undefined {
    const top = this.git(['rev-parse', '--show-toplevel'])?.trim();
    if (!top) {
      return undefined;
    }
    const rel = path.relative(path.resolve(top), path.resolve(this.root));
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return undefined; // the workspace is not inside the repository
    }
    return rel.split(path.sep).filter(Boolean).join('/');
  }

  private toRepoPath(relPath: string): string | undefined {
    if (path.isAbsolute(relPath) || this.prefix === undefined) {
      return undefined;
    }
    const segments = relPath.split(/[\\/]/).filter(Boolean);
    if (segments.includes('..')) {
      return undefined;
    }
    return [this.prefix, ...segments].filter(Boolean).join('/');
  }

  private toWorkspacePath(repoPath: string): string | undefined {
    if (!this.prefix) {
      return repoPath;
    }
    const prefix = this.prefix + '/';
    return repoPath.startsWith(prefix) ? repoPath.slice(prefix.length) : undefined;
  }

  /** Run git in the workspace root; `undefined` when git is absent or exits non-zero. */
  private git(args: string[]): string | undefined {
    try {
      return execFileSync('git', args, {
        cwd: this.root,
        encoding: 'utf8',
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      });
    } catch {
      return undefined;
    }
  }
}

/**
 * Collapse a porcelain XY status pair into how the file differs from `HEAD`.
 * Returns `undefined` for states that are not a difference worth showing —
 * ignored files, and files added then deleted again before committing.
 */
function classify(index: string, worktree: string): GitFileStatus | undefined {
  if (index === '!' || worktree === '!') {
    return undefined;
  }
  if (index === '?' || worktree === '?') {
    return 'added';
  }
  if (index === 'A' && worktree === 'D') {
    return undefined; // never reached HEAD, and gone again
  }
  if (index === 'D' || worktree === 'D') {
    return 'deleted';
  }
  if (index === 'A') {
    return 'added';
  }
  if (index === 'R' || index === 'C') {
    return 'renamed';
  }
  return 'modified';
}
