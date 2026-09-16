import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import type { GitFileStatus, GitPort, GitStatusEntry } from '../ports';

/**
 * Upper bound on any single git call. These are synchronous, so a slow call
 * does block the extension host — the timeout and the caches below bound how
 * long and how often, they do not make it asynchronous.
 */
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
  /**
   * Repository-relative path of the workspace root, '' when they coincide, and
   * `null` when the workspace is not in a repository at all. Resolved lazily
   * and dropped on {@link invalidate}, because a workspace can become a
   * repository (`git init`) while the editor is open.
   */
  private prefixCache: string | null | undefined;
  private statusCache: GitStatusEntry[] | undefined;
  private readonly headCache = new Map<string, string | undefined>();
  /** `undefined` = not looked up yet; `null` = looked up, no commit. */
  private headShaCache: string | null | undefined;

  constructor(private readonly root: string) {}

  /** Repository-relative path of the workspace root, or `undefined` if not a repo. */
  private get prefix(): string | undefined {
    if (this.prefixCache === undefined) {
      this.prefixCache = this.resolvePrefix() ?? null;
    }
    return this.prefixCache ?? undefined;
  }

  isRepo(): boolean {
    return this.headSha() !== undefined;
  }

  /**
   * Commit sha at `HEAD`, or `undefined` outside a repository and on an unborn
   * `HEAD`. Cached: `isRepo()` gates nearly every call into this adapter, so an
   * uncached lookup here would spawn a `git` process per question asked.
   */
  private headSha(): string | undefined {
    if (this.prefix === undefined) {
      return undefined;
    }
    if (this.headShaCache === undefined) {
      this.headShaCache = this.git(['rev-parse', 'HEAD'])?.trim() || null;
    }
    return this.headShaCache ?? undefined;
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
    this.prefixCache = undefined;
    this.statusCache = undefined;
    this.headShaCache = undefined;
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
      if (record === undefined || record.length < 4) {
        continue; // trailing empty field from the final NUL
      }
      const index = record[0] ?? '';
      const worktree = record[1] ?? '';
      const repoPath = record.slice(3);
      if (index === 'R' || index === 'C') {
        i++; // a rename record is followed by the path it came from
      }
      const status = classify(index, worktree);
      if (!status) {
        continue;
      }
      const workspacePath = this.toWorkspacePath(repoPath);
      if (workspacePath === undefined) {
        continue; // outside the workspace folder
      }
      entries.push({ path: workspacePath, status });
    }
    return entries;
  }

  private resolvePrefix(): string | undefined {
    const top = this.git(['rev-parse', '--show-toplevel'])?.trim();
    if (!top) {
      return undefined;
    }
    const rel = path.relative(path.resolve(top), path.resolve(this.root));
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return undefined; // the workspace is not inside the repository
    }
    return toPosix(rel);
  }

  private toRepoPath(relPath: string): string | undefined {
    if (path.isAbsolute(relPath) || this.prefix === undefined) {
      return undefined;
    }
    const relative = toPosix(relPath);
    if (relative.split('/').includes('..')) {
      return undefined;
    }
    return [this.prefix, relative].filter(Boolean).join('/');
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

/** Path with forward slashes and no empty segments, as the ports contract requires. */
function toPosix(relPath: string): string {
  return relPath.split(/[\\/]/).filter(Boolean).join('/');
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
