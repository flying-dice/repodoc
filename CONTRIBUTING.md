# Contributing

## Setup

Run `npm install`, then press `F5` in VS Code for an Extension Development Host.

## Commands

- `npm run compile` type-checks, lints, and bundles.
- `npm run watch` rebuilds on change.
- `npm test` runs the unit suite (on an in-memory filesystem) and the end-to-end suite (driving the real extension).

## Architecture

The core (`src/core/`) is free of VS Code and Node imports and talks to the filesystem through a port; adapters live in `src/adapters/`. Webview panels and tree providers live in `src/panels/` and `src/trees.ts`. See `docs/` and `decisions/` in this repository for the full handbook and the reasoning behind the design.

## Releases

Pushing a `v*` tag builds the VSIX in CI and attaches it to a GitHub release.
