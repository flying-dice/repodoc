#!/usr/bin/env bun
import { runCli } from './cli';

process.exitCode = runCli(process.argv.slice(2), process.cwd(), {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
});
