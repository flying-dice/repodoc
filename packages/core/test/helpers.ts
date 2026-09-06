import * as assert from 'node:assert';
import { MemFileSystemAdapter } from '../src/adapters/memFileSystem';
import type { ClockPort } from '../src/ports';
import { RepoDocStore } from '../src/store';

/**
 * Deterministic ClockPort for unit tests. Starts at a fixed instant and only
 * moves when the test asks it to via {@link advance} / {@link set}.
 */
export class FixedClock implements ClockPort {
  private current: Date;

  constructor(iso = '2026-01-01T00:00:00.000Z') {
    this.current = new Date(iso);
  }

  now(): Date {
    // Hand back a fresh Date so callers can't mutate our internal clock.
    return new Date(this.current.getTime());
  }

  /** Move the clock forward by `ms` milliseconds. */
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  /** Jump the clock to an explicit ISO instant. */
  set(iso: string): void {
    this.current = new Date(iso);
  }
}

export interface Harness {
  fs: MemFileSystemAdapter;
  clock: FixedClock;
  store: RepoDocStore;
}

/** Builds a store over a fresh in-memory FS, optionally pre-seeded. */
export function makeStore(seed?: Record<string, string>): Harness {
  const fs = new MemFileSystemAdapter();
  if (seed) {
    fs.seed(seed);
  }
  const clock = new FixedClock();
  const store = new RepoDocStore(fs, clock, '/workspace');
  return { fs, clock, store };
}

/** Card file names in a board dir, sorted for stable assertions. */
export function cardFiles(fs: MemFileSystemAdapter, boardId: string): string[] {
  return fs
    .listDir(`boards/${boardId}`)
    .filter((e) => e.kind === 'file' && !e.name.startsWith('.') && /\.md$/i.test(e.name))
    .map((e) => e.name)
    .sort();
}

/**
 * Asserts a lookup produced a value and returns it. Keeps assertions honest
 * under `noUncheckedIndexedAccess` without scattering non-null assertions:
 * a missing card/column fails the test here, naming what was missing.
 */
export function required<T>(value: T | undefined, what: string): T {
  assert.ok(value !== undefined, `expected ${what} to be present`);
  return value;
}
