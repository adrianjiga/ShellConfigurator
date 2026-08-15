# AGENTS.md

Interactive Ink (React) TUI that walks users through configuring Starship. Node >=18, ESM.

## Commands

- `npm run dev` — run the wizard via tsx (interactive TUI). **Dangerous**: it runs real system installs (`sudo apt/dnf/pacman`, `chsh`) and writes `~/.config/starship.toml`, Nerd Fonts, and shell RC files (`~/.zshrc`, `~/.bashrc`, `~/.config/fish/config.fish`). Never run it to "test" a change on a machine you don't want modified; verify logic via unit tests instead.
- `npm test` / `npm test -- --run <file>` — vitest, tests in `src/__tests__/` mirroring `src/`. Single test: `npx vitest run src/__tests__/generators/starship.test.ts`.
- `npm run lint` (eslint, `no-explicit-any` is an error), `npm run format:check` / `npm run format` (prettier).
- `npm run build` — `tsc`; this is the typecheck. There is no separate typecheck script. `npx tsc --noEmit` checks without emitting.
- CI (`.github/workflows/ci.yml`, node 22) runs lint, format:check, build, test as separate jobs — nothing runs the wizard itself.
- `.npmrc` sets `legacy-peer-deps=true` — required for Ink's peer deps; don't remove. `prepare` runs `npm run build` on every install.

## Architecture

- `src/index.tsx` renders `<App/>` (Ink). `src/app.tsx` owns all `WizardState` and a linear step machine (`STEP_ORDER`): welcome → fontcheck → font_select → preset → segments_left → segments_right → style → shells → installing → done.
- The `font_select` step is conditionally skipped using the sentinel `FONT_SELECT_SENTINEL` (`'__select__'`) in `nerdFontToInstall` — both `goNext`/`goBack` in `app.tsx` and task-building in `InstallingScreen.tsx` branch on it.
- `character` module is special: never shown as a toggle in `SegmentsScreen`, always appended to `leftModules`. It also only generates a config block when a module is selected — the character block comes from `leftModules`/`rightModules` including `'character'`.
- `starship.ts` deliberately uses `$fill` (inline) instead of `right_format` for right-side modules — `right_format` pins to the cursor line and misaligns two-line prompts. Do not "fix" this; `starship.test.ts` asserts its absence.
- `services/detector.ts` has both sync and `*Async` versions of every detection function. Screens must use the async versions so they don't block the Ink render loop; keep both in sync when editing.
- Generators/services (`generators/`, `services/`, `config/`) are unit-tested; `screens/` and `components/` are only covered by the manual test plan (`Manual-Testing-Plan.md`).
- Docs live in `docs/` (Architecture, Technical-Design, API-Interface-Design, UI-UX-Design) and are a good source for wiring details.

## Conventions

- ESM: all relative imports end in `.js` even in TS source (e.g. `from './types.js'`); `moduleResolution: bundler`.
- Package manager detection order matters and is asserted in tests: brew → pacman → os-release distro id → apt-get/dnf binary → `script`.
- `detector.test.ts` shows the required mocking pattern: `vi.hoisted` mocks plus a `Symbol.for('nodejs.util.promisify.custom')` stub so promisified `execFile` resolves correctly. Follow it when adding detection tests.
- `shellRc.ts` `applyShellConfig` is idempotent (skips if the init line is already present) — keep that behavior.
