/** Output helpers: every command can print human text or `--json`. */

export interface Printer {
  /** Structured result for `--json`; otherwise the human lines. */
  emit(data: unknown, lines: () => string[]): void;
}

export function makePrinter(json: boolean, write: (s: string) => void): Printer {
  return {
    emit(data, lines): void {
      if (json) {
        write(JSON.stringify(data, null, 2) + '\n');
      } else {
        const out = lines();
        if (out.length) {
          write(out.join('\n') + '\n');
        }
      }
    },
  };
}

/** Pads columns so `rows` line up; `[]` in → `[]` out. */
export function table(rows: string[][]): string[] {
  if (rows.length === 0) {
    return [];
  }
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, cell.length);
    });
  }
  return rows.map((row) =>
    row.map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i]))).join('  ').trimEnd(),
  );
}
