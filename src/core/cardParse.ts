import { parseFrontmatter } from './frontmatter';
import { markdownTitle, numPrefix, slugFromFileName } from './naming';
import { Card, ChecklistItem, Priority } from './types';

/** One card file parsed from disk, with the metadata needed to order/bucket it. */
export interface CardEntry {
  fileName: string;
  slug: string;
  num: number | undefined;
  column: string;
  card: Card;
}

/** Parse a `NN-slug.md` card file into a CardEntry. Pure; tolerant of malformed input. */
export function parseCard(fileName: string, content: string): CardEntry {
  const { data, body } = parseFrontmatter(content);
  const slug = slugFromFileName(fileName);
  const title = markdownTitle(body, slug);

  const card: Card = { id: slug, title };

  const desc = extractDescription(body);
  if (desc) {
    card.desc = desc;
  }
  const { items } = findChecklist(body);
  if (items.length) {
    card.checklist = items;
  }
  const labels = asStringArray(data.labels);
  if (labels && labels.length) {
    card.labels = labels;
  }
  const priority = asPriority(data.priority);
  if (priority) {
    card.priority = priority;
  }
  const agent = asString(data.agent);
  if (agent) {
    card.agent = agent;
  }
  if (data.live === true) {
    card.live = true;
  }
  const status = asString(data.status);
  if (status) {
    card.status = status;
  }
  const progress = asNumber(data.progress);
  if (progress !== undefined) {
    card.progress = progress;
  }
  const files = asStringArray(data.files);
  if (files && files.length) {
    card.files = files;
  }
  const comments = asNumber(data.comments);
  if (comments !== undefined) {
    card.comments = comments;
  }
  const updatedAt = asString(data.updatedAt);
  if (updatedAt) {
    card.updatedAt = updatedAt;
  }

  return {
    fileName,
    slug,
    num: numPrefix(fileName),
    column: asString(data.column) ?? '',
    card,
  };
}

/** Body text between the title heading and the `## Checklist` heading. */
function extractDescription(body: string): string {
  const lines = body.split('\n');
  const headingIdx = lines.findIndex((l) => /^#\s+/.test(l));
  const start = headingIdx === -1 ? 0 : headingIdx + 1;
  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (/^##\s+checklist\s*$/i.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n').trim();
}

/** Task-list items under `## Checklist`, with their body line indices. */
export function findChecklist(body: string): { items: ChecklistItem[]; indices: number[] } {
  const lines = body.split('\n');
  const items: ChecklistItem[] = [];
  const indices: number[] = [];
  let inSection = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s+checklist\s*$/i.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection && /^#{1,6}\s+/.test(line)) {
      break; // next heading ends the section
    }
    if (inSection) {
      const m = /^\s*-\s+\[([ xX])\]\s+(.*)$/.exec(line);
      if (m) {
        items.push({ text: m[2].trim(), done: m[1].toLowerCase() === 'x' });
        indices.push(i);
      }
    }
  }
  return { items, indices };
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && !Number.isNaN(v) ? v : undefined;
}

function asStringArray(v: unknown): string[] | undefined {
  if (Array.isArray(v)) {
    return v.filter((x): x is string => typeof x === 'string');
  }
  return undefined;
}

function asPriority(v: unknown): Priority | undefined {
  return v === 'high' || v === 'med' || v === 'low' ? v : undefined;
}
