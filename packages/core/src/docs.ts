/**
 * Documentation tree over `docs/**`. Reads the markdown files through the
 * FileSystemPort and builds the {@link DocNode} tree the Docs view renders.
 * vscode-free; the store delegates its doc methods here.
 */

import { FileSystemPort } from './ports';
import { parseFrontmatter } from './frontmatter';
import { markdownTitle, numPrefix, slugFromFileName, stripNumPrefix, titleCase } from './naming';
import { DocNode } from './types';

export class DocStore {
  constructor(private readonly fs: FileSystemPort) {}

  tree(): DocNode[] {
    if (!this.fs.exists('docs')) {
      return [];
    }
    return this.walk('docs');
  }

  read(
    relPath: string,
  ): { title: string; body: string; frontmatter?: Record<string, unknown> } | undefined {
    if (isAbsolute(relPath) || relPath.split('/').includes('..')) {
      return undefined;
    }
    const content = this.fs.readFile(relPath);
    if (content === undefined) {
      return undefined;
    }
    const { data, body } = parseFrontmatter(content);
    const base = relPath.split('/').pop() ?? relPath;
    const title = markdownTitle(body, slugFromFileName(base));
    const result: { title: string; body: string; frontmatter?: Record<string, unknown> } = {
      title,
      body,
    };
    if (Object.keys(data).length > 0) {
      result.frontmatter = data;
    }
    return result;
  }

  private walk(relDir: string): DocNode[] {
    const nodes: DocNode[] = [];
    for (const entry of this.fs.listDir(relDir)) {
      if (entry.name.startsWith('.')) {
        continue;
      }
      const relPath = `${relDir}/${entry.name}`;
      if (entry.kind === 'dir') {
        nodes.push({
          type: 'dir',
          name: entry.name,
          label: titleCase(stripNumPrefix(entry.name)),
          relPath,
          children: this.walk(relPath),
        });
      } else if (/\.md$/i.test(entry.name)) {
        nodes.push({
          type: 'file',
          name: entry.name,
          label: this.label(relPath, entry.name),
          relPath,
        });
      }
    }
    nodes.sort(docCompare);
    return nodes;
  }

  private label(relPath: string, fileName: string): string {
    const content = this.fs.readFile(relPath);
    return markdownTitle(content ?? '', slugFromFileName(fileName));
  }
}

function isAbsolute(p: string): boolean {
  return p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p);
}

function docCompare(a: DocNode, b: DocNode): number {
  const pa = numPrefix(a.name);
  const pb = numPrefix(b.name);
  const aPrefixed = pa !== undefined;
  const bPrefixed = pb !== undefined;
  if (aPrefixed && bPrefixed) {
    if (pa !== pb) {
      return (pa as number) - (pb as number);
    }
    return a.name.localeCompare(b.name);
  }
  if (aPrefixed) {
    return -1;
  }
  if (bPrefixed) {
    return 1;
  }
  return a.name.localeCompare(b.name);
}
