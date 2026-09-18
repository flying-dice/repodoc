# @repodoc/ui

The webview's components, and the Storybook that renders every one of them.

## Why this exists

Nothing in this repository rendered a view and looked at it. In 0.9.0 and 0.9.1
a merge nested the whole git CSS block inside another rule, so `.diff-add` and
`.diff-del` never matched: the diff view reported "2 added, 2 removed" and
marked nothing. Types, Biome, the bundle, 812 unit tests and two green CI runs
all passed.

Stories here import the **real** shipped stylesheets — `../vscode/media/base.css`
and friends, not copies — so a rule that stops matching is visible in a story
instead of in a bug report.

## Layout

- `src/atoms` — one thing each: avatar, chips, badges, swatches, buttons
- `src/molecules` — small compositions: section heads, notices
- `src/organisms` — whole surfaces: the card face, a diff document
- `src/theme/vscode-theme.css` — **generated**, not hand-written. The real
  `--vscode-*` values, read from microsoft/vscode at a pinned release by
  `scripts/build-theme.mjs`: the default themes with their `include` chain
  flattened, the colour registry defaults, and the git extension's contributed
  colours. 50 of the 52 variables the shipped stylesheets use carry VS Code's
  own values; the two that do not have computed defaults and are left to the
  stylesheet's fallbacks rather than guessed at.

  Run `bun run build-theme` to refresh it (network required). The output is
  committed, so the Storybook build itself never reaches out.

## Running it

```
bun run storybook         # dev server on :6006
bun run build-storybook   # static site in packages/ui/storybook-static
bun run build-theme       # regenerate the theme from VS Code's sources
```

## Deploying to Cloudflare Pages

Point a Pages project at this repository:

| Setting | Value |
| --- | --- |
| Build command | `bun install && bun run build-storybook` |
| Build output directory | `packages/ui/storybook-static` |
| Root directory | *(repository root)* |

Telemetry is disabled in `.storybook/main.js`, so the build makes no outbound
calls of its own.

## The drift this carries

`media/board.js` still has its own copy of every function extracted here — the
shipped webview has no build step and cannot import a module, and moving it onto
these components is a later pass of #21.

Two hand-maintained copies drift. Three tests hold them together:

- `test/mirror.test.ts` — lifts the original out of `board.js` and holds it to
  the component, so drift fails CI rather than being discovered in a screenshot.
- `test/markup.test.ts` — every class a component emits must exist in a shipped
  stylesheet or in `board.js`. While bootstrapping this package I invented about
  twenty class names; each one type-checked, passed its tests, built, and
  rendered unstyled. Nothing was checking.
The nested-CSS guard that goes with them lives next to the stylesheets it
reads, at `packages/vscode/test/unit/stylesheets.test.ts`.

**Anything extracted here with logic of its own needs a mirror test.** Today
that means `agentAvatar`, `tintStyle`, `relativeTime`, the icon set and the
absent deleted badge. Components that are markup only — the organisms — are held
to `board.js` by `markup.test.ts` and by review, not by a lift test; a component
whose behaviour is only "arrange these elements" has nothing a lift test could
compare.
