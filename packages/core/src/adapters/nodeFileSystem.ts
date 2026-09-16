import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DirEntry, FileSystemPort } from '../ports';

/**
 * Node-backed FileSystemPort. All paths are workspace-relative; every one is
 * resolved and validated to stay inside the workspace root (defense in depth).
 */
export class NodeFileSystemAdapter implements FileSystemPort {
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
    const abs = path.resolve(this.root, relPath);
    const rootWithSep = this.root.endsWith(path.sep) ? this.root : this.root + path.sep;
    if (abs !== this.root && !abs.startsWith(rootWithSep)) {
      return undefined;
    }
    return abs;
  }
}
