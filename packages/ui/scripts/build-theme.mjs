/**
 * Generates `src/theme/vscode-theme.css` from VS Code's own sources.
 *
 * Stories are only evidence about the real UI if they are painted in the real
 * colours. Hand-picking approximations produces a Storybook that looks *like*
 * VS Code without being it, and a component can then look right here and wrong
 * in the editor.
 *
 * A `--vscode-*` variable comes from one of three places, and this reads all
 * three:
 *
 *  1. the default themes — `extensions/theme-defaults/themes/*.json`, following
 *     the `include` chain so the leaf overrides its base;
 *  2. the colour registry — `registerColor('id', { dark, light })` in
 *     `src/vs/platform/theme/common/colors/*.ts`, which is where anything a
 *     theme does not name gets its default;
 *  3. contributing extensions — the built-in git extension declares every
 *     `gitDecoration.*` colour in its own package.json.
 *
 * Run: `bun run build-theme` (network required). The output is committed, so
 * the build itself never reaches out.
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import * as path from 'node:path';

/** Pin the ref: "main" would let a VS Code change rewrite this without a commit. */
const REF = 'release/1.104';
const BASE = `https://raw.githubusercontent.com/microsoft/vscode/${REF}`;

const THEMES = { dark: 'dark_modern.json', light: 'light_modern.json' };
const REGISTRY = [
  'src/vs/platform/theme/common/colors/baseColors.ts',
  'src/vs/platform/theme/common/colors/chartsColors.ts',
  'src/vs/platform/theme/common/colors/editorColors.ts',
  'src/vs/platform/theme/common/colors/miscColors.ts',
  'src/vs/platform/theme/common/colors/inputColors.ts',
  'src/vs/platform/theme/common/colors/listColors.ts',
  'src/vs/platform/theme/common/colors/menuColors.ts',
  'src/vs/platform/theme/common/colors/minimapColors.ts',
  'src/vs/platform/theme/common/colors/quickpickColors.ts',
  'src/vs/platform/theme/common/colors/searchColors.ts',
];
const EXTENSIONS = ['extensions/git/package.json'];

async function fetchText(rel) {
  const res = await fetch(`${BASE}/${rel}`);
  if (!res.ok) {
    return undefined;
  }
  return res.text();
}

/** JSON with comments and trailing commas, as VS Code writes it. */
function parseJsonc(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === '\\') {
        out += text[++i] ?? '';
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') {
        i++;
      }
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i + 1 < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        i++;
      }
      i++;
      continue;
    }
    out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

/** Theme colours with the `include` chain flattened, base first so the leaf wins. */
async function themeColors(leaf) {
  const chain = [];
  let name = leaf;
  while (name) {
    const text = await fetchText(`extensions/theme-defaults/themes/${name}`);
    if (!text) {
      break;
    }
    const doc = parseJsonc(text);
    chain.push(doc);
    name = doc.include ? path.basename(doc.include) : undefined;
  }
  const colors = {};
  for (const doc of chain.reverse()) {
    Object.assign(colors, doc.colors ?? {});
  }
  return colors;
}

/**
 * `Color.fromHex('#797979').transparent(0.4)` → `#79797966`.
 *
 * VS Code resolves these at runtime; reproducing the arithmetic is exact, so
 * the alternative is not "safer", only vaguer.
 */
function literalFromCall(expr) {
  const m = /Color\.fromHex\(\s*'(#[0-9a-fA-F]{6})'\s*\)\.transparent\(\s*([\d.]+)\s*\)/.exec(expr);
  if (!m?.[1] || !m[2]) {
    return undefined;
  }
  const alpha = Math.round(Number(m[2]) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${m[1]}${alpha}`;
}

/**
 * `registerColor` defaults, across every registry file at once.
 *
 * Three shapes appear, and the second is why this reads all the files together:
 *
 *   registerColor('a.b', { dark: '#fff', light: '#000' }, …)   a literal
 *   registerColor('charts.red', editorErrorForeground, …)      a TS identifier
 *   registerColor('x', { dark: Color.fromHex('#797979')… }, …) a computed call
 *
 * The identifier form points at another `export const` in a different file, so
 * the id it stands for is only knowable once every file has been read. Anything
 * still computed after that is left out rather than approximated.
 */
function parseRegistry(sources, out) {
  const all = sources.join('\n');
  /** The per-theme bucket, created on first use. */
  const bucket = (theme) => {
    if (!out[theme]) {
      out[theme] = {};
    }
    return out[theme];
  };

  // `export const editorErrorForeground = registerColor('editorError.foreground'`
  const identToId = new Map();
  for (const [, ident, id] of all.matchAll(
    /export const ([A-Za-z_$][\w$]*)\s*=\s*registerColor\(\s*'([^']+)'/g,
  )) {
    if (ident && id) {
      identToId.set(ident, id);
    }
  }

  for (const [, id, body] of all.matchAll(/registerColor\(\s*'([^']+)'\s*,\s*\{([^}]*)\}/g)) {
    for (const theme of ['dark', 'light']) {
      const m = new RegExp(`\\b${theme}\\s*:\\s*([^,\\n}]+)`).exec(body ?? '');
      const raw = m?.[1]?.trim();
      if (!raw) {
        continue;
      }
      const value = literalFromCall(raw) ?? raw.replace(/^'|'$/g, '');
      bucket(theme)[id] = identToId.get(value) ?? value;
    }
  }

  for (const [, id, ref] of all.matchAll(
    /registerColor\(\s*'([^']+)'\s*,\s*([A-Za-z_$][\w$]*)\s*,/g,
  )) {
    for (const theme of ['dark', 'light']) {
      const target = bucket(theme);
      target[id] ??= identToId.get(ref ?? '') ?? ref;
    }
  }
}

/** Resolve references until every value is a literal or is known unresolvable. */
function resolve(map) {
  const literal = (v) => typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v);
  for (let pass = 0; pass < 10; pass++) {
    let changed = false;
    for (const [id, value] of Object.entries(map)) {
      if (literal(value) || value == null) {
        continue;
      }
      const target = map[value];
      if (target && target !== value) {
        map[id] = target;
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }
  const unresolved = Object.entries(map).filter(([, v]) => !literal(v));
  for (const [id] of unresolved) {
    delete map[id];
  }
  return unresolved.map(([id]) => id);
}

const cssVar = (id) => `--vscode-${id.replace(/\./g, '-')}`;

async function main() {
  const registry = {};
  const sources = (await Promise.all(REGISTRY.map(fetchText))).filter(Boolean);
  parseRegistry(sources, registry);

  const contributed = { dark: {}, light: {} };
  for (const file of EXTENSIONS) {
    const text = await fetchText(file);
    if (!text) {
      continue;
    }
    for (const color of parseJsonc(text).contributes?.colors ?? []) {
      contributed.dark[color.id] = color.defaults?.dark;
      contributed.light[color.id] = color.defaults?.light;
    }
  }

  const blocks = [];
  const report = {};
  for (const [theme, leaf] of Object.entries(THEMES)) {
    // Precedence matches VS Code: a theme's own colour beats a registry default.
    const merged = {
      ...(registry[theme] ?? {}),
      ...contributed[theme],
      ...(await themeColors(leaf)),
    };
    const dropped = resolve(merged);
    report[theme] = { resolved: Object.keys(merged).length, dropped: dropped.length };

    const lines = Object.keys(merged)
      .sort()
      .map((id) => `  ${cssVar(id)}: ${merged[id]};`);
    blocks.push(
      `[data-theme='${theme}'] {\n  color-scheme: ${theme};\n\n${lines.join('\n')}\n\n` +
        `  /* Fonts are the host's, not the theme's — VS Code injects whatever the\n` +
        `     user has configured. These stand in for a default install. */\n` +
        `  --vscode-font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;\n` +
        `  --vscode-editor-font-family: 'SF Mono', Menlo, Consolas, monospace;\n}`,
    );
  }

  const header = `/*
 * GENERATED — do not edit. Run \`bun run build-theme\` in packages/ui.
 *
 * VS Code's real colours, read from microsoft/vscode @ ${REF}:
 *
 *   - default themes      extensions/theme-defaults/themes/{dark,light}_modern.json
 *                         (with their \`include\` chain flattened)
 *   - colour registry     src/vs/platform/theme/common/colors/*.ts
 *   - git extension       extensions/git/package.json
 *
 * A webview gets these injected by the editor. Nothing outside the editor
 * provides them, so without this file every colour resolves to nothing and a
 * story proves nothing about the rules it is meant to exercise.
 *
 * Colours whose default is a computed call — \`transparent(foreground, 0.7)\` —
 * are not reproduced here; they are left unset so the stylesheet's own
 * fallbacks apply, rather than being guessed at.
 */\n\n`;

  const out = path.join(import.meta.dirname, '..', 'src', 'theme', 'vscode-theme.css');
  writeFileSync(out, `${header + blocks.join('\n\n')}\n`, 'utf8');
  // Formatted here, not left for the next `verify` to notice: a generator whose
  // output fails lint makes every regeneration a dirty tree.
  spawnSync('bunx', ['biome', 'format', '--write', out], { stdio: 'inherit' });
  for (const [theme, r] of Object.entries(report)) {
    console.log(
      `${theme}: ${r.resolved} variables written, ${r.dropped} left to the stylesheet fallbacks`,
    );
  }
}

await main();
