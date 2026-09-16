import type { DirEntry, FileSystemPort } from '../ports';

/**
 * In-memory FileSystemPort backed by a flat `Map<relPath, content>` with
 * directories implied by the keys. Pure TypeScript — no node imports — so the
 * core can be exercised in plain unit tests. Adds test-only `seed`/`snapshot`.
 */
export class MemFileSystemAdapter implements FileSystemPort {
  private readonly files = new Map<string, string>();

  exists(relPath: string): boolean {
    const key = normalize(relPath);
    if (key === '') {
      return true; // the root always exists
    }
    if (this.files.has(key)) {
      return true;
    }
    const prefix = `${key}/`;
    for (const existing of this.files.keys()) {
      if (existing.startsWith(prefix)) {
        return true; // an implied directory
      }
    }
    return false;
  }

  readFile(relPath: string): string | undefined {
    return this.files.get(normalize(relPath));
  }

  writeFile(relPath: string, content: string): void {
    this.files.set(normalize(relPath), content);
  }

  listDir(relPath: string): DirEntry[] {
    const key = normalize(relPath);
    const prefix = key === '' ? '' : `${key}/`;
    const files = new Set<string>();
    const dirs = new Set<string>();
    for (const existing of this.files.keys()) {
      if (prefix !== '' && !existing.startsWith(prefix)) {
        continue;
      }
      const rest = existing.slice(prefix.length);
      if (rest === '') {
        continue;
      }
      const slash = rest.indexOf('/');
      if (slash === -1) {
        files.add(rest);
      } else {
        dirs.add(rest.slice(0, slash));
      }
    }
    const entries: DirEntry[] = [];
    for (const name of dirs) {
      entries.push({ name, kind: 'dir' });
    }
    for (const name of files) {
      entries.push({ name, kind: 'file' });
    }
    return entries;
  }

  rename(fromRel: string, toRel: string): void {
    const from = normalize(fromRel);
    const to = normalize(toRel);
    const content = this.files.get(from);
    if (content === undefined) {
      return;
    }
    this.files.delete(from);
    this.files.set(to, content);
  }

  // ---- test helpers ----

  seed(files: Record<string, string>): void {
    for (const [relPath, content] of Object.entries(files)) {
      this.files.set(normalize(relPath), content);
    }
  }

  snapshot(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, content] of this.files) {
      out[key] = content;
    }
    return out;
  }
}

function normalize(relPath: string): string {
  return relPath
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+|\/+$/g, '');
}
