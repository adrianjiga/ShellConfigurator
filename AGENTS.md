# AGENTS.md

Interactive Ink (React) TUI that walks users through configuring Starship. Node >=22, ESM.

## Commands

- `npm run dev` — run the wizard via tsx (interactive TUI). **Dangerous**: it runs real system installs (`sudo apt/dnf/pacman`, `chsh`) and writes `~/.config/starship.toml`, Nerd Fonts, and shell RC files (`~/.zshrc`, `~/.bashrc`, `~/.config/fish/config.fish`). Never run it to "test" a change on a machine you don't want modified; verify logic via unit tests instead.
- `npm test` / `npm test -- --run <file>` — vitest, tests in `src/__tests__/` mirroring `src/`. Single test: `npx vitest run src/__tests__/generators/starship.test.ts`. `npm run test:coverage` adds the v8 report (thresholds in `vitest.config.ts`).
- `npm run lint` (eslint, `no-explicit-any` is an error), `npm run format:check` / `npm run format` (prettier).
- `npm run build` — `tsc`, emits `dist/`. `npm run typecheck` (`tsconfig.test.json`) type-checks **including** `src/__tests__`, which the build config excludes; run it before pushing.
- CI (`.github/workflows/ci.yml`) runs lint, format:check, typecheck, build, coverage (node 22 + 24 on ubuntu, plus a macOS runner), and a `distro-smoke` Docker matrix as separate jobs — nothing runs the wizard itself. GitHub Actions are pinned to commit SHAs with `# vX.Y.Z` comments so Dependabot can update them.
- `.npmrc` sets `legacy-peer-deps=true` — required for Ink's peer deps; don't remove. `prepare` runs `npm run build` on every install.

## Architecture

- `src/index.tsx` renders `<App/>` (Ink). `src/app.tsx` owns all `WizardState` and the linear step flow (`STEP_ORDER` in `src/types.ts`): welcome → fontcheck → font_select → preset → segments_left → segments_right → style → shells → installing → done. Step navigation is the pure `getNextStep`/`getPrevStep` pair in `src/stepMachine.ts`, wrapped by `goNext`/`goBack` in `app.tsx`.
- The `font_select` step is conditionally skipped based on the `NerdFontChoice` union in `nerdFontToInstall` (`{kind:'none'} | {kind:'select'} | {kind:'install',id}`), driven by the single `shouldVisitFontSelect()` predicate (`types.ts`). Task-building uses `fontIdToInstall()` to get the concrete id. There is no sentinel string.
- `character` module is special: never shown as a toggle in `SegmentsScreen`, always appended to `leftModules`. It also only generates a config block when a module is selected — the character block comes from `leftModules`/`rightModules` including `'character'`.
- `starship.ts` deliberately uses `$fill` (inline) instead of `right_format` for right-side modules — `right_format` pins to the cursor line and misaligns two-line prompts. Do not "fix" this; `starship.test.ts` asserts its absence.
- `services/detector.ts` exposes only `*Async` detection functions, so nothing blocks the Ink render loop. `scripts/docker-smoke.mjs` awaits them via top-level `await`.
- Install orchestration lives in `services/installTasks.ts` as `runInstallTasks(state, deps, onUpdate, signal?)` with injected deps (`InstallTaskDeps`, real wiring in `DEFAULT_INSTALL_TASK_DEPS`) so it's unit-testable; screens pass real deps, tests pass fakes. The optional `AbortSignal` halts the chain at phase boundaries and marks unrun tasks failed — never silently done.
- Generators/services (`generators/`, `services/`, `config/`) are unit-tested; key screen key-handling is covered via `ink-testing-library` (`src/__tests__/screens/`), and remaining edge cases by the manual test plan (`Manual-Testing-Plan.md`).
- Docs live in `docs/` (Architecture, Technical-Design, API-Interface-Design, UI-UX-Design) and are a good source for wiring details.

## Conventions

- ESM: relative imports name the real source file (e.g. `from './types.ts'`, `from './App.tsx'`). `rewriteRelativeImportExtensions` rewrites them to `.js` on emit, so `dist/` stays valid for Node's ESM resolver. Never write `.js` in source.
- Package manager detection order matters and is asserted in tests: brew → pacman → os-release distro id → apt-get/dnf binary → `script`.
- Binary checks live in `services/exec.ts` and use `sh -c 'command -v "$1"' sh <cmd>`, never `which` — `which` is absent on minimal/Fedora/Alpine images, and passing the name as `$1` keeps it out of the script text. The CI `distro-smoke` job guards it.
- All install commands go through `runCommand` in `services/exec.ts`: async `spawn`, never `spawnSync`, and it suspends the Ink UI (`services/tty.ts`) for the child's lifetime so sudo prompts are not painted over.
- `detector.test.ts` shows the required mocking pattern: `vi.hoisted` mocks plus a `Symbol.for('nodejs.util.promisify.custom')` stub so promisified `execFile` resolves correctly. Follow it when adding detection tests.
- `shellRc.ts` `applyShellConfig` is idempotent (skips if the init line is already present) — keep that behavior.
