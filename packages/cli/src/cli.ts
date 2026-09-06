import { CommandError, parseArgs, UsageError } from './args';
import { COMMANDS } from './commands';
import { buildContext } from './context';
import { makePrinter } from './output';

export interface Io {
  stdout(s: string): void;
  stderr(s: string): void;
}

/**
 * Runs one invocation and returns the exit code: 0 ok, 1 refused by the
 * store (unknown card, failing gates…), 2 usage error, 3 unexpected failure.
 * Pure over `argv` + `cwd` + `io` so tests can drive it in-process.
 */
export function runCli(argv: string[], cwd: string, io: Io): number {
  const args = parseArgs(argv);
  const [group, maybeName, ...rest] = args.positionals;
  if (args.flags.version === true) {
    io.stdout(`repodoc ${VERSION}\n`);
    return 0;
  }
  if (!group || group === 'help' || args.flags.help === true) {
    io.stdout(helpText(typeof maybeName === 'string' ? maybeName : undefined));
    return 0;
  }
  const command =
    COMMANDS.find((c) => c.group === group && c.name === '') ??
    COMMANDS.find((c) => c.group === group && c.name === maybeName);
  if (!command) {
    io.stderr(`repodoc: unknown command "${[group, maybeName].filter(Boolean).join(' ')}"\n\n${helpText(group)}`);
    return 2;
  }
  const positionals = command.name === '' ? [maybeName, ...rest].filter((p): p is string => p !== undefined) : rest;
  try {
    const ctx = buildContext(args, cwd);
    command.run(ctx, { positionals, flags: args.flags }, makePrinter(ctx.json, io.stdout));
    return 0;
  } catch (e) {
    if (e instanceof UsageError) {
      io.stderr(`repodoc ${command.usage}\n\n${e.message}\n`);
      return 2;
    }
    if (e instanceof CommandError) {
      if (e.message) {
        io.stderr(`repodoc: ${e.message}\n`);
      }
      return 1;
    }
    io.stderr(`repodoc: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
    return 3;
  }
}

export const VERSION = '0.9.0';

export function helpText(group?: string): string {
  const cmds = COMMANDS.filter((c) => group === undefined || c.group === group);
  const list = cmds.length ? cmds : COMMANDS;
  const lines = [
    'repodoc — task boards, decisions and docs as files in your repo.',
    '',
    'Usage: repodoc <command> [args] [--root <dir>] [--who <name>] [--json]',
    '',
    ...list.flatMap((c) => [`  repodoc ${c.usage}`, `      ${c.summary}`]),
    '',
    'Global flags:',
    '  --root <dir>   Workspace root (default: nearest dir with boards/, decisions/ or docs/, else git root).',
    '  --who <name>   Author for comments and gate evidence (default: $REPODOC_AUTHOR, git user.name, OS user).',
    '  --json         Machine-readable output.',
    '',
    'Run with: bunx github:flying-dice/repodoc <command>',
    '',
  ];
  return lines.join('\n');
}
