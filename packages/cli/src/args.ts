/**
 * Minimal argv parser — the CLI has no runtime dependencies so it can be run
 * straight from a git checkout with `bunx github:flying-dice/repodoc`.
 *
 * Grammar: positionals in order; `--name value`, `--name=value`, or a bare
 * `--name` (boolean `true`). `--no-name` sets `false`. A lone `--` ends flag
 * parsing so values that start with `-` can be passed as positionals.
 *
 * A flag given more than once keeps LAST-WINS semantics in `flags`, and every
 * value it was given, in order, in `multi` — which is how a repeatable flag
 * (`--step "Given a" --step "Then b"`) is read, through {@link stringFlags}.
 */
export interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | boolean>;
  /** Every string value each flag was given, in order. See {@link stringFlags}. */
  multi: Record<string, string[]>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  // Null prototype: a flag named `constructor` must not resolve to Object.prototype.
  const multi: Record<string, string[]> = Object.create(null) as Record<string, string[]>;
  const record = (name: string, value: string): void => {
    flags[name] = value;
    const seen = multi[name] ?? [];
    seen.push(value);
    multi[name] = seen;
  };
  let onlyPositionals = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) {
      continue;
    }
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
      record(body.slice(0, eq), body.slice(eq + 1));
      continue;
    }
    if (body.startsWith('no-')) {
      flags[body.slice(3)] = false;
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      record(body, next);
      i++;
    } else {
      flags[body] = true;
    }
  }
  return { positionals, flags, multi };
}

/** String flag, or `undefined` when absent or given as a bare boolean. */
export function stringFlag(flags: ParsedArgs['flags'], name: string): string | undefined {
  const v = flags[name];
  return typeof v === 'string' ? v : undefined;
}

/**
 * Every value a repeatable flag was given, in order — `[]` when it was absent
 * or given as a bare boolean. Takes the whole {@link ParsedArgs} (not just
 * `flags`) because the repeats live alongside the last-wins map.
 */
export function stringFlags(args: ParsedArgs, name: string): string[] {
  return args.multi[name] ?? [];
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
