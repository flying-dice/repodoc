import { GitPort, GitStatusEntry } from '../core/ports';

/**
 * In-memory GitPort: a snapshot of `HEAD` plus whatever status the test wants
 * to declare. Pure TypeScript — no node imports — so the core and the panels
 * can be exercised without a real repository.
 *
 * Constructed with no `HEAD` snapshot it reports `isRepo() === false`, which
 * is the shape every "not a git repository" test needs.
 */
export class MemGitAdapter implements GitPort {
  private head: Map<string, string> | undefined;
  private entries: GitStatusEntry[] = [];
  /** Test assertion hook: how many times the cache has been dropped. */
  public invalidations = 0;

  /** Declare the contents of `HEAD`; this also makes `isRepo()` true. */
  seedHead(files: Record<string, string>): void {
    this.head = new Map(Object.entries(files));
  }

  /** Declare what differs from `HEAD`. */
  seedStatus(entries: GitStatusEntry[]): void {
    this.entries = entries;
  }

  isRepo(): boolean {
    return this.head !== undefined;
  }

  headSha(): string | undefined {
    return this.head === undefined ? undefined : 'a'.repeat(40);
  }

  readAtHead(relPath: string): string | undefined {
    return this.head?.get(normalize(relPath));
  }

  status(): GitStatusEntry[] {
    return this.isRepo() ? this.entries : [];
  }

  invalidate(): void {
    this.invalidations++;
  }
}

function normalize(relPath: string): string {
  return relPath.split(/[\\/]/).filter(Boolean).join('/');
}
