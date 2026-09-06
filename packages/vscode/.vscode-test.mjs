import { defineConfig } from '@vscode/test-cli';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));

// The e2e suite drives the real extension inside a persistent fixture workspace.
// It must exist before VS Code launches, and it must NOT live under src/.
const fixtureWorkspace = resolve(here, '.vscode-test/fixtures/workspace');
mkdirSync(fixtureWorkspace, { recursive: true });

// Unit tests (core, CLI, and the extension's pure helpers) run under `bun test`
// from the repo root — only the host-bound suites are listed here.
const configs = [
  {
    // End-to-end: the real extension, real Node FS, in the fixture workspace.
    label: 'e2e',
    files: 'out/test/e2e/**/*.test.js',
    workspaceFolder: fixtureWorkspace,
    mocha: { timeout: 60000 },
  },
];

// Screenshot driver — opt-in only (never part of `npm test` / CI). Drives the
// dev host through each screen while an orchestrating shell captures the
// window. See src/test/demo/demo.driver.test.ts.
if (process.env.REPODOC_DEMO === '1') {
  configs.push({
    label: 'demo',
    files: 'out/test/demo/**/*.test.js',
    workspaceFolder: process.env.REPODOC_DEMO_WS,
    mocha: { timeout: 240000 },
    launchArgs: ['--user-data-dir', process.env.REPODOC_DEMO_UDD],
  });
}

export default defineConfig(configs);
