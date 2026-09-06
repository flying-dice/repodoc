import { FileSystemPort } from './ports';
import { SKILL_MD, SKILL_NAME } from './skillContent';

/** The coding agents RepoDoc knows how to install a skill file for. */
export type AgentKind = 'claude' | 'opencode';

/** Where each agent's skill file lives, relative to the workspace root. */
export const SKILL_TARGETS: Record<AgentKind, string> = {
  claude: `.claude/skills/${SKILL_NAME}/SKILL.md`,
  opencode: `.opencode/skill/${SKILL_NAME}/SKILL.md`,
};

/**
 * Writes and keeps in sync the RepoDoc agent skill file. It never imports
 * 'vscode' — it works purely through a {@link FileSystemPort}, so it is
 * unit-testable against the in-memory adapter and shares the store's FS.
 */
export class SkillManager {
  constructor(private readonly fs: FileSystemPort) {}

  /** The agent kinds that currently have a skill file on disk. */
  installed(): AgentKind[] {
    return kinds().filter((kind) => this.fs.exists(SKILL_TARGETS[kind]));
  }

  /** Writes the canonical skill file for `kind`, creating parent dirs. */
  install(kind: AgentKind): void {
    this.fs.writeFile(SKILL_TARGETS[kind], SKILL_MD);
  }

  /**
   * The installed skill files whose content has drifted from the canonical
   * {@link SKILL_MD}. Read-only — used to offer the user a sync.
   */
  outdated(): AgentKind[] {
    return this.installed().filter(
      (kind) => this.fs.readFile(SKILL_TARGETS[kind]) !== SKILL_MD,
    );
  }

  /**
   * Rewrites any installed skill file whose content has drifted from the
   * canonical {@link SKILL_MD}. Returns the kinds that were updated; files that
   * are already current (or not installed) are left untouched.
   */
  syncInstalled(): AgentKind[] {
    const updated: AgentKind[] = [];
    for (const kind of this.installed()) {
      if (this.fs.readFile(SKILL_TARGETS[kind]) !== SKILL_MD) {
        this.fs.writeFile(SKILL_TARGETS[kind], SKILL_MD);
        updated.push(kind);
      }
    }
    return updated;
  }
}

function kinds(): AgentKind[] {
  return Object.keys(SKILL_TARGETS) as AgentKind[];
}
