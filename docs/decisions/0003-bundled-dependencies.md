# 0003 — Keep `node_modules` inside the packed tarball

**Status**: Accepted

## Context

The curl installer (`scripts/install.sh`) downloads the release tarball from
GitHub, which is produced by `npm pack`. The published npm package also needs to
work, but npm packages install their dependencies at install time.

A packed package from this project is meant to be *self-contained*: the user
runs `dist/index.js` straight out of the extracted tarball with no `npm install`
step. Without self-containment, a bare `dist/` tarball crashes with
`ERR_MODULE_NOT_FOUND` the moment it tries to load a dependency.

## Decision

The four runtime dependencies — `fflate`, `ink`, `ink-select-input`, `react` —
are listed in `bundledDependencies` so `npm pack` copies their `node_modules`
into the tarball. The release pipeline verifies the tarball boots
(`dist/index.js` runs after extraction) before publishing.

## Consequences

- The tarball is larger, but remains a single download with zero post-install
  steps — acceptable for a CLI installer.
- Adding a new runtime dependency requires updating `bundledDependencies` and the
  args to `bundledDependencies`/`dependencies` in `package.json`; forgetting it
  only shows up at release time, which is exactly why the pack-and-run check is
  part of the release workflow.
- Dev dependencies stay out of the bundle, which is why `dependabot-automerge`
  is limited to patch-level `build(deps-dev):` bumps.