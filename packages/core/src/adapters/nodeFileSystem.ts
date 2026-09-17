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

/** Bound on symlink chasing, so a cycle of links cannot spin forever. */
const MAX_SYMLINK_DEPTH = 40;

/**
 * `abs` with symlinks resolved.
 *
 * Three cases, and the order matters:
 *
 *  1. `abs` IS a symlink — resolved or dangling. `realpathSync` throws on a
 *     dangling one, so the link is read and its target resolved instead.
 *     Falling through to case 3 here was a hole: the walk-up rejoined the leaf
 *     name onto an in-root parent and answered "inside", while `writeFileSync`
 *     followed the link and created the file outside.
 *  2. `abs` exists — `realpathSync` answers directly.
 *  3. `abs` does not exist — a file about to be created. The nearest existing
 *     ancestor is resolved and the remaining segments appended, so a new file
 *     under `docs/escape -> /etc` is judged by where `escape` points.
 */
function realPathOf(abs: string, depth = 0): string | undefined {
  if (depth > MAX_SYMLINK_DEPTH) {
    return undefined; // a cycle of links; nothing here can be trusted
  }

  let link: string | undefined;
  try {
    if (fs.lstatSync(abs).isSymbolicLink()) {
      link = fs.readlinkSync(abs);
    }
  } catch {
    // Does not exist at all — case 3 below.
  }
  if (link !== undefined) {
    return realPathOf(path.resolve(path.dirname(abs), link), depth + 1);
  }

  try {
    return fs.realpathSync(abs);
  } catch {
    // Case 3: judge by the nearest ancestor that does exist.
  }

  const parent = path.dirname(abs);
  if (parent === abs) {
    return undefined; // walked to the filesystem root and found nothing
  }
  const parentReal = realPathOf(parent, depth + 1);
  return parentReal === undefined ? undefined : path.join(parentReal, path.basename(abs));
}
