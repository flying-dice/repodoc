import * as vscode from 'vscode';
import { GitPort, GitStatusEntry } from '../core/ports';

/**
 * Wraps a GitPort behind the `repodoc.git.enabled` setting. With the setting
 * off it answers exactly as it would outside a repository, so every surface
 * falls back to its plain, git-unaware rendering — no separate code path.
 *
 * The setting is read per call rather than cached, so toggling it takes effect
 * on the next render with no reload.
 */
export class GatedGit implements GitPort {
  constructor(private readonly inner: GitPort) {}

  isRepo(): boolean {
    return enabled() && this.inner.isRepo();
  }

  headSha(): string | undefined {
    return this.isRepo() ? this.inner.headSha() : undefined;
  }

  readAtHead(relPath: string): string | undefined {
    return this.isRepo() ? this.inner.readAtHead(relPath) : undefined;
  }

  status(): GitStatusEntry[] {
    return this.isRepo() ? this.inner.status() : [];
  }

  invalidate(): void {
    this.inner.invalidate();
  }
}

function enabled(): boolean {
  return vscode.workspace.getConfiguration('repodoc').get<boolean>('git.enabled', true);
}
