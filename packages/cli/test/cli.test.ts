import { afterEach, beforeEach, describe, test } from 'bun:test';
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runCli } from '../src/cli';
import { parseArgs } from '../src/args';
import { resolveRoot } from '../src/context';

let root: string;

/** Runs the CLI in-process against the temp root with a fixed author. */
function run(...argv: string[]): { code: number; out: string; err: string } {
  let out = '';
  let err = '';
  const code = runCli(['--root', root, '--who', 'tester', ...argv], root, {
    stdout: (s) => (out += s),
    stderr: (s) => (err += s),
  });
  return { code, out, err };
}

function json(...argv: string[]): unknown {
  const r = run(...argv, '--json');
  assert.strictEqual(r.code, 0, r.err);
  return JSON.parse(r.out);
}

function cardFiles(boardId: string): string[] {
  return fs.readdirSync(path.join(root, 'boards', boardId)).filter((n) => n.endsWith('.md')).sort();
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'repodoc-cli-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('parseArgs', () => {
  test('positionals, --k v, --k=v, bare booleans, --no-k, and -- terminator', () => {
    const p = parseArgs(['a', '--x', '1', '--y=2', 'b', '--z', '--no-w', '--', '--lit']);
    assert.deepStrictEqual(p.positionals, ['a', 'b', '--lit']);
    assert.deepStrictEqual(p.flags, { x: '1', y: '2', z: true, w: false });
    assert.deepStrictEqual(parseArgs(['--flag']).flags, { flag: true });
  });
});

describe('resolveRoot', () => {
  test('walks up to the nearest RepoDoc data dir, then git root, then cwd', () => {
    const nested = path.join(root, 'a', 'b');
    fs.mkdirSync(nested, { recursive: true });
    assert.strictEqual(resolveRoot(undefined, nested), nested);
    fs.mkdirSync(path.join(root, '.git'));
    assert.strictEqual(resolveRoot(undefined, nested), root);
    fs.mkdirSync(path.join(root, 'a', 'boards'));
    assert.strictEqual(resolveRoot(undefined, nested), path.join(root, 'a'));
    assert.strictEqual(resolveRoot('x', nested), path.join(nested, 'x'));
  });
});

describe('repodoc init / board', () => {
  test('init writes the starter config once; board list shows it', () => {
    const first = run('init');
    assert.strictEqual(first.code, 0);
    assert.ok(fs.existsSync(path.join(root, 'boards/project-backlog/.config.json')));
    const again = json('init') as { alreadyInitialized: boolean };
    assert.strictEqual(again.alreadyInitialized, true);
    const boards = json('board', 'list') as Array<{ id: string; cardCount: number }>;
    assert.deepStrictEqual(boards.map((b) => [b.id, b.cardCount]), [['project-backlog', 0]]);
  });

  test('board create + column add + board show', () => {
    assert.strictEqual(run('board', 'create', 'My Team').code, 0);
    assert.strictEqual(run('column', 'add', 'my-team', 'Blocked').code, 0);
    const board = json('board', 'show', 'my-team') as { columns: Array<{ id: string }> };
    assert.deepStrictEqual(board.columns.map((c) => c.id).slice(-1), ['blocked']);
    const text = run('board', 'show', 'my-team');
    assert.ok(text.out.includes('## Blocked (blocked) [0]'));
  });

  test('unknown board exits 1 with a hint', () => {
    const r = run('board', 'show', 'nope');
    assert.strictEqual(r.code, 1);
    assert.ok(r.err.includes('unknown board nope'));
  });
});

describe('repodoc card', () => {
  beforeEach(() => {
    run('init');
  });

  test('create → list → show round-trips metadata', () => {
    const created = json('card', 'create', 'project-backlog', 'Ship the CLI', '--priority', 'high', '--labels', 'a,b', '--agent', 'lead') as { id: string; column: string };
    assert.strictEqual(created.id, 'ship-the-cli');
    assert.strictEqual(created.column, 'backlog');
    const shown = json('card', 'show', 'project-backlog', 'ship-the-cli') as Record<string, unknown>;
    assert.strictEqual(shown.priority, 'high');
    assert.deepStrictEqual(shown.labels, ['a', 'b']);
    assert.strictEqual(shown.agent, 'lead');
    const listed = run('card', 'list', 'project-backlog', '--column', 'backlog');
    assert.ok(listed.out.includes('ship-the-cli'));
    assert.strictEqual(run('card', 'list', 'project-backlog', '--column', 'nope').code, 1);
  });

  test('create honours --column and refuses an unknown one', () => {
    const c = json('card', 'create', 'project-backlog', 'Now', '--column', 'doing') as { column: string };
    assert.strictEqual(c.column, 'doing');
    assert.strictEqual(run('card', 'create', 'project-backlog', 'X', '--column', 'zzz').code, 1);
  });

  test('move reorders files and updates the column; --index places the card', () => {
    run('card', 'create', 'project-backlog', 'One');
    run('card', 'create', 'project-backlog', 'Two');
    assert.deepStrictEqual(cardFiles('project-backlog'), ['01-one.md', '02-two.md']);
    assert.strictEqual(run('card', 'move', 'project-backlog', 'two', 'backlog', '--index', '0').code, 0);
    assert.deepStrictEqual(cardFiles('project-backlog'), ['01-two.md', '02-one.md']);
    assert.strictEqual(run('card', 'move', 'project-backlog', 'one', 'doing').code, 0);
    const shown = json('card', 'show', 'project-backlog', 'one') as { column: string };
    assert.strictEqual(shown.column, 'doing');
    assert.strictEqual(run('card', 'move', 'project-backlog', 'one', 'nowhere').code, 1);
    assert.strictEqual(run('card', 'move', 'project-backlog', 'ghost', 'doing').code, 1);
  });

  test('update sets and clears reserved keys; validates input', () => {
    run('card', 'create', 'project-backlog', 'W');
    assert.strictEqual(run('card', 'update', 'project-backlog', 'w', '--live', 'true', '--status', 'wiring', '--progress', '40').code, 0);
    let c = json('card', 'show', 'project-backlog', 'w') as Record<string, unknown>;
    assert.strictEqual(c.live, true);
    assert.strictEqual(c.status, 'wiring');
    assert.strictEqual(c.progress, 40);
    assert.strictEqual(run('card', 'update', 'project-backlog', 'w', '--live', 'false', '--status=', '--title', 'Renamed').code, 0);
    c = json('card', 'show', 'project-backlog', 'w') as Record<string, unknown>;
    assert.strictEqual(c.live, undefined);
    assert.strictEqual(c.status, undefined);
    assert.strictEqual(c.title, 'Renamed');
    assert.strictEqual(run('card', 'update', 'project-backlog', 'w', '--progress', '250').code, 2);
    assert.strictEqual(run('card', 'update', 'project-backlog', 'w', '--priority', 'urgent').code, 2);
    assert.strictEqual(run('card', 'update', 'project-backlog', 'w').code, 2);
  });

  test('comment appends a journal entry with the author', () => {
    run('card', 'create', 'project-backlog', 'J');
    assert.strictEqual(run('card', 'comment', 'project-backlog', 'j', 'Did the thing in src/x.ts:3').code, 0);
    const c = json('card', 'show', 'project-backlog', 'j') as { comments: Array<{ who: string; text: string }> };
    assert.strictEqual(c.comments.length, 1);
    assert.strictEqual(c.comments[0].who, 'tester');
    assert.strictEqual(c.comments[0].text, 'Did the thing in src/x.ts:3');
  });

  test('check toggles a checklist item and rejects out-of-range indexes', () => {
    run('card', 'create', 'project-backlog', 'C');
    const file = path.join(root, 'boards/project-backlog/01-c.md');
    fs.appendFileSync(file, '\n## Checklist\n\n- [ ] first\n- [ ] second\n');
    assert.strictEqual(run('card', 'check', 'project-backlog', 'c', '1').code, 0);
    const c = json('card', 'show', 'project-backlog', 'c') as { checklist: Array<{ done: boolean }> };
    assert.deepStrictEqual(c.checklist.map((i) => i.done), [false, true]);
    assert.strictEqual(run('card', 'check', 'project-backlog', 'c', '5').code, 1);
  });

  test('set writes typed custom fields and --clear removes them', () => {
    const cfg = path.join(root, 'boards/project-backlog/.config.json');
    const config = JSON.parse(fs.readFileSync(cfg, 'utf8'));
    config.fields = [
      { id: 'estimate', type: 'number' },
      { id: 'tags', type: 'multiselect' },
      { id: 'flag', type: 'boolean' },
    ];
    fs.writeFileSync(cfg, JSON.stringify(config));
    run('card', 'create', 'project-backlog', 'F');
    assert.strictEqual(run('card', 'set', 'project-backlog', 'f', 'estimate', '3').code, 0);
    assert.strictEqual(run('card', 'set', 'project-backlog', 'f', 'tags', 'a, b').code, 0);
    assert.strictEqual(run('card', 'set', 'project-backlog', 'f', 'flag', 'yes').code, 0);
    let c = json('card', 'show', 'project-backlog', 'f') as { custom: Record<string, unknown> };
    assert.deepStrictEqual(c.custom, { estimate: 3, tags: ['a', 'b'], flag: true });
    assert.strictEqual(run('card', 'set', 'project-backlog', 'f', 'estimate', 'lots').code, 2);
    assert.strictEqual(run('card', 'set', 'project-backlog', 'f', 'unknown', '1').code, 1);
    assert.strictEqual(run('card', 'set', 'project-backlog', 'f', 'estimate', '--clear').code, 0);
    c = json('card', 'show', 'project-backlog', 'f') as { custom: Record<string, unknown> };
    assert.strictEqual(c.custom.estimate, undefined);
  });
});

describe('repodoc card gates', () => {
  beforeEach(() => {
    fs.mkdirSync(path.join(root, 'boards/b'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'boards/b/.config.json'),
      JSON.stringify({
        name: 'B',
        columns: [
          { id: 'doing', name: 'Doing', color: '#000' },
          {
            id: 'done',
            name: 'Done',
            color: '#000',
            prompt: 'Card is done. Set live false and progress 100.',
            enter: [
              {
                id: 'tests',
                script: 'bun test',
                prompt: 'Run `bun test` from the repo root. Only when it exits 0, record it with gate-pass.',
              },
              { id: 'reviewed', field: 'reviewed-by', check: 'nonempty' },
            ],
          },
        ],
        labels: {},
        fields: [{ id: 'reviewed-by', type: 'text' }],
      }),
    );
    fs.writeFileSync(path.join(root, 'boards/b/01-card.md'), '---\ncolumn: doing\n---\n# Card\n');
  });

  test('gates reports each gate and exits 1 while any fails', () => {
    const r = run('card', 'gates', 'b', 'card', 'done');
    assert.strictEqual(r.code, 1);
    assert.ok(r.out.includes('FAIL  tests'));
    assert.ok(r.out.includes('FAIL  reviewed'));
  });

  test('move refuses failing gates and feeds the agent each gate\'s prompt, then succeeds once satisfied', () => {
    const refused = run('card', 'move', 'b', 'card', 'done');
    assert.strictEqual(refused.code, 1);
    assert.ok(refused.err.includes('2 gates must be satisfied first'));
    assert.ok(refused.err.includes('Run `bun test` from the repo root.'), refused.err);
    // A gate without a prompt gets a generated instruction naming its field/check.
    assert.ok(refused.err.includes('Set the `reviewed-by` field so that it satisfies `nonempty`'), refused.err);
    assert.ok(refused.err.includes('gate-pass'));
    assert.strictEqual(fs.readFileSync(path.join(root, 'boards/b/01-card.md'), 'utf8').includes('column: done'), false);

    assert.strictEqual(run('card', 'gate-pass', 'b', 'card', 'tests', '212 pass').code, 0);
    assert.strictEqual(run('card', 'set', 'b', 'card', 'reviewed-by', 'jonathan').code, 0);
    const ok = run('card', 'gates', 'b', 'card', 'done');
    assert.strictEqual(ok.code, 0, ok.out);
    const moved = run('card', 'move', 'b', 'card', 'done');
    assert.strictEqual(moved.code, 0);
    // Entering a column with a prompt prints that column's workflow.
    assert.ok(moved.out.includes('Now that card is in Done:'), moved.out);
    assert.ok(moved.out.includes('Set live false and progress 100.'));
    const file = fs.readFileSync(path.join(root, 'boards/b/01-card.md'), 'utf8');
    assert.ok(file.includes('column: done'));
    assert.ok(/- \[x\] tests — 212 pass \(tester, .+\)/.test(file));
  });

  test('gates prints the prompt of each failing gate', () => {
    const r = run('card', 'gates', 'b', 'card', 'done');
    assert.strictEqual(r.code, 1);
    assert.ok(r.out.includes('FAIL  tests'));
    assert.ok(r.out.includes('Run `bun test` from the repo root.'));
  });

  test('board show prints column prompts', () => {
    assert.ok(run('board', 'show', 'b').out.includes('> Card is done. Set live false and progress 100.'));
  });

  test('--override needs a --reason, then records it per failing gate and moves', () => {
    const noReason = run('card', 'move', 'b', 'card', 'done', '--override');
    assert.strictEqual(noReason.code, 2);
    assert.ok(noReason.err.includes('--reason'));
    assert.ok(!fs.readFileSync(path.join(root, 'boards/b/01-card.md'), 'utf8').includes('column: done'));

    const r = json('card', 'move', 'b', 'card', 'done', '--override', '--reason', 'hotfix approved by jonathan') as { overridden: string[] };
    assert.deepStrictEqual(r.overridden, ['tests', 'reviewed']);
    const file = fs.readFileSync(path.join(root, 'boards/b/01-card.md'), 'utf8');
    assert.ok(file.includes('column: done'));
    assert.ok(/- \[x\] tests — OVERRIDDEN \(tester, .+\): hotfix approved by jonathan/.test(file));
    assert.ok(file.includes('- [x] reviewed — OVERRIDDEN (tester,'));
  });
});

describe('repodoc feature', () => {
  const config = JSON.stringify({
    name: 'Spec',
    columns: [
      { id: 'proposed', name: 'Proposed', color: '#7d828b' },
      { id: 'specified', name: 'Specified', color: '#4c8bf5', prompt: 'Write the scenarios.' },
    ],
  });
  const gates = [
    '@status:specified @core',
    'Feature: Gates block a move',
    '',
    '  A gated move is refused.',
    '',
    '  Scenario: The move is refused',
    '    Given a failing gate',
    '',
  ].join('\n');

  function featurePath(name: string): string {
    return path.join(root, 'features/spec', name);
  }

  beforeEach(() => {
    fs.mkdirSync(path.join(root, 'features/spec'), { recursive: true });
    fs.writeFileSync(featurePath('.config.json'), config);
    fs.writeFileSync(featurePath('gates.feature'), gates);
    fs.writeFileSync(featurePath('untagged.feature'), 'Feature: No tag\n');
  });

  test('feature sets lists sets with counts', () => {
    const text = run('feature', 'sets');
    assert.strictEqual(text.code, 0);
    assert.ok(text.out.includes('spec  Spec  2 features'));
    const sets = json('feature', 'sets') as Array<{ id: string; featureCount: number }>;
    assert.deepStrictEqual(sets, [{ id: 'spec', name: 'Spec', featureCount: 2 }]);
  });

  test('feature set-create writes a config with the default columns', () => {
    const created = json('feature', 'set-create', 'Payments Spec') as { id: string };
    assert.strictEqual(created.id, 'payments-spec');
    const written = JSON.parse(
      fs.readFileSync(path.join(root, 'features/payments-spec/.config.json'), 'utf8'),
    ) as { columns: Array<{ id: string }> };
    assert.deepStrictEqual(written.columns.map((c) => c.id), [
      'proposed',
      'specified',
      'implemented',
      'verified',
    ]);
  });

  test('feature list buckets by @status: and filters by --column', () => {
    const all = json('feature', 'list', 'spec') as Array<{ column: string; id: string }>;
    assert.deepStrictEqual(all.map((r) => [r.column, r.id]), [
      ['proposed', 'untagged'],
      ['specified', 'gates'],
    ]);
    const only = json('feature', 'list', 'spec', '--column', 'specified') as Array<{ id: string }>;
    assert.deepStrictEqual(only.map((r) => r.id), ['gates']);
    assert.strictEqual(run('feature', 'list', 'spec', '--column', 'nope').code, 1);
    assert.strictEqual(run('feature', 'list', 'nope').code, 1);
  });

  test('feature show prints status, tags, description and scenarios', () => {
    const text = run('feature', 'show', 'spec', 'gates');
    assert.strictEqual(text.code, 0);
    assert.ok(text.out.includes('# Gates block a move'));
    assert.ok(text.out.includes('status: specified'));
    assert.ok(text.out.includes('tags: @core'));
    assert.ok(text.out.includes('A gated move is refused.'));
    assert.ok(text.out.includes('- The move is refused'));
    const shown = json('feature', 'show', 'spec', 'gates') as {
      status: string;
      scenarios: Array<{ name: string }>;
    };
    assert.strictEqual(shown.status, 'specified');
    assert.deepStrictEqual(shown.scenarios.map((s) => s.name), ['The move is refused']);
    assert.strictEqual(run('feature', 'show', 'spec', 'nope').code, 1);
    assert.strictEqual(run('feature', 'show', 'nope', 'gates').code, 1);
  });

  test('feature create writes a slugged file, suffixing a taken slug', () => {
    const first = json('feature', 'create', 'spec', 'Move rewrites the tag') as { id: string };
    assert.strictEqual(first.id, 'move-rewrites-the-tag');
    assert.strictEqual(
      fs.readFileSync(featurePath('move-rewrites-the-tag.feature'), 'utf8'),
      '@status:proposed\nFeature: Move rewrites the tag\n',
    );
    const second = json('feature', 'create', 'spec', 'Gates', '--column', 'specified') as {
      id: string;
      status: string;
    };
    assert.strictEqual(second.id, 'gates-2');
    assert.strictEqual(second.status, 'specified');
    assert.strictEqual(run('feature', 'create', 'spec', 'X', '--column', 'nope').code, 1);
    assert.strictEqual(run('feature', 'create', 'nope', 'X').code, 1);
  });

  test('feature move rewrites only the tag and prints the column prompt', () => {
    const moved = run('feature', 'move', 'spec', 'gates', 'proposed');
    assert.strictEqual(moved.code, 0);
    assert.strictEqual(
      fs.readFileSync(featurePath('gates.feature'), 'utf8'),
      gates.replace('@status:specified', '@status:proposed'),
    );
    const back = run('feature', 'move', 'spec', 'gates', 'specified');
    assert.ok(back.out.includes('Write the scenarios.'));
    const asJson = json('feature', 'move', 'spec', 'untagged', 'specified') as { prompt: string };
    assert.strictEqual(asJson.prompt, 'Write the scenarios.');
    assert.strictEqual(
      fs.readFileSync(featurePath('untagged.feature'), 'utf8'),
      '@status:specified\nFeature: No tag\n',
    );
  });

  test('feature move refuses an unknown set, feature or column', () => {
    assert.strictEqual(run('feature', 'move', 'nope', 'gates', 'proposed').code, 1);
    assert.strictEqual(run('feature', 'move', 'spec', 'nope', 'proposed').code, 1);
    assert.strictEqual(run('feature', 'move', 'spec', 'gates', 'nope').code, 1);
    const missing = run('feature', 'move', 'spec');
    assert.strictEqual(missing.code, 2);
    assert.ok(missing.err.includes('missing arguments: <feature> <column>'));
  });
});

describe('repodoc decision / docs / skill', () => {
  test('decision create/list/show', () => {
    const created = json('decision', 'create', 'Use Bun') as { id: string };
    assert.strictEqual(created.id, '01-use-bun');
    const list = json('decision', 'list') as Array<{ id: string; status: string }>;
    assert.deepStrictEqual(list.map((d) => [d.id, d.status]), [['01-use-bun', 'Proposed']]);
    assert.ok(run('decision', 'show', '01-use-bun').out.includes('# Use Bun'));
    assert.strictEqual(run('decision', 'show', 'zz').code, 1);
  });

  test('docs tree/show', () => {
    fs.mkdirSync(path.join(root, 'docs/01-guides'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs/01-guides/01-intro.md'), '# Intro\n\nHello.\n');
    const tree = run('docs', 'tree');
    assert.ok(tree.out.includes('Guides/'));
    assert.ok(tree.out.includes('Intro  (docs/01-guides/01-intro.md)'));
    assert.ok(run('docs', 'show', 'docs/01-guides/01-intro.md').out.includes('Hello.'));
    assert.strictEqual(run('docs', 'show', 'docs/nope.md').code, 1);
  });

  test('skill install writes the agent skill file', () => {
    assert.strictEqual(run('skill', 'install').code, 0);
    assert.ok(fs.existsSync(path.join(root, '.claude/skills/repodoc-workflow/SKILL.md')));
    assert.strictEqual(run('skill', 'install', 'opencode').code, 0);
    assert.ok(fs.existsSync(path.join(root, '.opencode/skill/repodoc-workflow/SKILL.md')));
    assert.strictEqual(run('skill', 'install', 'emacs').code, 2);
  });
});

describe('repodoc usage', () => {
  test('help, unknown commands and missing arguments', () => {
    assert.ok(run().out.includes('Usage: repodoc'));
    assert.ok(run('help', 'card').out.includes('repodoc card move'));
    assert.strictEqual(run('bogus').code, 2);
    const missing = run('card', 'move', 'b');
    assert.strictEqual(missing.code, 2);
    assert.ok(missing.err.includes('missing arguments: <card> <column>'));
  });
});
