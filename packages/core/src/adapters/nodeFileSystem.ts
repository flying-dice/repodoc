import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DirEntry, FileSystemPort } from '../ports';

/**
 * Node-backed FileSystemPort. All paths are workspace-relative; every one is
 * resolved and validated to stay inside the workspace root (defense in depth).
 *
 * The check is symlink-aware. `path.resolve` is lexical, so a link inside the
 * workspace pointing out of it — `docs/escape -> /etc` — produces a path whose
 * *string* is inside the root while the file is not. Both the root and the
 * target are resolved through `realpath` before they are compared, so the link
 * is followed before the decision rather than after it.
 */
export class NodeFileSystemAdapter implements FileSystemPort {
  /** The root with every symlink resolved; the root itself may be one. */
  private realRootCache: string | undefined;

  constructor(private readonly root: string) {}

  exists(relPath: string): boolean {
    const abs = this.resolve(relPath);
    return abs !== undefined && fs.existsSync(abs);
  }

  readFile(relPath: string): string | undefined {
    const abs = this.resolve(relPath);
    if (abs === undefined) {
      return undefined;
    }
    try {
      return fs.readFileSync(abs, 'utf8');
    } catch {
      return undefined;
    }
  }

  writeFile(relPath: string, content: string): void {
    const abs = this.resolve(relPath);
    if (abs === undefined) {
      throw new Error(`RepoDoc: refusing to write outside workspace: ${relPath}`);
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }

  listDir(relPath: string): DirEntry[] {
    const abs = this.resolve(relPath);
    if (abs === undefined) {
      return [];
    }
    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return [];
    }
    return dirents.map((d) => ({
      name: d.name,
      kind: d.isDirectory() ? 'dir' : 'file',
    }));
  }

  rename(fromRel: string, toRel: string): void {
    const from = this.resolve(fromRel);
    const to = this.resolve(toRel);
    if (from === undefined || to === undefined) {
      throw new Error(`RepoDoc: refusing to rename outside workspace: ${fromRel} -> ${toRel}`);
    }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
  }

  /** Absolute path, or `undefined` if `relPath` escapes the workspace root. */
  private resolve(relPath: string): string | undefined {
    if (path.isAbsolute(relPath)) {
      return undefined;
    }
    const segments = relPath.split(/[\\/]/);
    if (segments.includes('..')) {
      return undefined;
    }
    const realRoot = this.realRoot();
    const abs = path.resolve(realRoot, relPath);
    // Lexical first: it is free and rejects the ordinary cases.
    if (!contains(realRoot, abs)) {
      return undefined;
    }
    // Then the real one. A path that does not exist yet (a file being created)
    // is judged by the nearest parent that does.
    const real = realPathOf(abs);
    if (real === undefined || !contains(realRoot, real)) {
      return undefined;
    }
    return abs;
  }

  /**
   * The workspace root with symlinks resolved, computed once. A root that
   * cannot be resolved (it does not exist yet) falls back to the lexical path,
   * which keeps a not-yet-created workspace usable.
   */
  private realRoot(): string {
    if (this.realRootCache === undefined) {
      try {
        this.realRootCache = fs.realpathSync(this.root);
      } catch {
        this.realRootCache = path.resolve(this.root);
      }
    }
    return this.realRootCache;
  }
}

/** Whether `abs` is the root itself or sits beneath it. */
function contains(root: string, abs: string): boolean {
  if (abs === root) {
    return true;
  }
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  return abs.startsWith(rootWithSep);
}

/**
 * `abs` with symlinks resolved. When `abs` does not exist, the nearest existing
 * ancestor is resolved and the remaining segments are appended — so a file
 * about to be created under `docs/escape -> /etc` is judged by where `escape`
 * actually points, not by the name it was given.
 */
function realPathOf(abs: string): string | undefined {
  let current = abs;
  for (;;) {
    try {
      return path.join(fs.realpathSync(current), path.relative(current, abs));
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        return undefined; // walked to the filesystem root and found nothing
      }
      current = parent;
    }
  }
}
