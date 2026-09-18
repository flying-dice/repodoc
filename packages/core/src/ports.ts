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
  /**
   * For a staged rename, where the file was before it moved.
   *
   * This is not bookkeeping: `HEAD` still holds the content under the old path,
   * so a baseline lookup that asks for the new one finds nothing and the file
   * reads as newly added.
   */
  originalPath?: string;
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
  /** True only when there is a repository with at least one commit to compare against. */
  isRepo(): boolean;
  /**
   * File contents at `HEAD`, or `undefined` when the path is not in `HEAD`.
   * A staged rename resolves through its original path.
   */
  readAtHead(relPath: string): string | undefined;
  /**
   * The path `readAtHead` would consult for `relPath` — the pre-rename name
   * when the file moved, otherwise `relPath` itself. Exposed so a caller can
   * say what it compared against rather than implying the file is new.
   */
  baselinePathOf(relPath: string): string;
  /** Every workspace file differing from `HEAD`, tracked or not. */
  status(): GitStatusEntry[];
  /** Drop cached state; the next call re-reads from git. */
  invalidate(): void;
}
