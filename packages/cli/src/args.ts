/**
 * Minimal argv parser — the CLI has no runtime dependencies so it can be run
 * straight from a git checkout with `bunx github:flying-dice/repodoc`.
 *
 * Grammar: positionals in order; `--name value`, `--name=value`, or a bare
 * `--name` (boolean `true`). `--no-name` sets `false`. A lone `--` ends flag
 * parsing so values that start with `-` can be passed as positionals.
 */
export interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let onlyPositionals = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (onlyPositionals || !arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    if (arg === '--') {
      onlyPositionals = true;
      continue;
    }
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    if (eq !== -1) {
      flags[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }
    if (body.startsWith('no-')) {
      flags[body.slice(3)] = false;
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[body] = next;
      i++;
    } else {
      flags[body] = true;
    }
  }
  return { positionals, flags };
}

/** String flag, or `undefined` when absent or given as a bare boolean. */
export function stringFlag(flags: ParsedArgs['flags'], name: string): string | undefined {
  const v = flags[name];
  return typeof v === 'string' ? v : undefined;
}

/** Boolean flag: `--x` / `--x=true` → true, `--no-x` / `--x=false` → false. */
export function boolFlag(flags: ParsedArgs['flags'], name: string): boolean | undefined {
  const v = flags[name];
  if (v === undefined) {
    return undefined;
  }
  if (typeof v === 'boolean') {
    return v;
  }
  const s = v.trim().toLowerCase();
  if (s === 'true' || s === 'yes' || s === '1') {
    return true;
  }
  if (s === 'false' || s === 'no' || s === '0') {
    return false;
  }
  throw new UsageError(`--${name} expects true or false, got "${v}"`);
}

/** Integer flag; a non-integer value is a usage error. */
export function intFlag(flags: ParsedArgs['flags'], name: string): number | undefined {
  const v = stringFlag(flags, name);
  if (v === undefined) {
    return undefined;
  }
  const n = Number(v);
  if (!Number.isInteger(n)) {
    throw new UsageError(`--${name} expects an integer, got "${v}"`);
  }
  return n;
}

/** Raised for bad invocations; the entry point prints it and exits 2. */
export class UsageError extends Error {}

/** Raised when the store refuses an operation; the entry point exits 1. */
export class CommandError extends Error {}
