import { afterEach, beforeEach, describe, test } from 'bun:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SKILL_MD, SKILL_TARGETS } from '../../core/src/index';
import { runCli } from '../src/cli';

let root: string;

function run(...argv: string[]): { code: number; err: string } {
  let err = '';
  const code = runCli(['--root', root, ...argv], root, {
    stdout: () => {},
    stderr: (s) => (err += s),
  });
  return { code, err };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'repodoc-skill-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('skill install argument guard', () => {
  // Object.prototype keys pass an `in` check, so `toString` used to reach the
  // installer and crash with exit 3. They are usage errors (exit 2) like any
  // other unknown agent kind.
  for (const kind of ['toString', '__proto__', 'constructor']) {
    test(`\`skill install ${kind}\` is a usage error, not a crash`, () => {
      const result = run('skill', 'install', kind);
      assert.strictEqual(result.code, 2, result.err);
      assert.ok(result.err.includes(`unknown agent kind ${kind}`), result.err);
    });
  }

  test('a real agent kind still installs', () => {
    assert.strictEqual(run('skill', 'install', 'opencode').code, 0);
    assert.ok(fs.existsSync(path.join(root, '.opencode/skill/repodoc-workflow/SKILL.md')));
  });

  test('each agent kind writes the canonical skill file at its own path', () => {
    // Existing coverage only asserted that a file appeared; an installer that
    // wrote an empty file (or the wrong agent's path) passed it.
    for (const [kind, target] of Object.entries(SKILL_TARGETS)) {
      assert.strictEqual(run('skill', 'install', kind).code, 0, kind);
      assert.strictEqual(
        fs.readFileSync(path.join(root, target), 'utf8'),
        SKILL_MD,
        `${kind} must install the canonical SKILL.md at ${target}`,
      );
    }
  });

  test('re-installing over a drifted file restores the canonical content', () => {
    const target = path.join(root, SKILL_TARGETS.claude);
    assert.strictEqual(run('skill', 'install', 'claude').code, 0);
    fs.writeFileSync(target, '# hand-edited\n');
    assert.strictEqual(run('skill', 'install', 'claude').code, 0);
    assert.strictEqual(fs.readFileSync(target, 'utf8'), SKILL_MD);
  });
});
