# AGENTS.md

Interactive Ink (React) TUI that walks users through configuring Starship. Node >=18, ESM.

## Commands

- `npm run dev` — run the wizard via tsx (interactive TUI). **Dangerous**: it runs real system installs (`sudo apt/dnf/pacman`, `chsh`) and writes `~/.config/starship.toml`, Nerd Fonts, and shell RC files (`~/.zshrc`, `~/.bashrc`, `~/.config/fish/config.fish`). Never run it to "test" a change on a machine you don't want modified; verify logic via unit tests instead.
- `npm test` / `npm test -- --run <file>` — vitest, tests in `src/__tests__/` mirroring `src/`. Single test: `npx vitest run src/__tests__/generators/starship.test.ts`. `npm run test:coverage` adds the v8 report (thresholds in `vitest.config.ts`).
- `npm run lint` (eslint, `no-explicit-any` is an error), `npm run format:check` / `npm run format` (prettier).
- `npm run build` — `tsc`; this is the typecheck. There is no separate typecheck script. `npx tsc --noEmit` checks without emitting.
- CI (`.github/workflows/ci.yml`, node 22) runs lint, format:check, build, coverage, and a `distro-smoke` Docker matrix as separate jobs — nothing runs the wizard itself. GitHub Actions are pinned to commit SHAs with `# vX.Y.Z` comments so Dependabot can update them.
- `.npmrc` sets `legacy-peer-deps=true` — required for Ink's peer deps; don't remove. `prepare` runs `npm run build` on every install.

## Architecture

- `src/index.tsx` renders `<App/>` (Ink). `src/app.tsx` owns all `WizardState` and the linear step flow (`STEP_ORDER` in `src/types.ts`): welcome → fontcheck → font_select → preset → segments_left → segments_right → style → shells → installing → done. Step navigation is the pure `getNextStep`/`getPrevStep` pair in `src/stepMachine.ts`, wrapped by `goNext`/`goBack` in `app.tsx`.
- The `font_select` step is conditionally skipped using the sentinel `FONT_SELECT_SENTINEL` (`'__select__'`) in `nerdFontToInstall`, driven by the single `shouldVisitFontSelect()` predicate (`types.ts`). Both step navigation and task-building in `installTasks.ts` branch on it.
- `character` module is special: never shown as a toggle in `SegmentsScreen`, always appended to `leftModules`. It also only generates a config block when a module is selected — the character block comes from `leftModules`/`rightModules` including `'character'`.
- `starship.ts` deliberately uses `$fill` (inline) instead of `right_format` for right-side modules — `right_format` pins to the cursor line and misaligns two-line prompts. Do not "fix" this; `starship.test.ts` asserts its absence.
- `services/detector.ts` exposes only `*Async` detection functions, so nothing blocks the Ink render loop. `scripts/docker-smoke.mjs` awaits them via top-level `await`.
- Install orchestration lives in `services/installTasks.ts` as `runInstallTasks(state, deps, onUpdate)` with injected deps (`InstallTaskDeps`, real wiring in `DEFAULT_INSTALL_TASK_DEPS`) so it's unit-testable; screens pass real deps, tests pass fakes.
- Generators/services (`generators/`, `services/`, `config/`) are unit-tested; key screen key-handling is covered via `ink-testing-library` (`src/__tests__/screens/`), and remaining edge cases by the manual test plan (`Manual-Testing-Plan.md`).
- Docs live in `docs/` (Architecture, Technical-Design, API-Interface-Design, UI-UX-Design) and are a good source for wiring details.

## Conventions

- ESM: all relative imports end in `.js` even in TS source (e.g. `from './types.js'`); `moduleResolution: bundler`.
- Package manager detection order matters and is asserted in tests: brew → pacman → os-release distro id → apt-get/dnf binary → `script`.
- Binary checks use `sh -c 'command -v …'`, never `which` — `which` is absent on minimal/Fedora/Alpine images. Both `detector.ts` and `installer.ts` follow this; the CI `distro-smoke` job guards it.
- `detector.test.ts` shows the required mocking pattern: `vi.hoisted` mocks plus a `Symbol.for('nodejs.util.promisify.custom')` stub so promisified `execFile` resolves correctly. Follow it when adding detection tests.
- `shellRc.ts` `applyShellConfig` is idempotent (skips if the init line is already present) — keep that behavior.
