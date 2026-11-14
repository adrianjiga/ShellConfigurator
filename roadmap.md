# Roadmap — ShellConfigurator

Single planning document: the phase plan, every open feature idea, and its status. The
feature research that used to live in a second document is folded into the phase tasks
below, so there is one place to look.

Goal: every feature idea is built on a clean seam, so refactors land exactly where a
feature needs them, never as a separate "reformat the world" churn. Every task is its own
feature-branch PR, per AGENTS.md conventions.

CI never runs `npm run dev`; verification is via unit, screen, golden, and smoke tests
(the `script` distro-smoke cell drives the real wizard `App` from `dist/` through
`scripts/ci/wizardSmoke.mjs`). Coverage thresholds in `vitest.config.ts` ratchet up with each phase,
never down.

**Status legend:** **DONE** implemented · **PARTIAL** foundation shipped, feature
not complete · **TODO** not started · **PARKED** deliberately deferred.

**Open decisions (to be resolved before the relevant phase):**

- **D1** — Named profiles (#16) and remote-over-SSH (#28): parked until explicit go/no-go
  (marked `[PARKED]` below).
- **D2** — Headless CLI flags + `--state` format: treated as a **public, versioned API from
  day one** (recommended).

## How to read

- Feature IDs (#n) are stable and live inline in their phase task.
- `D[x]` under each task = dependencies on earlier tasks (DAG edges).

## At a glance

| Status           | Items                                                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| DONE             | P0.1–P0.13 · P1.1–P1.4 · P2.1–P2.6 · P3.1–P3.5 · P4.1–P4.4 · #1 #2 #4 #5 #7 #8 #10 #11 #12 #13 #14 #17 #19 #20 #22 #23 #24 #26 #27 |
| TODO             | P4.5–P4.10 · P5.1–P5.3 · #6 #9 #15 #18 #21 #25                                                                                     |
| PARTIAL          | #3 (CLI card export/import done, no in-wizard card copy)                                                                           |
| PARKED (D1)      | P5.4 (#16) · P5.5 (#28)                                                                                                            |
| PARKED (no task) | WSL/Windows · update checker · offline font · preset alignment · supply-chain polish · lazy-load · window title                    |

---

## Phase 0 — Clean-code foundations (zero behavior change; unblocks features)

**P0.1 — Single source: prompt symbols & powerline separators** — **DONE**

- New `src/config/promptSymbols.ts`; consumed by `generators/starship.ts` and `components/PromptPreview.tsx` (kills the `'\$'` vs `'$'` drift).
- _Unblocks:_ #2 real preview, #26 golden tests. **D:** none.

**P0.2 — Single source: `STARSHIP_CONFIG` line** — **DONE**

- Export `starshipConfigLine()` from `generators/shellRc.ts`; `screens/ReviewScreen.tsx` consumes it.
- _Unblocks:_ #1 headless, #9 dry-run diff. **D:** none.

**P0.3 — `runTask(id, fn)` + `errorMessage()` in `installTasks.ts`** — **DONE**

- Collapses the 5 phase blocks; unifies `String(err)`/`err.message`; deletes dead `InstallCancelledError`; centralizes magic task ids (incl. `shellTaskId`) into constants; folds the abort-guard into `runTask` so every phase shares one idiom; drops `buildTaskList`'s default `fontIdToInstall` param so it's computed once.
- _Unblocks:_ #8 verify, #11 font phase, #12 uninstall, #20 repair. **D:** none.

**P0.4 — Centralized status/task/font-label data** — **DONE**

- New `src/config/status.ts` (status marks in one shape); `fontLabel()` next to `NERD_FONTS`.
- _Unblocks:_ shared Done/Installing rendering, #12/#14/#4 teardown & history. **D:** P0.3.

**P0.5 — Step-machine + router robustness** — **DONE**

- `getNextStep` no longer discards a pending `update` at boundaries; dedupes the two conditional-skip blocks into one walk over `STEP_ORDER` (the `shouldVisitFontSelect` predicate plus an inline dry-run check that skips `installing`); `app.tsx` switch gets `assertNever` exhaustiveness.
- _Unblocks:_ safely adding new steps/screens later. **D:** none.

**P0.6 — Test helper single-sourcing** — **DONE**

- `src/__tests__/helpers/installTasks.ts` (fakeDeps) + shared `flush`; removes the identity helper; fixes the duplicated font-skip test that passes `NO_NERD_FONT` for both names; moves `index.test.tsx`'s terminal-state setup along with the `restoreTty()` extraction.
- **D:** none.

**P0.7 — CI refactor** — **DONE**

- Collapse 4 copy-paste jobs → matrix/composite action; extract `dockerSmoke` orchestration into a script; dedupe `distroSetup.sh` download branches.
- _Unblocks:_ adding new CI legs (headless smoke, golden gate, lifecycle e2e). **D:** none.

**P0.8 — `installer.ts` cleanup sweep** — **DONE**. no sentinel "no method" (type `script`'s entry so lookup throws); split `installNerdFont` into `downloadFont` / `verifyChecksum` / `installFontFiles`; drop the useless double optional-chain on `headers.get`; attach `{ cause: err }` in the checksum throw; make `SHELL_PACKAGES`' intentional missing combos self-documenting. **D:** none.

**P0.9 — `exec`/`detector` probe sweep** — **DONE**. one `probe(cmd): string | null` behind `commandExists`/`commandPath`; shared `byName()` for shell lookup; named `DNF_DISTROS`/etc. constants; extract a `FONT_FILE` regex const inside the enclaved worker source [optional]. **D:** none.

**P0.10 — Screens refactor sweep** — **DONE**. `DoneScreen`: one `findTask(state, id)` lookup instead of three `find` walks; `StyleScreen`: value-state instead of index-state, drop the `PALETTES[colorIdx]!` cast; `SegmentsScreen`: `applyModules(commit, modules)` collapses the `side` ternaries; `WelcomeScreen`: shared `runDetection()` for both detection paths; typed `SelectInput` value unions; `PresetScreen` invariant instead of `?? ''`; one indent convention across `ShellScreen`/`SegmentsScreen`. **D:** none.

**P0.11 — `shellRc`/`config` sweep** — **DONE**. reuse `backupStamp()` in `writeShellConfig`; `isShellId` type guard in `restoreConfigBackups`; extract `buildAdditionLines` from `applyShellConfig`; `isConfigurableModule` predicate shared with `PromptPreview`; `CORE_MODULES` array in `config/modules.ts`; `getShellBinary` throws on unknown shell; comment block above the nushell `initLine`. **D:** none.

**P0.12 — Core robustness extras** — **DONE**. move `process.exitCode` decision into `index.tsx` teardown; derive `WizardLayout` step numbers from `STEP_ORDER`; document or drop the `--no-install` alias in `--help`; move cursor restore into `tty.ts` as `restoreTty()` + `SHOW_CURSOR` constant. **D:** none.

**P0.13 — CI/scripts polish sweep** — **DONE**. make `release.yml` trust the existing gates (or document why it re-runs); drive the smoke harness by expected frames instead of `sleep(150)` [optional]; optionally parse the GH-API with `node -e` in `install.sh`; anchor `releaseNotes.sh` breaking-change globs to the prefix. **D:** P0.7.

**Gate:** lint + format:check + typecheck + full suite green; coverage ≥ current thresholds; no behavior change; new golden fixtures introduced next phase.

---

## Phase 1 — The seams: headless + data layer

**P1.1 — History + font cache (#22)** — **DONE**

- `src/services/history.ts` (append-only `history.jsonl` under XDG state) and `src/services/cache.ts` (font cache with pinned SHA-256 under XDG cache).
- **D:** none.

**P1.2 — Headless mode + versioned state (#1, #3)** — **DONE**

- Versioned `serializeState`/`parseState`; `stateFromFlags()` builder; `generate`/`apply` subcommands; `export`/`import` of state cards. Flag surface frozen per **D2**.
- **D:** P0.2, P0.3, P1.1.
- **Note:** the in-wizard "copy my config card" affordance from #3 is still open; the CLI half is done.

**P1.3 — Golden TOML fixtures (#26)** — **DONE**

- `src/__tests__/golden/*.toml` per preset, asserted by the generator harness. **D:** P0.1, P0.2.

**P1.4 — Adopt-existing-config (#7) + `--import-url` (#24)** — **DONE**

- `keepExistingConfig` branch in the task list; URL/gist fetch folded into adopt mode. **D:** P1.2.
  - `keepExistingConfig` persisted in the state card (additive); `applyShellConfig` adopt block marker (`(shared config)`); `writeSharedConfig` for `--import-url` fetch; `--adopt`/`--import-url` rejected outside `apply`; shellRc adopt/non-adopt mode flips both directions.

**Gate:** headless `generate`/`apply` unit tests + a CI job running both; coverage holds; golden fixtures pass.

> Gate met: headless `generate`/`apply` unit tests and the golden fixtures pass, coverage holds, and a CI
> job now invokes **both** subcommands through the real `dist/index.js` entrypoint — the macOS smoke runs
> `generate` (stdout + `-o`/`--export`) and a real `apply` (`Verify config` included), and the distro-smoke
> `script` cell chains headless `generate` and `apply` legs off a real install in the scratch HOME
> (`scripts/ci/headlessGenerateSmoke.mjs`, `scripts/ci/headlessApplySmoke.mjs`).

---

## Phase 2 — Trust: truthful preview + health

**P2.1 — Real preview via starship binary (#2)** — **DONE**

- `src/services/preview.ts`: scratch dir + `STARSHIP_CONFIG` + `starship prompt`, static fallback when absent. PromptPreview becomes a thin consumer. **D:** P0.1, P1.3.

**P2.2 — Terminal detection + font wiring (#11)** — **DONE**

- Add terminal detection to `detector.ts`; `src/services/terminalFont.ts` for alacritty/kitty/wezterm/ghostty/foot edits (backups + idempotent); new install phase via P0.3's `runTask`. **D:** P0.3.

**P2.3 — `doctor` (#10)** — **DONE**

- `src/services/doctor.ts`: rc-content checks, `STARSHIP_CONFIG` validity, locale/UTF-8, version drift (vs cache), font-installed-and-**selected** (P2.2). `--json` + non-zero exit. **D:** P1.1, P2.2.

**P2.4 — `repair` / `doctor --fix` (#20)** — **DONE**

- Fix branches per doctor check: re-add missing rc lines (`configure-shell`), rewrite a missing per-shell config from a `--state` card (`write-config`), reinstall the font (from cache, downloading when nothing is cached), invoke P2.2 wiring (`wire-font`), reinstall starship. Only failing checks are fixed unless `--include-warnings` is passed; `--dry-run` only lists the planned fixes. **D:** P2.3, P2.2, P0.3.

**P2.5 — Post-install verification task (#8)** — **DONE**

- `verify` task ("Verify config") via `runTask`: `starship print-config` against each written TOML. **D:** P0.3.

**P2.6 — Container / CI detection** — **DONE**

- Detect containers (env markers, `/run/.containerenv`); auto-skip font install and `chsh`, still apply config. Makes the wizard work in Codespaces/devcontainers. **D:** P2.3.

**Gate:** fake-exec integration tests for doctor/repair; snapshot test of preview fallback; verify runs in headless apply CI leg.

> Gate met on `feat/phase2-trust`: the fake-exec doctor/repair integration test drives the real deps
> end-to-end, the preview fallback (and the static `PromptPreview` frame) is snapshot-pinned, and the
> smoke leg runs a headless `apply` then verifies the written config. That work also landed the
> running-shell check + version-drift checks and the plan/execution order alignment.

---

## Phase 3 — Picker + breadth (visible wow)

**P3.1 — Search, multi-select, and reorder (#17 + #19)** — **DONE**

- Refactor `SegmentsScreen`; shared `PickerRow` component (absorbs the three copy-pasted picker-row box blocks in `StyleScreen`); add a search/filter line and genuine multi-select; up/down reordering in `leftModules`/`rightModules`.
- **Why.** The picker is the ceiling on the tool's core differentiator (#4), and module order is half of what makes a prompt feel designed. p10k's wizard and Oh-My-Posh Studio both let you reorder; the current screen only toggles.
- **How.** Up/down key handling on a focused toggle row; reorder the existing `leftModules`/`rightModules` arrays in `WizardState`; filter the `MODULE_DEFS` list with a text line. One screen + state mutation, all in `src/`.
- **Effort.** M. **D:** none structural.
- **Shipped:** filter line (matches label and description), selected modules grouped in prompt order above
  the available list, Space multi-select, Shift+↑/↓ (or Ctrl+↑/↓) reorder, and a shared `PickerRow` used
  by both Style and Segments.

**P3.2 — Module library 15→31 (#4)** — **DONE**

- Add the popular missing modules: `status` (exit code), `os`, `shlvl`, `sudo`, `git_commit`; `golang`, `java`, `dotnet`, `ruby`, `php`, `c`/`cpp`, `zig`, `lua`, `swift`, `elixir`. The table now has 31 entries.
- **Why.** Starship is bought for breadth; the picker is the tool's core value-add over raw config editing, and each addition is a table row plus a palette entry — mechanical, low risk, high "wow per line".
- **How.** `MODULE_DEFS` rows + `ConfigurableModuleId` union + palette colour; the preview, generator, and powerline wrapping come for free because they're driven by the table. Watch the `leftModules`/`rightModules` defaults and preset arrays that select modules by id.
- **Effort.** M. **D:** P3.1, P0.1.
- **Shipped:** 16 modules (the count target was off by three), every palette extended, and the golden fixtures regenerated.

**P3.3 — Style extras (#5)** — **DONE**

- Three generator-only options on the Style screen: `continuation_prompt` (default `'[∙](bright-black) '`), an `add_newline` toggle, and `character.vimcmd_symbol` + `vim_mode` (vim-mode indicator).
- **Why.** All are 1-3 TOML keys Starship already supports; they turn Style from "palette + arrow" into "make it feel like my old prompt". Near-zero risk.
- **How.** New `WizardState` fields with `DEFAULT_STATE` values, `StyleScreen` pickers, and `generateToml` emission; `starship.test.ts` asserts the new keys. `add_newline = true` is currently always emitted, so the toggle is the missing part.
- **Effort.** S-M. **D:** none.
- **Shipped:** `continuationPrompt` (dot/arrow/none), `addNewline`, and `vimMode` on the Style screen; the state card round-trips all three; the generator emits `continuation_prompt`, the `add_newline` value, and `character.vimcmd_symbol`; golden fixtures regenerated.

**P3.4 — Accessibility (#27)** — **DONE**

- Honor the `NO_COLOR` convention globally and add 2-3 genuinely high-contrast palettes to `config/palettes.ts`.
- **Why.** Cheap, principled, and a real differentiator — few terminal tools respect `NO_COLOR`, and the wizard's whole value prop is colour. Genuine accessibility win for low-vision users.
- **How.** Gate Ink colour props through a single `colorsEnabled` helper, and add palette defs plus swatches. **Effort.** S. **D:** P3.2.
- **Shipped:** every `color`/`backgroundColor`/`borderColor` prop goes through `uiColor` (`config/colors.ts`), which honours a non-empty `NO_COLOR`; `ink-select-input` uses a gated wrapper; palette swatches are hidden without colour; added `high-contrast` and `colorblind` (Okabe-Ito) palettes.

**P3.5 — Directory tuning** — **DONE**

- Expose `directory.substitutions` and a `truncation_length` option (it was hardcoded to `3` in `MODULE_DEFS.directory`).
- **Why.** p10k users live by these; longest-path truncation is a common complaint and the generated config already carries the key.
- **How.** `WizardState` field(s) + a Style/Segments control + generator emission; golden fixtures pin the output. **Effort.** S-M. **D:** P3.3.
- **Shipped:** directory depth picker (0–5; 0 shows the full path) and inline comma-separated `from=to` substitution editor on StyleScreen; generator emits escaped `[directory.substitutions]`, state cards persist and validate both fields; added parser, generator, state, and screen tests.

**Gate:** screen tests updated; golden fixtures show the new keys/modules; coverage holds.

---

## Phase 4 — Lifecycle commands (the moat)

**P4.1 — `uninstall` (#12)** — **DONE**

- `shell-configurator uninstall --shells zsh,fish --font`: remove rc blocks, per-shell configs, starship via the detected PM, and optionally the font — reverse install order. `--restore` puts back backups; `--dry-run` previews the plan.
- **Why.** Everything is installed in one command; nothing is uninstalled cleanly. `resetSharedShellConfig` already knows how to remove the tool's own rc blocks, so a full teardown is the natural sibling and builds trust with experimenters.
- **How.** Build the plan from `buildTaskList`'s mirror image; reuse `resetSharedShellConfig`, `restoreConfigBackups`, and the PM uninstall channel from `installer.ts`; ask for confirmation.
- **Effort.** S-M. **D:** P0.3, P0.4, P1.1.
- **Shipped:** `shell-configurator uninstall [--shells …] [--starship] [--font <id>] [--yes] [--dry-run] [--json]`
  (`services/uninstall.ts`). It strips every ShellConfigurator rc block (rc backed up first; a carried PATH
  line stays when the user's own or fish's `conf.d` init does) and moves per-shell configs to `.bak-*`,
  then prints the `cp` commands that copy each backup back. Starship and the font are opt-in rather than
  default, since either may predate the wizard: Starship goes only when no shell would still start it, as
  the script binary or a pacman/apk/Homebrew package that package manager owns; font files are listed from
  the cached archive's headers, and terminals still set to the font are named. A shell's config stays when
  its rc could not be cleaned. It asks on a terminal, needs `--yes` elsewhere, and records an `uninstall`
  run in history. The headless apply smoke now runs a real uninstall, a no-op second uninstall and the
  printed undo commands on every distro cell. Not reverted: the terminal font setting and `chsh`.

**P4.2 — Rollback snapshots (#14)** — **DONE**

- Before any apply (wizard finish or headless `apply`), write a snapshot: `state.json` plus a manifest of the files touched (rcs, per-shell configs, shared config, backups). `--rollback <id>` restores an entire prior state, not just the newest per-file backup that `restoreConfigBackups` is limited to.
- **Why.** Pairs with state export (#3): snapshots are state export + file manifest. "Try it, and if you hate it, one command reverts everything" removes the last barrier to experimentation.
- **How.** `writeSnapshot` + `history.jsonl` already record the state card and snapshot id; add the file manifest, `--list-runs`, and the restore path. **Effort.** M. **D:** P1.1, P1.2, P4.1.
- **Shipped:** `shell-configurator rollback [--run <id>] [--yes] [--dry-run] [--json]` and `rollback --list`
  as a subcommand rather than flags, like `uninstall`. Wizard installs, `apply`, `uninstall` and `rollback`
  itself copy every file they may change into `runs/<runId>/` (`services/runCapture.ts`) and keep a
  manifest of the ones they changed (copy before, hash after); history records the `runId`. Rollback puts
  each file back or deletes one the run created, and skips a file changed since, so later edits survive.
  Rolling back again undoes the run before; rolling back a rollback redoes it. The distro smoke rolls back
  its uninstall and then its apply. Not covered: fonts, the Starship binary and `chsh`.

**P4.3 — `debug-info` (#13)** — **DONE**

- `shell-configurator debug-info > issue.md`: detected PM, distro/OS id, shells + installed status, terminal + locale, relevant PATH entries, installed starship version vs the PM's latest.
- **Why.** Mirrors starship's `bugreport`; bug reports become "run this, paste the file" instead of "it doesn't work". Almost free — it is a reporter over the detector's existing outputs.
- **How.** New subcommand in `index.tsx`; compose detector results + doctor checks into Markdown. **Effort.** S. **D:** P2.3.
- **Shipped:** `shell-configurator debug-info [--json]` (`services/debugInfo.ts`): versions, OS + distro, PM,
  container, terminal, locale, current shell, Starship (path, version, off-PATH dir, recorded version,
  `STARSHIP_CONFIG`), a per-shell table, PATH entries, the last recorded run and the doctor report. The home
  directory shows as `~`, and URL credentials are dropped from the recorded command. The bug report template
  asks for it, and the generate smoke runs it on every distro cell. Not included: the package manager's
  latest Starship version, which needs a network or package-index query; the recorded install version and
  the doctor's drift check cover the common case.

**P4.4 — `completions` (#23)** — **DONE**

- Emit bash/zsh/fish completion scripts for shell-configurator itself, mirroring starship's own `completions` command.
- **Why.** Standard CLI ergonomics; one subcommand + three templates. Cheap, expected, and the tool already installs into interactive shells so users will hit completion.
- **How.** One subcommand + three templates over the frozen flag surface (D2). **Effort.** S. **D:** P1.2.
- **Shipped:** `shell-configurator completions <bash|zsh|fish>`. The scripts are generated from one description
  of the CLI (`services/cliSurface.ts`), which a test keeps in step with the parser. They complete
  subcommands, each subcommand's flags, and values: presets, palettes, shells (comma lists), fonts,
  characters and files. They are tested in real bash, zsh and fish, and the generate smoke loads the bash
  script on every distro cell. `--run` ids are not completed.

**P4.5 — Dry-run diff vs disk (#9)** — **TODO**

- Compare the would-be generated TOML and rc additions against what is currently on disk (backups already exist via `backupSharedConfig`/`restoreConfigBackups`).
- **Why.** "Preview" today shows the plan; a diff shows the _consequence_. Turns dry-run into a predictable pre-apply check and gives CI a readable artifact.
- **How.** Reuse the toml/rc writers in a read-only mode; render a `git diff`-style output in the Review screen and/or `--json`. **Effort.** M. **D:** P1.2, P0.2.

**P4.6 — Post-run `WHAT-CHANGED.md` (#18)** — **TODO**

- After install, write `~/.config/starship/WHAT-CHANGED.md`: per-shell what changed, where the rc lines are, and the exact one-liners to undo (→ `uninstall` / `--rollback`).
- **Why.** Human-readable trail for the "what did I run?" moment a week later — a differentiator for newcomers.
- **How.** A renderer over `installResults`, written after the install chain. **Effort.** S. **D:** none.

**P4.7 — Performance doctor (`--timings`) (#21)** — **TODO**

- `shell-configurator timings` runs `starship prompt --timings` against the generated config and suggests fixes: raise `command_timeout`, disable a slow module, tune `scan_timeout`.
- **Why.** "My prompt is slow" is its own support class — distinct from health (#10, is it broken?) and correctness (does it work?). Starship ships the measurement; nobody exposes it to the user.
- **How.** One executor + one table of suggestions, same faked-exec test pattern as the detector; reuse P2.1's scratch-dir harness. **Effort.** S-M. **D:** P2.1.

**P4.8 — Scripting surface** — **TODO**

- `--list-presets` / `--list-modules` / `--list-fonts` and `--dry-run --json`, making headless mode a first-class API.
- **Why.** Scripting surface that makes #1 a first-class API; also feeds completions.
- **How.** Read-only renderers over `PRESETS`/`MODULE_DEFS`/`NERD_FONTS`; JSON branch on the dry-run report. **Effort.** S. **D:** P1.2, P4.5.

**P4.9 — `starship explain` in Review** — **TODO**

- Show _why_ each segment renders in the Review step.
- **Why.** Free insurance against surprise; starship already explains the modules.
- **How.** Run `starship explain` against the generated config via P2.1's exec harness; render as a collapsible section. **Effort.** S-M. **D:** P2.1.

**P4.10 — "Share my prompt"** — **TODO**

- Emit a single `starship.toml` (or PR-ready preset snippet) to paste into the starship presets gallery.
- **Why.** Closes the community loop; `generate` already emits one TOML, so this is the packaging/affordance.
- **How.** A share renderer over `generateToml`, plus a Done/Review action; no new state. **Effort.** S. **D:** P1.2.

**Gate:** full lifecycle e2e in CI (install → doctor → rollback → uninstall) with mock exec.

---

## Phase 5 — p10k-feel polish + gated extras

**P5.1 — Transient prompt (#6)** — **TODO**

- Enable starship's native transience so the old prompt collapses into `❯` after a command. Per-shell rc snippets are required: fish `enable_transience` (fish ≥ 3.2), PowerShell `Enable-TransientPrompt`, bash `bleopt prompt_ps1_transient=always` (only with `ble.sh`), zsh `zle-line-finish` hook that runs `starship module character`.
- **Why.** The single most-requested "make it feel like p10k" item, and unlike p10k it is cross-shell. Starship supports it natively; the work is the rc wiring, which `applyShellConfig` already owns.
- **How.** New per-shell feature flags in `ApplyShellConfigOptions` guarded by runtime detector checks; add a Style/Shell toggle; tests assert the new rc lines only appear for supported shells.
- **Effort.** M. **D:** P2.3.

**P5.2 — Existing prompt-manager detection (#15)** — **TODO**

- Before touching any rc, check for an existing prompt: powerlevel10k lines, oh-my-zsh theme lines, oh-my-posh init, spaceship, or a previous `starship init`. Offer "replace" vs "keep both" and warn when two owners would fight for the same prompt.
- **Why.** The "two prompts / prompt leak" is exactly what `docs/troubleshooting.md` spends the most space on — the most common field failure. Detection is the tool's existing core skill; the wizard simply doesn't look for competing prompts today.
- **How.** A `detectExistingPrompt(rcLines)` helper + one wizard warning step. **Effort.** M. **D:** P2.3.

**P5.3 — Devcontainer / GH-Actions bootstrap output (#25)** — **TODO**

- Under headless mode, a flag that emits a ready-to-paste devcontainer `postCreateCommand` or action step (`curl install.sh && shell-configurator apply --state …`), installing from the pinned release tarball.
- **Why.** Captures the Codespaces/CI audience with zero runtime work — it is a text renderer over the flags headless mode already parses.
- **How.** New output mode/flag; one template per target. **Effort.** S. **D:** P1.2.

**`[PARKED — D1]` P5.4 — Named prompt profiles (#16)** — **PARKED**

- starship supports profiles (`[profile.<name>]`, `starship prompt --profile`). Let the wizard manage named profiles — e.g. `work` (powerline, full modules) vs `ssh` (minimal) — and add `shell-configurator use <name>` to switch by setting the env var starship reads.
- **Why.** Answers "the wizard is one-shot; I want two different prompts for two contexts" without forking config files. **Low confidence it is worth the complexity** — starship's profiles are young and the rc/env wiring per shell adds surface area. Exploratory.
- **Effort.** L. **D:** P1.2.

**`[PARKED — D1]` P5.5 — Remote-over-SSH (#28)** — **PARKED**

- Reuse headless state + the install.sh tarball to bootstrap a remote box (`shell-configurator remote <host> --state …`).
- **Why.** Distinctive ops angle, but multiplies platform surface (no fonts over SSH, PATH quirks). Park unless a specific user shows up. **Effort.** L. **D:** P1.2.

### Park list (no task until requested)

- **WSL / Windows side** — install the font into the Windows font store and patch Windows Terminal `settings.json`. Real value (huge WSL audience) but a platform reversal for a `sh`-based tool. Park until the Linux/mac path is fully closed.
- **Update checker at Welcome** — compare installed starship/nerd-font version to latest and nudge with the exact `pm install` command. Cheap, but generic "check for updates" adds noise — do it only if the doctor reports version drift anyway (it does report drift today; the Welcome nudge does not exist).
- **Offline-first installer / bundled font** — the npm pack is already heavy (bundled deps); shipping one small `.ttf` makes font install network-free. Tempting for air-gapped/CI; weigh against tarball size. The font cache exists, but no bundled font.
- **Align the preset gallery with starship's official presets** — pure, plain-text, bracketed-segments; nice consistency with upstream docs, low priority.
- **Supply-chain polish** — pin/verify the curl `install.sh` (fonts are SHA-checked; the installer itself could be pinned + signed). DevSecOps nicety, low urgency for a hobby tool.
- **Lazy-load screens** — the Ink app imports every screen up front; code-splitting per step would trim startup bytes. Cosmetic; the CLI already starts fast.
- **Window title / preexec hooks** (ble.sh, etc.) — too shell-specific to earn the complexity now; revisit after P5.1.

---

## Critical path

- `P0.1 → P1.3 → P2.1` (preview truth) — **done**
- `P0.3 → P2.2 → P2.3 → P2.4` (doctor + repair) — **done**
- `P1.1 → P1.2 → P4.2` (headless + history + rollback) — **done**

Everything else hangs off `runTask`, the symbol single-source, or headless — which is why the
foundation refactors land first. The P0.8–P0.13 sweeps are cleanup debt that has no feature seam;
they can be picked up in parallel with any phase but each stays its own PR.

## Suggested next order (remaining work)

1. The small wins: **P4.6 `WHAT-CHANGED.md`**, **P4.8 list flags**.
2. Then **P5.1 (#6) transient prompt**, **P5.2 (#15) prompt-manager detection**, **P5.3 (#25) bootstrap**.

## Merge & verification strategy

- One PR per task; conventional commits (`refactor:` for P0, `feat:`/`ci:`/`test:` as appropriate); PR body has Summary/Why/What Changed.
- Each PR runs the existing suite; P1.3 onward adds the golden gate + headless smoke to CI (extending the P0.7 matrix).
- `vitest.config.ts` thresholds only move up.
- The live `npm run dev` wizard is never invoked in CI — everything is exercised via unit/screen/golden paths and the smoke scripts (`wizardSmoke.mjs` drives the built `App` in a scratch `$HOME`), per AGENTS.md.
