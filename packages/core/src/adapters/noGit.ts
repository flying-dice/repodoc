import type { GitPort, GitStatusEntry } from '../ports';

/**
 * GitPort for "there is no repository here": no workspace folder open, or git
 * awareness switched off. Every answer is the same one a real adapter gives
 * outside a repository, so callers need no separate code path.
 */
export class NoGitAdapter implements GitPort {
  isRepo(): boolean {
    return false;
  }

  readAtHead(): string | undefined {
    return undefined;
  }

  status(): GitStatusEntry[] {
    return [];
  }

  invalidate(): void {
    /* nothing is cached */
  }
}
