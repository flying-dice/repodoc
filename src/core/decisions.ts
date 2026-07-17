/**
 * Decision-record (ADR) storage. Reads/writes `decisions/NN-slug.md` through the
 * FileSystemPort and keeps the parsing logic pure and vscode-free. The store
 * delegates its decision methods here.
 */

import { FileSystemPort } from './ports';
import { parseFrontmatter, serializeFrontmatter } from './frontmatter';
import { markdownTitle, pad, slugify, stripNumPrefix } from './naming';
import { DecisionRecord } from './types';

/** Parses one decision file's text into a record. Pure — no I/O. */
export function parseDecisionText(fileName: string, content: string): DecisionRecord {
  const id = fileName.replace(/\.md$/i, '');
  const numMatch = /^(\d+)/.exec(fileName);
  const num = numMatch ? numMatch[1] : '0000';

  const { data, body } = parseFrontmatter(content);

  let title = markdownTitle(body, stripNumPrefix(id));
  title = title.replace(/^(?:Decision\s+\d+|ADR-?\d+)\s*[—–-]\s*/i, '').trim();

  const status =
    typeof data.status === 'string' && data.status.trim() ? data.status.trim() : 'Proposed';

  const date = typeof data.date === 'string' && data.date.trim() ? data.date.trim() : undefined;

  return { id, num, file: fileName, title, status, date, body };
}

export class DecisionStore {
  constructor(private readonly fs: FileSystemPort) {}

  list(): DecisionRecord[] {
    const records: DecisionRecord[] = [];
    for (const entry of this.fs.listDir('decisions')) {
      if (entry.kind !== 'file' || entry.name.startsWith('.') || !/\.md$/i.test(entry.name)) {
        continue;
      }
      const content = this.fs.readFile(`decisions/${entry.name}`);
      if (content === undefined) {
        continue;
      }
      records.push(parseDecisionText(entry.name, content));
    }
    records.sort((a, b) => {
      const an = parseInt(a.num, 10) || 0;
      const bn = parseInt(b.num, 10) || 0;
      if (an !== bn) {
        return an - bn;
      }
      return a.file.localeCompare(b.file);
    });
    return records;
  }

  get(id: string): DecisionRecord | undefined {
    return this.list().find((d) => d.id === id);
  }

  /** Writes a new decision skeleton and returns its id. Does not fire events. */
  create(title: string, today: string): string {
    const existing = this.list();
    const maxNum = existing.reduce((max, d) => Math.max(max, parseInt(d.num, 10) || 0), 0);
    const num = pad(maxNum + 1, 2);
    const cleanTitle = title.trim() || 'Untitled decision';
    const id = `${num}-${slugify(cleanTitle)}`;
    const file = `${id}.md`;
    const body =
      `# Decision ${num} — ${cleanTitle}\n\n` +
      `## Context\n\n` +
      `_What is the issue that motivates this decision?_\n\n` +
      `## Decision\n\n` +
      `_What is the change that we're proposing or doing?_\n\n` +
      `## Consequences\n\n` +
      `_What becomes easier or harder because of this change?_\n`;
    this.fs.writeFile(
      `decisions/${file}`,
      serializeFrontmatter({ status: 'Proposed', date: today }, body),
    );
    return id;
  }
}
