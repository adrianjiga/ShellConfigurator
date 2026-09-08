# AGENTS.md

Interactive Ink (React) TUI that walks users through configuring Starship. Node >=22, ESM.

## Commands

- `npm run dev` — run the wizard via tsx (interactive TUI). **Dangerous**: it runs real system installs (`sudo apt/dnf/pacman`, `chsh`) and writes `~/.config/starship.toml`, Nerd Fonts, and shell RC files (`~/.zshrc`, `~/.bashrc`, `~/.config/fish/config.fish`). Never run it to "test" a change on a machine you don't want modified; verify logic via unit tests instead.
- `npm test` / `npm test -- --run <file>` — vitest, tests in `src/__tests__/` mirroring `src/`. Single test: `npx vitest run src/__tests__/generators/starship.test.ts`. `npm run test:coverage` adds the v8 report (thresholds in `vitest.config.ts`).
- `npm run lint` (biome, `no-explicit-any` is an error), `npm run format:check` / `npm run format` (biome). Biome config lives in `biome.json`; the linter sidesteps the `typescript` compiler, so TS 7 updates don't break it.
- `npm run build` — `tsc`, emits `dist/`. `npm run typecheck` (`tsconfig.test.json`) type-checks **including** `src/__tests__`, which the build config excludes; run it before pushing.
- CI splits into `.github/workflows/ci.yml` (lint, format:check, typecheck, build, and the `distro-smoke` Docker matrix) and `.github/workflows/tests.yml` (the v8 coverage gate on node 22 + 24 ubuntu plus a macOS runner). Both trigger on push to master and PRs to master — nothing runs the wizard itself. GitHub Actions are pinned to commit SHAs with `# vX.Y.Z` comments so Dependabot can update them.
- `.npmrc` sets `legacy-peer-deps=true` — required for Ink's peer deps; don't remove. `prepare` runs `npm run build` on every install.

## Repository rules and releases

- `master` is protected by the GitHub ruleset "master protection" (configured on GitHub, not in the repo): PRs only, no force-push/deletion on the branch (tags are unaffected), 0-approval solo merge, and 6 required status checks — Quality gate (lint + format + typecheck + build via `ci.yml`), Coverage gate (node 22/24 Ubuntu + macOS via `tests.yml`), and the 4 distro-smoke jobs — with branches tested against latest master (`strict`). CodeQL still scans via a `code_quality` rule (errors only) rather than a required check, because CodeQL contexts don't run on Dependabot PRs.
- Releasing: bump `package.json` + lockfile, push a `v*` tag → `release.yml` stages to npm via OIDC and creates the GitHub release with the `npm pack` tarball; then approve the staged package with 2FA (`npm stage approve` / npmjs Staged Packages tab).
- The curl installer (`scripts/install.sh`) consumes the GitHub-release tarball, which must stay self-contained: `bundledDependencies` (fflate, ink, ink-select-input, react) keep `node_modules` inside the packed tarball. Verify with `npm pack --pack-destination <dir>` and running `dist/index.js` from the extracted tar — a bare `dist/` tarball crashes with `ERR_MODULE_NOT_FOUND`.

## Architecture

- `src/index.tsx` renders `<App/>` (Ink). `src/app.tsx` owns all `WizardState` and the linear step flow (`STEP_ORDER` in `src/types.ts`): welcome → fontcheck → font_select → preset → segments_left → segments_right → style → shells → installing → done. Step navigation is the pure `getNextStep`/`getPrevStep` pair in `src/stepMachine.ts`, wrapped by `goNext`/`goBack` in `app.tsx`.
- The `font_select` step is conditionally skipped based on the `NerdFontChoice` union in `nerdFontToInstall` (`{kind:'none'} | {kind:'select'} | {kind:'install',id}`), driven by the single `shouldVisitFontSelect()` predicate (`types.ts`). Task-building uses `fontIdToInstall()` to get the concrete id. There is no sentinel string.
- `character` module is special: never shown as a toggle in `SegmentsScreen`, always appended to `leftModules`. It also only generates a config block when a module is selected — the character block comes from `leftModules`/`rightModules` including `'character'`.
- `starship.ts` deliberately uses `$fill` (inline) instead of `right_format` for right-side modules — `right_format` pins to the cursor line and misaligns two-line prompts. Do not "fix" this; `starship.test.ts` asserts its absence.
- `services/detector.ts` exposes only `*Async` detection functions, so nothing blocks the Ink render loop. `scripts/docker-smoke.mjs` awaits them via top-level `await`.
- Install orchestration lives in `services/installTasks.ts` as `runInstallTasks(state, deps, onUpdate, signal?)` with injected deps (`InstallTaskDeps`, real wiring in `DEFAULT_INSTALL_TASK_DEPS`) so it's unit-testable; screens pass real deps, tests pass fakes. The optional `AbortSignal` halts the chain at phase boundaries and marks unrun tasks failed — never silently done.
- Generators/services (`generators/`, `services/`, `config/`) are unit-tested; key screen key-handling is covered via `ink-testing-library` (`src/__tests__/screens/`), and remaining edge cases by a manual test plan the maintainer keeps locally (not in the repo).
- Docs live in `docs/` (Architecture, Technical-Design, API-Interface-Design, UI-UX-Design) and are a good source for wiring details.

## Conventions

- Always use conventional commit messages (e.g. `feat:`, `fix:`, `ci:`, `docs:`, `chore:`).
- Never commit or push directly to `master`/`main` — every change goes through a feature branch and a PR.
- Every PR description has these sections: **Summary**, **Why**, **What Changed**.
- ESM: relative imports name the real source file (e.g. `from './types.ts'`, `from './App.tsx'`). `rewriteRelativeImportExtensions` rewrites them to `.js` on emit, so `dist/` stays valid for Node's ESM resolver. Never write `.js` in source.
- Package manager detection order matters and is asserted in tests: brew → pacman → os-release distro id → apt-get/dnf binary → `script`.
- Binary checks live in `services/exec.ts` and use `sh -c 'command -v "$1"' sh <cmd>`, never `which` — `which` is absent on minimal/Fedora/Alpine images, and passing the name as `$1` keeps it out of the script text. The CI `distro-smoke` job guards it.
- The `distro-smoke` containers run `scripts/ci/distro-setup.sh` first, which upgrades to a pinned Node 22 tarball when the distro ships an older node (debian/ubuntu ship 18) so the run uses the same engine floor as everywhere else. Don't remove or inline it.
- All install commands go through `runCommand` in `services/exec.ts`: async `spawn`, never `spawnSync`, and it suspends the Ink UI (`services/tty.ts`) for the child's lifetime so sudo prompts are not painted over.
- `detector.test.ts` shows the required mocking pattern: `vi.hoisted` mocks plus a `Symbol.for('nodejs.util.promisify.custom')` stub so promisified `execFile` resolves correctly. Follow it when adding detection tests.
- `shellRc.ts` `applyShellConfig`/`resetSharedShellConfig` are idempotent **and mutually exclusive**: each removes the other's stale `Added by ShellConfigurator` blocks before writing, so a re-run can repair an rc file polluted by earlier runs that switched that shell between configured and unconfigured. Keep that behavior.
