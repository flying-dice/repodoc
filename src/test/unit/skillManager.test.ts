import * as assert from 'assert';
import { MemFileSystemAdapter } from '../../adapters/memFileSystem';
import { AgentKind, SKILL_TARGETS, SkillManager } from '../../core/skillManager';
import { SKILL_MD } from '../../core/skillContent';

function makeManager(seed?: Record<string, string>): {
  fs: MemFileSystemAdapter;
  manager: SkillManager;
} {
  const fs = new MemFileSystemAdapter();
  if (seed) {
    fs.seed(seed);
  }
  return { fs, manager: new SkillManager(fs) };
}

suite('SkillManager.install', () => {
  const cases: AgentKind[] = ['claude', 'opencode'];

  for (const kind of cases) {
    test(`writes the exact SKILL_MD to the ${kind} target path`, () => {
      const { fs, manager } = makeManager();
      manager.install(kind);
      assert.strictEqual(fs.readFile(SKILL_TARGETS[kind]), SKILL_MD);
    });
  }

  test('the claude and opencode targets differ', () => {
    assert.notStrictEqual(SKILL_TARGETS.claude, SKILL_TARGETS.opencode);
  });
});

suite('SkillManager.installed', () => {
  test('reports nothing when no skill files exist', () => {
    const { manager } = makeManager();
    assert.deepStrictEqual(manager.installed(), []);
  });

  test('reflects existence of each target', () => {
    const { fs, manager } = makeManager();
    fs.seed({ [SKILL_TARGETS.opencode]: SKILL_MD });
    assert.deepStrictEqual(manager.installed(), ['opencode']);
    fs.seed({ [SKILL_TARGETS.claude]: SKILL_MD });
    assert.deepStrictEqual(manager.installed().sort(), ['claude', 'opencode']);
  });
});

suite('SkillManager.syncInstalled', () => {
  test('rewrites a stale installed file and returns the kind', () => {
    const { fs, manager } = makeManager({
      [SKILL_TARGETS.claude]: '--- stale content ---',
    });
    assert.deepStrictEqual(manager.syncInstalled(), ['claude']);
    assert.strictEqual(fs.readFile(SKILL_TARGETS.claude), SKILL_MD);
  });

  test('no-ops and returns [] when the installed file is already current', () => {
    const { fs, manager } = makeManager({ [SKILL_TARGETS.claude]: SKILL_MD });
    const before = fs.snapshot();
    assert.deepStrictEqual(manager.syncInstalled(), []);
    assert.deepStrictEqual(fs.snapshot(), before);
  });

  test('creates nothing when no skill is installed', () => {
    const { fs, manager } = makeManager();
    assert.deepStrictEqual(manager.syncInstalled(), []);
    assert.deepStrictEqual(fs.snapshot(), {});
  });

  test('updates only the stale target, leaving current ones untouched', () => {
    const { fs, manager } = makeManager({
      [SKILL_TARGETS.claude]: SKILL_MD,
      [SKILL_TARGETS.opencode]: 'drifted',
    });
    assert.deepStrictEqual(manager.syncInstalled(), ['opencode']);
    assert.strictEqual(fs.readFile(SKILL_TARGETS.opencode), SKILL_MD);
    assert.strictEqual(fs.readFile(SKILL_TARGETS.claude), SKILL_MD);
  });
});

suite('skillContent', () => {
  test('SKILL_MD begins with the expected YAML frontmatter', () => {
    assert.ok(SKILL_MD.startsWith('---\nname: repodoc-workflow\n'));
    assert.ok(SKILL_MD.includes('boards/, decisions/, or docs/'));
  });
});

suite('SkillManager.outdated', () => {
  test('reports stale installed files without touching them', () => {
    const fs = new MemFileSystemAdapter();
    fs.seed({ [SKILL_TARGETS.claude]: 'old content' });
    const manager = new SkillManager(fs);
    assert.deepStrictEqual(manager.outdated(), ['claude']);
    assert.strictEqual(fs.readFile(SKILL_TARGETS.claude), 'old content');
  });

  test('empty when installed files are current or nothing is installed', () => {
    const fs = new MemFileSystemAdapter();
    const manager = new SkillManager(fs);
    assert.deepStrictEqual(manager.outdated(), []);
    manager.install('opencode');
    assert.deepStrictEqual(manager.outdated(), []);
  });
});
