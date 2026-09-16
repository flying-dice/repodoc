/**
 * Ports for RepoDoc's core. Nothing in `src/core/**` may import 'vscode' or
 * node built-ins directly — it talks to the outside world only through these
 * interfaces, which the adapters in `src/adapters/**` implement.
 *
 * Every path passed to a FileSystemPort is workspace-relative, uses forward
 * slashes, is never absolute, and never contains a `..` segment.
 */

export interface DirEntry {
  name: string;
  kind: 'file' | 'dir';
}

export interface FileSystemPort {
  exists(relPath: string): boolean;
  /** File contents, or `undefined` when missing/unreadable. */
  readFile(relPath: string): string | undefined;
  /** Writes a file, creating parent directories as needed. */
  writeFile(relPath: string, content: string): void;
  /** Immediate children of a directory; `[]` when the directory is missing. */
  listDir(relPath: string): DirEntry[];
  rename(fromRel: string, toRel: string): void;
}

export interface ClockPort {
  now(): Date;
}

export type Disposable = { dispose(): void };

/** How a file differs from `HEAD` in the working tree. */
export type GitFileStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface GitStatusEntry {
  /** Workspace-relative path, forward slashes. */
  path: string;
  status: GitFileStatus;
  /** For renames: the workspace-relative path the file moved from. */
  from?: string;
}

/**
 * Read-only view of the workspace's git state. Every implementation degrades
 * silently: no git binary, no repository, or an unborn `HEAD` all report
 * `isRepo() === false` and empty results, so callers render as if git were
 * never there.
 *
 * Paths follow the same contract as FileSystemPort: workspace-relative,
 * forward slashes, never absolute, no `..` segment.
 */
export interface GitPort {
  isRepo(): boolean;
  /** Commit sha at `HEAD`, or `undefined` outside a repo / before the first commit. */
  headSha(): string | undefined;
  /** File contents at `HEAD`, or `undefined` when the path is not in `HEAD`. */
  readAtHead(relPath: string): string | undefined;
  /** Every workspace file differing from `HEAD`, tracked or not. */
  status(): GitStatusEntry[];
  /** Drop cached state; the next call re-reads from git. */
  invalidate(): void;
}
