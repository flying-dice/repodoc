import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
// Relative import on purpose: `bunx github:flying-dice/repodoc` runs this file
// from a plain checkout without a workspace install, so the CLI must not
// depend on `@repodoc/core` being resolvable as a package.
import {
  type FileSystemPort,
  NodeFileSystemAdapter,
  RepoDocStore,
  SystemClock,
} from '../../core/src/index';
import { type ParsedArgs, stringFlag, UsageError } from './args';

/** Everything a command needs: the store over the chosen root, plus identity. */
export interface CommandContext {
  root: string;
  fs: FileSystemPort;
  store: RepoDocStore;
  /** Author name for comments and gate evidence. */
  who: string;
  json: boolean;
}

/** How the root may be treated for this invocation. */
export interface ContextOptions {
  /** `init` alone may name a root that does not exist yet. */
  mayCreateRoot?: boolean;
}

export function buildContext(
  args: ParsedArgs,
  cwd = process.cwd(),
  options: ContextOptions = {},
): CommandContext {
  const root = resolveRoot(stringFlag(args.flags, 'root') ?? process.env['REPODOC_ROOT'], cwd);
  assertUsableRoot(root, options.mayCreateRoot === true);
  const fs = new NodeFileSystemAdapter(root);
  const store = new RepoDocStore(fs, new SystemClock(), root);
  const who =
    stringFlag(args.flags, 'who') ??
    process.env['REPODOC_AUTHOR'] ??
    gitUserName(root) ??
    os.userInfo().username;
  return { root, fs, store, who, json: args.flags['json'] === true };
}

/**
 * The workspace root. An explicit `--root` / `REPODOC_ROOT` wins. Otherwise
 * walk up from `cwd` to the nearest directory holding RepoDoc data (`boards/`,
 * `decisions/`, `docs/`, or `features/`), then to the nearest git root, else `cwd`
 * — so `repodoc init` in a fresh folder initializes that folder.
 */
export function resolveRoot(explicit: string | undefined, cwd: string): string {
  if (explicit) {
    return path.resolve(cwd, explicit);
  }
  const markers = ['boards', 'decisions', 'docs', 'features'];
  let dir = path.resolve(cwd);
  let gitRoot: string | undefined;
  for (;;) {
    if (markers.some((m) => isDir(path.join(dir, m)))) {
      return dir;
    }
    if (gitRoot === undefined && fs.existsSync(path.join(dir, '.git'))) {
      gitRoot = dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return gitRoot ?? path.resolve(cwd);
}

/**
 * The root has to be a directory. Pointing `--root` at a file, or at a path
 * that does not exist, silently produced an empty workspace — every list said
 * "none" and every write landed somewhere the caller did not mean. It is a
 * usage error instead; `init` may name a directory that does not exist yet.
 */
function assertUsableRoot(root: string, mayCreate: boolean): void {
  let stat: fs.Stats | undefined;
  try {
    stat = fs.statSync(root);
  } catch {
    stat = undefined;
  }
  if (stat === undefined) {
    if (mayCreate) {
      return;
    }
    throw new UsageError(
      `--root ${root} does not exist (run \`repodoc init --root ${root}\` to create it)`,
    );
  }
  if (!stat.isDirectory()) {
    throw new UsageError(`--root ${root} is not a directory`);
  }
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function gitUserName(root: string): string | undefined {
  try {
    const name = execFileSync('git', ['config', 'user.name'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    return name || undefined;
  } catch {
    return undefined;
  }
}
