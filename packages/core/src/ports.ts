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
