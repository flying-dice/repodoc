import { afterEach, beforeEach, describe, test } from 'bun:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
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
});
