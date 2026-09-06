import {
  BoardData,
  Card,
  Column,
  CustomFieldValue,
  GateResult,
  Priority,
  SKILL_TARGETS,
  SkillManager,
  StoreError,
  type AgentKind,
  type CardMetaPatch,
} from '../../core/src/index';
import { boolFlag, CommandError, intFlag, ParsedArgs, stringFlag, UsageError } from './args';
import { CommandContext } from './context';
import { Printer, table } from './output';

/** One subcommand: `repodoc <group> <name> ...`. */
export interface Command {
  group: string;
  name: string;
  usage: string;
  summary: string;
  run(ctx: CommandContext, args: ParsedArgs, out: Printer): void;
}

const PRIORITIES: readonly Priority[] = ['high', 'med', 'low'];

export const COMMANDS: Command[] = [
  {
    group: 'init',
    name: '',
    usage: 'init',
    summary: 'Create the starter board config (never touches existing content).',
    run(ctx, _args, out): void {
      const already = ctx.store.isInitialized();
      ctx.store.init();
      out.emit({ root: ctx.root, alreadyInitialized: already }, () => [
        already ? `RepoDoc already initialized at ${ctx.root}` : `Initialized RepoDoc at ${ctx.root}`,
      ]);
    },
  },
  {
    group: 'board',
    name: 'list',
    usage: 'board list',
    summary: 'List boards with card counts.',
    run(ctx, _args, out): void {
      const boards = ctx.store.listBoards();
      out.emit(boards, () =>
        boards.length
          ? table(boards.map((b) => [b.id, b.name, `${b.cardCount} cards`]))
          : ['No boards. Run `repodoc board create <name>` or `repodoc init`.'],
      );
    },
  },
  {
    group: 'board',
    name: 'show',
    usage: 'board show <board>',
    summary: 'Show a board: columns (with WIP and gates) and the cards in each.',
    run(ctx, args, out): void {
      const [boardId] = need(args, ['board']);
      const board = requireBoard(ctx, boardId);
      out.emit({ id: boardId, ...board }, () => {
        const lines = [`${board.name} (${boardId})`];
        for (const col of board.columns) {
          const wip = col.wip !== undefined ? ` [${col.cardIds.length}/${col.wip}]` : ` [${col.cardIds.length}]`;
          const gates = [
            ...(col.enter ?? []).map((g) => `enter:${g.id}`),
            ...(col.exit ?? []).map((g) => `exit:${g.id}`),
          ];
          lines.push('', `## ${col.name} (${col.id})${wip}${gates.length ? `  gates: ${gates.join(', ')}` : ''}`);
          if (col.prompt) {
            lines.push(...indent(col.prompt, '  > '));
          }
          for (const id of col.cardIds) {
            lines.push(`  ${cardLine(id, board.cards[id])}`);
          }
        }
        return lines;
      });
    },
  },
  {
    group: 'board',
    name: 'create',
    usage: 'board create <name>',
    summary: 'Create a board with the default columns and labels.',
    run(ctx, args, out): void {
      const [name] = need(args, ['name']);
      const id = ctx.store.createBoard(name);
      out.emit({ id, name }, () => [`Created board ${id} (boards/${id}/.config.json)`]);
    },
  },
  {
    group: 'column',
    name: 'add',
    usage: 'column add <board> <name>',
    summary: 'Append a column to a board.',
    run(ctx, args, out): void {
      const [boardId, name] = need(args, ['board', 'name']);
      requireBoard(ctx, boardId);
      ctx.store.addColumn(boardId, name);
      const board = requireBoard(ctx, boardId);
      const col = board.columns[board.columns.length - 1];
      out.emit({ board: boardId, column: col }, () => [`Added column ${col.id} to ${boardId}`]);
    },
  },
  {
    group: 'card',
    name: 'list',
    usage: 'card list <board> [--column <id>]',
    summary: 'List cards in board order, optionally filtered to one column.',
    run(ctx, args, out): void {
      const [boardId] = need(args, ['board']);
      const board = requireBoard(ctx, boardId);
      const only = stringFlag(args.flags, 'column');
      if (only !== undefined) {
        requireColumn(board, only);
      }
      const rows = board.columns
        .filter((c) => only === undefined || c.id === only)
        .flatMap((c) => c.cardIds.map((id) => ({ column: c.id, ...board.cards[id] })));
      out.emit(rows, () =>
        rows.length ? table(rows.map((r) => [r.column, cardLine(r.id, r)])) : ['No cards.'],
      );
    },
  },
  {
    group: 'card',
    name: 'show',
    usage: 'card show <board> <card>',
    summary: 'Show a card in full: metadata, description, checklist, gates, comments.',
    run(ctx, args, out): void {
      const [boardId, cardId] = need(args, ['board', 'card']);
      const { card, column } = requireCard(ctx, boardId, cardId);
      out.emit({ board: boardId, column, ...card }, () => {
        const lines = [`# ${card.title}`, `id: ${card.id}`, `column: ${column}`];
        for (const [k, v] of Object.entries(card)) {
          if (['id', 'title', 'desc', 'checklist', 'gates', 'comments', 'custom'].includes(k) || v === undefined) {
            continue;
          }
          lines.push(`${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`);
        }
        for (const [k, v] of Object.entries(card.custom ?? {})) {
          lines.push(`${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`);
        }
        if (card.desc) {
          lines.push('', card.desc.trim());
        }
        if (card.checklist?.length) {
          lines.push('', '## Checklist', ...card.checklist.map((c, i) => `${i}. [${c.done ? 'x' : ' '}] ${c.text}`));
        }
        if (card.gates?.length) {
          lines.push('', '## Gates', ...card.gates.map((g) => `- [${g.done ? 'x' : ' '}] ${g.gateId}${g.note ? ` — ${g.note}` : ''}`));
        }
        if (card.comments?.length) {
          lines.push('', '## Comments', ...card.comments.map((c) => `- ${c.who ?? '?'} (${c.at ?? '?'}): ${c.text}`));
        }
        return lines;
      });
    },
  },
  {
    group: 'card',
    name: 'create',
    usage: 'card create <board> <title> [--column <id>] [--priority high|med|low] [--labels a,b] [--agent <name>]',
    summary: 'Create a card (in the first column unless --column is given).',
    run(ctx, args, out): void {
      const [boardId, title] = need(args, ['board', 'title']);
      const board = requireBoard(ctx, boardId);
      const columnId = stringFlag(args.flags, 'column') ?? board.columns[0]?.id;
      if (!columnId) {
        throw new CommandError(`board ${boardId} has no columns`);
      }
      const result = ctx.store.addCard(boardId, columnId, title);
      if (!result.ok) {
        throw new CommandError(describe(result.error));
      }
      const patch = metaPatch(args);
      if (Object.keys(patch).length) {
        ctx.store.updateCardMeta(boardId, result.cardId, patch);
      }
      const { card } = requireCard(ctx, boardId, result.cardId);
      out.emit({ board: boardId, column: columnId, ...card }, () => [
        `Created card ${result.cardId} in ${boardId}/${columnId}`,
      ]);
    },
  },
  {
    group: 'card',
    name: 'move',
    usage: 'card move <board> <card> <column> [--index <n>] [--override --reason <why>]',
    summary:
      'Move a card to a column (bottom unless --index). Refuses when gates fail and prints each gate\'s instructions; --override with --reason records an override.',
    run(ctx, args, out): void {
      const [boardId, cardId, toColumn] = need(args, ['board', 'card', 'column']);
      const { board } = requireCard(ctx, boardId, cardId);
      const target = requireColumn(board, toColumn);
      const index = intFlag(args.flags, 'index') ?? Number.MAX_SAFE_INTEGER;
      const results = ctx.store.evaluateMove(boardId, cardId, toColumn);
      const failing = results.filter((r) => !r.satisfied);
      const override = args.flags.override === true;
      const reason = stringFlag(args.flags, 'reason');
      if (failing.length && !override) {
        throw new CommandError(refusalText(cardId, toColumn, failing));
      }
      if (failing.length && override && !reason?.trim()) {
        throw new UsageError('--override requires --reason <why> (recorded on the card next to each overridden gate)');
      }
      for (const r of failing) {
        ctx.store.recordGateOverride(boardId, cardId, r.gate.id, ctx.who, reason);
      }
      const moved = ctx.store.moveCard(boardId, cardId, toColumn, index);
      if (!moved.ok) {
        throw new CommandError(describe(moved.error));
      }
      const overridden = failing.map((r) => r.gate.id);
      out.emit(
        { board: boardId, card: cardId, column: toColumn, overridden, prompt: target.prompt ?? null },
        () => {
          const lines = [`Moved ${cardId} → ${toColumn}${overridden.length ? ` (overrode ${overridden.join(', ')})` : ''}`];
          if (target.prompt) {
            lines.push('', `Now that ${cardId} is in ${target.name}:`, ...indent(target.prompt, '  '));
          }
          return lines;
        },
      );
    },
  },
  {
    group: 'card',
    name: 'gates',
    usage: 'card gates <board> <card> <column>',
    summary: 'Evaluate the gates a move into <column> would have to pass. Exits 1 when any fails.',
    run(ctx, args, out): void {
      const [boardId, cardId, toColumn] = need(args, ['board', 'card', 'column']);
      const { board } = requireCard(ctx, boardId, cardId);
      requireColumn(board, toColumn);
      const results = ctx.store.evaluateMove(boardId, cardId, toColumn);
      out.emit(results, () => (results.length ? gateLines(results, true) : ['No gates on this move.']));
      if (results.some((r) => !r.satisfied)) {
        throw new CommandError('');
      }
    },
  },
  {
    group: 'card',
    name: 'gate-pass',
    usage: 'card gate-pass <board> <card> <gate> <result> [--who <name>]',
    summary: 'Record evidence that a script gate ran green. Only record a run that actually passed.',
    run(ctx, args, out): void {
      const [boardId, cardId, gateId, result] = need(args, ['board', 'card', 'gate', 'result']);
      requireCard(ctx, boardId, cardId);
      ctx.store.recordGateEvidence(boardId, cardId, gateId, result, ctx.who);
      out.emit({ board: boardId, card: cardId, gate: gateId, result, who: ctx.who }, () => [
        `Recorded ${gateId} on ${cardId}`,
      ]);
    },
  },
  {
    group: 'card',
    name: 'comment',
    usage: 'card comment <board> <card> <text> [--who <name>]',
    summary: 'Append a journal entry to the card\'s ## Comments section.',
    run(ctx, args, out): void {
      const [boardId, cardId, text] = need(args, ['board', 'card', 'text']);
      requireCard(ctx, boardId, cardId);
      ctx.store.addComment(boardId, cardId, ctx.who, text);
      out.emit({ board: boardId, card: cardId, who: ctx.who, text }, () => [`Commented on ${cardId} as ${ctx.who}`]);
    },
  },
  {
    group: 'card',
    name: 'update',
    usage: 'card update <board> <card> [--title t] [--agent a] [--live true|false] [--status s] [--progress n] [--priority p] [--labels a,b]',
    summary: 'Set reserved card metadata. Pass an empty value ("") to remove a key.',
    run(ctx, args, out): void {
      const [boardId, cardId] = need(args, ['board', 'card']);
      requireCard(ctx, boardId, cardId);
      const patch = metaPatch(args);
      if (Object.keys(patch).length === 0) {
        throw new UsageError('card update: nothing to change (pass at least one --flag)');
      }
      ctx.store.updateCardMeta(boardId, cardId, patch);
      const { card, column } = requireCard(ctx, boardId, cardId);
      out.emit({ board: boardId, column, ...card }, () => [`Updated ${cardId}: ${Object.keys(patch).join(', ')}`]);
    },
  },
  {
    group: 'card',
    name: 'check',
    usage: 'card check <board> <card> <item-index>',
    summary: 'Toggle a checklist item (0-based, as listed by `card show`).',
    run(ctx, args, out): void {
      const [boardId, cardId, idx] = need(args, ['board', 'card', 'item-index']);
      const { card } = requireCard(ctx, boardId, cardId);
      const i = Number(idx);
      const count = card.checklist?.length ?? 0;
      if (!Number.isInteger(i) || i < 0 || i >= count) {
        throw new CommandError(`checklist index ${idx} out of range (card has ${count} items)`);
      }
      ctx.store.toggleChecklistItem(boardId, cardId, i);
      const after = requireCard(ctx, boardId, cardId).card.checklist?.[i];
      out.emit({ board: boardId, card: cardId, index: i, item: after }, () => [
        `[${after?.done ? 'x' : ' '}] ${after?.text ?? ''}`,
      ]);
    },
  },
  {
    group: 'card',
    name: 'set',
    usage: 'card set <board> <card> <field> [value] [--clear]',
    summary: 'Set a board-defined custom field (multiselect values are comma-separated). --clear removes it.',
    run(ctx, args, out): void {
      const [boardId, cardId, fieldId] = need(args, ['board', 'card', 'field']);
      requireCard(ctx, boardId, cardId);
      const def = ctx.store.getBoardConfig(boardId).fields.find((f) => f.id === fieldId);
      if (!def) {
        throw new CommandError(`unknown field ${fieldId} — declare it under "fields" in boards/${boardId}/.config.json`);
      }
      let value: CustomFieldValue | undefined;
      if (args.flags.clear !== true) {
        const raw = args.positionals[3];
        if (raw === undefined) {
          throw new UsageError('card set: missing <value> (or pass --clear)');
        }
        value = parseFieldValue(def.type, raw);
      }
      ctx.store.setCardField(boardId, cardId, fieldId, value);
      const { card } = requireCard(ctx, boardId, cardId);
      out.emit({ board: boardId, card: cardId, field: fieldId, value: card.custom?.[fieldId] ?? null }, () => [
        `${fieldId} = ${JSON.stringify(card.custom?.[fieldId] ?? null)}`,
      ]);
    },
  },
  {
    group: 'decision',
    name: 'list',
    usage: 'decision list',
    summary: 'List decision records.',
    run(ctx, _args, out): void {
      const all = ctx.store.listDecisions();
      out.emit(all, () => (all.length ? table(all.map((d) => [d.id, d.status, d.date ?? '', d.title])) : ['No decisions.']));
    },
  },
  {
    group: 'decision',
    name: 'show',
    usage: 'decision show <id>',
    summary: 'Print a decision record.',
    run(ctx, args, out): void {
      const [id] = need(args, ['id']);
      const d = ctx.store.getDecision(id);
      if (!d) {
        throw new CommandError(`unknown decision ${id}`);
      }
      out.emit(d, () => [`# ${d.title}`, `status: ${d.status}`, ...(d.date ? [`date: ${d.date}`] : []), '', d.body.trim()]);
    },
  },
  {
    group: 'decision',
    name: 'create',
    usage: 'decision create <title>',
    summary: 'Create a new numbered decision record (status Proposed, dated today).',
    run(ctx, args, out): void {
      const [title] = need(args, ['title']);
      const id = ctx.store.createDecision(title);
      out.emit({ id, path: `decisions/${id}.md` }, () => [`Created decisions/${id}.md`]);
    },
  },
  {
    group: 'docs',
    name: 'tree',
    usage: 'docs tree',
    summary: 'Print the docs/ tree.',
    run(ctx, _args, out): void {
      const tree = ctx.store.getDocsTree();
      const lines: string[] = [];
      const walk = (nodes: typeof tree, depth: number): void => {
        for (const n of nodes) {
          lines.push(`${'  '.repeat(depth)}${n.type === 'dir' ? `${n.label}/` : `${n.label}  (${n.relPath})`}`);
          walk(n.children ?? [], depth + 1);
        }
      };
      walk(tree, 0);
      out.emit(tree, () => (lines.length ? lines : ['No docs.']));
    },
  },
  {
    group: 'docs',
    name: 'show',
    usage: 'docs show <relPath>',
    summary: 'Print a doc page (path relative to the root, e.g. docs/01-getting-started/01-overview.md).',
    run(ctx, args, out): void {
      const [relPath] = need(args, ['relPath']);
      const doc = ctx.store.readDoc(relPath);
      if (!doc) {
        throw new CommandError(`no doc at ${relPath}`);
      }
      out.emit({ relPath, ...doc }, () => [doc.body.trim()]);
    },
  },
  {
    group: 'skill',
    name: 'install',
    usage: 'skill install [claude|opencode]',
    summary: 'Write the RepoDoc agent skill file (default: claude) so coding agents know the workflow.',
    run(ctx, args, out): void {
      const kind = (args.positionals[0] ?? 'claude') as AgentKind;
      if (!(kind in SKILL_TARGETS)) {
        throw new UsageError(`unknown agent kind ${kind}; expected ${Object.keys(SKILL_TARGETS).join(' | ')}`);
      }
      new SkillManager(ctx.fs).install(kind);
      out.emit({ kind, path: SKILL_TARGETS[kind] }, () => [`Wrote ${SKILL_TARGETS[kind]}`]);
    },
  },
];

// ---- helpers ----

function need(args: ParsedArgs, names: string[]): string[] {
  const missing = names.slice(args.positionals.length);
  if (missing.length) {
    throw new UsageError(`missing argument${missing.length > 1 ? 's' : ''}: ${missing.map((n) => `<${n}>`).join(' ')}`);
  }
  return args.positionals;
}

function requireBoard(ctx: CommandContext, boardId: string): BoardData {
  const board = ctx.store.getBoard(boardId);
  if (!board) {
    throw new CommandError(`unknown board ${boardId} (see \`repodoc board list\`)`);
  }
  return board;
}

function requireColumn(board: BoardData, columnId: string): Column {
  const column = board.columns.find((c) => c.id === columnId);
  if (!column) {
    throw new CommandError(`unknown column ${columnId}; columns: ${board.columns.map((c) => c.id).join(', ')}`);
  }
  return column;
}

function requireCard(
  ctx: CommandContext,
  boardId: string,
  cardId: string,
): { board: BoardData; card: Card; column: string } {
  const board = requireBoard(ctx, boardId);
  const card = board.cards[cardId];
  const column = board.columns.find((c) => c.cardIds.includes(cardId));
  if (!card || !column) {
    throw new CommandError(`unknown card ${cardId} on ${boardId} (see \`repodoc card list ${boardId}\`)`);
  }
  return { board, card, column: column.id };
}

function cardLine(id: string, card: Card | undefined): string {
  if (!card) {
    return id;
  }
  const bits = [id, card.title];
  if (card.priority) {
    bits.push(`!${card.priority}`);
  }
  if (card.labels?.length) {
    bits.push(`[${card.labels.join(', ')}]`);
  }
  if (card.agent) {
    bits.push(`@${card.agent}${card.live ? ' (live)' : ''}`);
  }
  if (card.progress !== undefined) {
    bits.push(`${card.progress}%`);
  }
  return bits.join('  ');
}

function gateLines(results: GateResult[], withPrompts = false): string[] {
  return results.flatMap((r) => {
    const head = `${r.satisfied ? 'PASS' : 'FAIL'}  ${r.gate.id}  ${r.reason}`;
    if (!withPrompts || r.satisfied || !r.gate.prompt) {
      return [head];
    }
    return [head, ...indent(r.gate.prompt, '      '), ''];
  });
}

/**
 * The refusal an agent sees when gates block a move. Every failing gate is
 * listed with its `prompt` so the workflow itself travels with the "no"; a gate
 * without a prompt falls back to describing its script or field.
 */
function refusalText(cardId: string, toColumn: string, failing: GateResult[]): string {
  const lines = [`refusing to move ${cardId} → ${toColumn}. ${failing.length} gate${failing.length > 1 ? 's' : ''} must be satisfied first:`, ''];
  failing.forEach((r, i) => {
    lines.push(`${i + 1}. ${r.gate.label ?? r.gate.id} (${r.gate.id}) — ${r.reason}`);
    const prompt = r.gate.prompt ?? defaultPrompt(r);
    lines.push(...indent(prompt, '   '), '');
  });
  lines.push(
    'Do the work above, then re-run this move. Record a green script run with',
    `\`repodoc card gate-pass <board> ${cardId} <gate> "<result>"\`; set a field with \`repodoc card set\`.`,
    'Only a human may authorise \`--override --reason <why>\`.',
  );
  return lines.join('\n');
}

function defaultPrompt(r: GateResult): string {
  if (r.gate.script) {
    return `Run \`${r.gate.script}\` and, only if it exits 0, record the result with gate-pass.`;
  }
  return `Set the \`${r.gate.field}\` field so that it satisfies \`${r.gate.check ?? 'nonempty'}\`.`;
}

function indent(text: string, prefix: string): string[] {
  return text.trim().split('\n').map((l) => `${prefix}${l}`);
}

function describe(error: StoreError): string {
  switch (error.code) {
    case 'unknown-board':
      return `unknown board ${error.boardId}`;
    case 'unknown-card':
      return `unknown card ${error.cardId}`;
    case 'unknown-column':
      return `unknown column ${error.columnId}`;
    case 'duplicate-slugs':
      return `two card files share the slug "${error.slug}"; rename one before reordering`;
    case 'unreadable-card':
      return `could not read card ${error.cardId}`;
  }
}

/** Builds a {@link CardMetaPatch} from --title/--agent/--live/--status/--progress/--priority/--labels. */
function metaPatch(args: ParsedArgs): CardMetaPatch {
  const patch: CardMetaPatch = {};
  const title = stringFlag(args.flags, 'title');
  if (title !== undefined) {
    if (!title.trim()) {
      throw new UsageError('--title must not be empty');
    }
    patch.title = title;
  }
  const agent = stringFlag(args.flags, 'agent');
  if (agent !== undefined) {
    patch.agent = agent === '' ? null : agent;
  }
  const status = stringFlag(args.flags, 'status');
  if (status !== undefined) {
    patch.status = status === '' ? null : status;
  }
  const live = boolFlag(args.flags, 'live');
  if (live !== undefined) {
    patch.live = live ? true : null;
  }
  const progressRaw = stringFlag(args.flags, 'progress');
  if (progressRaw !== undefined) {
    if (progressRaw === '') {
      patch.progress = null;
    } else {
      const n = Number(progressRaw);
      if (!Number.isInteger(n) || n < 0 || n > 100) {
        throw new UsageError(`--progress expects an integer 0-100, got "${progressRaw}"`);
      }
      patch.progress = n;
    }
  }
  const priority = stringFlag(args.flags, 'priority');
  if (priority !== undefined) {
    if (priority === '') {
      patch.priority = null;
    } else if ((PRIORITIES as readonly string[]).includes(priority)) {
      patch.priority = priority as Priority;
    } else {
      throw new UsageError(`--priority expects ${PRIORITIES.join(' | ')}, got "${priority}"`);
    }
  }
  const labels = stringFlag(args.flags, 'labels');
  if (labels !== undefined) {
    const list = labels.split(',').map((s) => s.trim()).filter(Boolean);
    patch.labels = list.length ? list : null;
  }
  return patch;
}

function parseFieldValue(type: string, raw: string): CustomFieldValue {
  switch (type) {
    case 'number': {
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        throw new UsageError(`field expects a number, got "${raw}"`);
      }
      return n;
    }
    case 'boolean': {
      const s = raw.trim().toLowerCase();
      if (s === 'true' || s === 'yes' || s === '1') {
        return true;
      }
      if (s === 'false' || s === 'no' || s === '0') {
        return false;
      }
      throw new UsageError(`field expects true or false, got "${raw}"`);
    }
    case 'multiselect':
      return raw.split(',').map((s) => s.trim()).filter(Boolean);
    default:
      return raw;
  }
}
