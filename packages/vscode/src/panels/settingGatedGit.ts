import type { GitPort, GitStatusEntry } from '@repodoc/core';
import * as vscode from 'vscode';

/**
 * Wraps a GitPort behind the `repodoc.git.enabled` setting. With the setting
 * off it answers exactly as it would outside a repository, so every surface
 * falls back to its plain, git-unaware rendering — no separate code path.
 *
 * The setting is read per call rather than cached, so turning it off takes
 * effect on the next render with no reload. That is affordable because the
 * wrapped adapter caches its own `HEAD` lookup; the setting read is the only
 * per-call cost.
 */
export class SettingGatedGitAdapter implements GitPort {
  constructor(private readonly inner: GitPort) {}

  isRepo(): boolean {
    return enabled() && this.inner.isRepo();
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
