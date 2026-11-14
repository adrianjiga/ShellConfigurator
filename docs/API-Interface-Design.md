# API & Interface Design

## Core Types

**File**: `src/types.ts`

### Enums

```typescript
type ShellId = 'zsh' | 'bash' | 'fish' | 'nushell' | 'powershell';
type TerminalId = 'alacritty' | 'kitty' | 'wezterm' | 'ghostty' | 'foot';
type CharacterSymbol = 'arrow' | 'lambda' | 'dollar';
type ContinuationPrompt = 'dot' | 'arrow' | 'none';
interface DirectorySubstitution {
  from: string;
  to: string;
}
type PackageManager = 'pacman' | 'apt' | 'dnf' | 'brew' | 'apk' | 'script';
type InstallStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

type InstallTaskId =
  | 'starship'
  | 'font'
  | 'config'
  | 'chsh'
  | 'verify'
  | 'terminal'
  | `shell_${ShellId}`
  | `rc_${ShellId}`
  | `reset_${ShellId}`;

type WizardStep = (typeof STEP_ORDER)[number]; // derived from STEP_ORDER below
```

### WizardState

The single source of truth for the entire wizard:

```typescript
interface WizardState {
  step: WizardStep; // Current wizard step
  hasNerdFont: boolean; // User has or is installing a Nerd Font
  preset: string | null; // Selected preset ID
  leftModules: ModuleId[]; // Module IDs for left prompt
  rightModules: ModuleId[]; // Module IDs for right prompt
  characterSymbol: CharacterSymbol;
  palette: PaletteId; // Colour theme; one per preset, changeable on StyleScreen
  powerline: boolean; // Draw segments as interlocking coloured blocks
  continuationPrompt: ContinuationPrompt; // Marker on wrapped input lines
  addNewline: boolean; // Blank line before each prompt
  vimMode: boolean; // Distinct character in vim normal mode
  directoryTruncationLength: number; // Parent folders shown; 0 means full path
  directorySubstitutions: DirectorySubstitution[]; // Folder-name substitutions
  selectedShells: ShellId[]; // Shells to configure
  packageManager: PackageManager; // Detected package manager
  installedShells: ShellId[]; // Shells already on system
  nerdFontToInstall: NerdFontChoice; // {kind:'none'|'select'|'install',id}
  setDefaultShell: ShellId | null; // Shell to set via chsh
  skipStarshipInstall: boolean; // "Continue without Starship" — drops the Starship install, Verify and the unset pass; rc tasks stay in the plan, marked skipped
  keepExistingConfig: boolean; // Adopt mode: keep the shared starship.toml as-is
  sharedConfigToml: string | null; // Imported shared config (--import-url); runtime-only, never serialized
  dryRun: boolean; // No install or config-write happens — the wizard only previews
  installResults: InstallTask[]; // Final task statuses from InstallingScreen
  terminal: TerminalId | null; // Detected terminal emulator; lets the wizard select the font in it
  container: boolean; // True inside a container/CI sandbox — fonts are per-host and chsh is skipped
}
```

### InstallTask

Tracks individual installation task state in InstallingScreen:

```typescript
interface InstallTask {
  id: InstallTaskId; // Unique task identifier
  label: string; // Display label
  status: InstallStatus; // Current status
  error?: string; // Error message if failed
  note?: string; // Non-error outcome detail (e.g. "already configured", manual steps)
}
```

### Nerd Font Choice

What the user decided about a Nerd Font. A discriminated union rather than a
nullable string with a sentinel, so "no font step", "route to the picker", and
"install this id" cannot be confused and no consumer needs to know a magic value.

```typescript
type NerdFontChoice = { kind: 'none' } | { kind: 'select' } | { kind: 'install'; id: string };

const NO_NERD_FONT: NerdFontChoice; // { kind: 'none' }

function shouldVisitFontSelect(choice: NerdFontChoice): boolean;
// True unless the choice is { kind: 'none' } (user declined a font).

function fontIdToInstall(choice: NerdFontChoice): string | null;
// The font id to install, or null when nothing should be installed.
```

`shouldVisitFontSelect` is the single predicate used by the step machine in both
directions to decide whether to show `font_select`; `fontIdToInstall` is how
task-building resolves the concrete font to install.

### Constants

```typescript
const STEP_ORDER: readonly [...]; // `as const`; WizardStep is its element type
// welcome → fontcheck → font_select → preset → segments_left → segments_right → style → shells → review → installing → done
```

### Step Machine

**File**: `src/stepMachine.ts`

```typescript
function getNextStep(state: WizardState, update?: Partial<WizardState>): WizardState;
// Merges update, advances to the next step, skipping font_select when not wanted
// and installing in dry-run mode. At `done` (or an unknown step) it does not
// advance, but still returns the merged state when an update was passed.

function getPrevStep(state: WizardState): WizardState;
// Moves back a step, skipping font_select when it was never intended.
// Returns the original state unchanged if there is no previous step, or from
// installing/done, which can never be re-entered.
```

Pure functions — `src/app.tsx` wraps them in `goNext`/`goBack` state setters.

---

## Module Schema

**File**: `src/config/modules.ts`

### ModuleId

```typescript
type ModuleId =
  | 'username'
  | 'hostname'
  | 'directory'
  | 'git_branch'
  | 'git_status'
  | 'nodejs'
  | 'python'
  | 'rust'
  | 'docker_context'
  | 'kubernetes'
  | 'aws'
  | 'time'
  | 'battery'
  | 'cmd_duration'
  | 'jobs'
  | 'status'
  | 'os'
  | 'shlvl'
  | 'sudo'
  | 'git_commit'
  | 'golang'
  | 'java'
  | 'dotnet'
  | 'ruby'
  | 'php'
  | 'c'
  | 'cpp'
  | 'zig'
  | 'lua'
  | 'swift'
  | 'elixir'
  | 'character';
```

31 placeable modules (`ConfigurableModuleId`) plus `character`.

### ModuleDef

```typescript
interface ModuleDef {
  id: ConfigurableModuleId;
  label: string; // Display name in UI
  description: string; // Shown when module is focused
  defaultLeft: boolean; // Included in left prompt by default
  defaultRight: boolean; // Included in right prompt by default
  previewSegment: (hasNerdFont: boolean, sample: PreviewSample) => string; // Text for PromptPreview
  plainPreview?: (hasNerdFont: boolean) => string; // Plain-prompt preview, when starship's default format adds words or brackets
  content: string; // Inner format, e.g. '$symbol$version' — what powerline wraps in separators
  settings?: (ctx: ModuleTomlContext) => string; // TOML keys other than style/format
  stylesItself?: boolean; // Module carries its colour in keys other than `style`
}
```

`Id` is typed as `ConfigurableModuleId` (the 31 placeable modules); `character`
is not placeable and so has no entry — it gets special placement on its own line
and is configured on the Style screen instead.

`ModuleTomlContext` hands each `settings` builder `{ hasNerdFont, powerline,
customFormat, directoryTruncationLength, directorySubstitutions, styleFor }`
where `styleFor(name)` builds the style expression for a palette colour — the
colour on its own in a normal prompt, or an `fg:fg bg:<colour>` pair under
powerline. Only modules that carry their colour in differently-named keys
(`username`/`hostname` → `style_user`/`style_root`, `battery` →
`[[battery.display]]`) need `styleFor`; the generator emits the plain `style` key
for everyone else.

### Lookup

```typescript
function getModule(id: string): ModuleDef | undefined;
```

```typescript
function placedModules(
  left: readonly ModuleId[],
  right: readonly ModuleId[]
): { left: ModuleId[]; right: ModuleId[] };
// The modules as the prompt places them: each once, and a module chosen for
// both sides only on the left. The generator, the preview and the state card
// all go through it.
```

The `MODULES` array is the single registry. All module-aware code reads from it, and `MODULE_DEFS` is checked with `satisfies Record<ConfigurableModuleId, …>` so a missing entry or a stray one is a compile error.

### Example Entry

```typescript
// MODULE_DEFS is keyed by id; MODULES adds `id` from the key.
git_branch: {
  label: 'Git Branch',
  description: 'Active git branch name',
  defaultLeft: true,
  defaultRight: false,
  previewSegment: (nf) => `${nf ? NERD_FONT_SYMBOLS.gitBranch : ''}main`,
  plainPreview: (nf) => `on ${nf ? NERD_FONT_SYMBOLS.gitBranch : ''}main`,
  content: '$symbol$branch',
  settings: ({ hasNerdFont }) =>
    `symbol = "${tomlBasic(hasNerdFont ? NERD_FONT_SYMBOLS.gitBranch : '')}"`,
}
```

---

## Preset Schema

**File**: `src/config/presets.ts`

### PresetDef

```typescript
interface PresetDef {
  id: string;
  label: string; // Display name
  description: string; // Shown below preset list
  requiresNerdFont: boolean; // Hidden if user has no Nerd Font
  leftModules: readonly ModuleId[]; // Left modules this preset selects
  rightModules: readonly ModuleId[]; // Right modules this preset selects
  palette: PaletteId; // Colour theme this preset starts from
  powerline: boolean; // Whether segments render as interlocking coloured blocks
  textOnly?: boolean; // Text symbols only, even with a Nerd Font
  bracketed?: boolean; // Wraps each segment in square brackets
}
```

12 presets defined. Presets with `requiresNerdFont: true` are filtered out in PresetScreen when `state.hasNerdFont` is `false`.

When a preset is selected, its `leftModules` and `rightModules` replace the current state (with `character` always appended to leftModules by SegmentsScreen), and its `palette` and `powerline` seed the Style screen's pickers — the user can still change both there. Every preset names a different palette, so no two presets generate the same colours.

---

## Shell Schema

**File**: `src/config/shells.ts`

### ShellDef

```typescript
interface ShellDef {
  id: ShellId;
  label: string;
  binary: string; // Executable on PATH — not always the id (nushell → 'nu')
  rcFile: string | null; // Absolute path, or null for manual-only shells
  initLine: string; // Starship init command for this shell
  manualNote?: string; // Instructions shown on DoneScreen
  initPath?: string; // Manual setup file used to detect an already-configured shell
  additionalInitPaths?: string[]; // Other required files from manual setup
  pathLine?: (dir: string) => string; // PATH addition in this shell's syntax, used when starship needs one
  adoptInitLine?: string; // Manual-only shells: the setup command in adopt mode
  configEnv?: ConfigEnvSyntax; // rc shells: how STARSHIP_CONFIG is exported and unset
}
```

### Shell Init Lines

| Shell      | RC File                      | Init Line                                                                                                                       |
| ---------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| zsh        | `~/.zshrc`                   | `eval "$(starship init zsh)"`                                                                                                   |
| bash       | `~/.bashrc`                  | `eval "$(starship init bash)"`                                                                                                  |
| fish       | `~/.config/fish/config.fish` | `starship init fish \| source`                                                                                                  |
| nushell    | `null` (manual)              | `nu -c '<quoted Nushell setup script>'` (Bash-compatible)                                                                       |
| powershell | `null` (manual)              | `$env:STARSHIP_CONFIG = '<config dir>/starship/powershell.toml'; Invoke-Expression (&starship init powershell)` (absolute path) |

Shells with `rcFile: null` are not wired through an RC file. Instead, `manualNote`
and the setup command are displayed on DoneScreen. Nushell's command can be run
from Bash; it invokes `nu` to execute the setup script.

For nushell the manual command writes two files into `$nu.data-dir/vendor/autoload`:
an `export-env` block (`starship-config.nu`) that pins `$env.STARSHIP_CONFIG` to the
shell's per-shell `starship/nushell.toml`, and the `starship init` output
(`starship.nu`). `$nu.data-dir` is `~/Library/Application Support/nushell` on
macOS and `$XDG_DATA_HOME/nushell` (default `~/.local/share/nushell`) elsewhere;
the pinned config path is the same `getShellConfigPath('nushell')` the generator
writes. Setup is detected only when both files exist. Nushell auto-sources
every file in that directory at startup, so
the prompt keeps using the per-shell config with no rc file involved.

### Lookup

```typescript
function getShell(id: ShellId): ShellDef | undefined;
```

---

## Generator Exports

### starship.ts

```typescript
function generateToml(state: WizardState): string;
```

Takes full wizard state, returns a complete `starship.toml` file as a string.

### shellRc.ts

```typescript
function getShellConfigPath(shellId: ShellId): string;
// Returns ~/.config/starship/<shell>.toml (honours $XDG_CONFIG_HOME)

function writeShellConfig(toml: string, shellId: ShellId): { path: string; backedUpTo?: string };
// Writes the TOML to the per-shell config path, backing up any existing
// file first. Never touches the shared ~/.config/starship.toml.

function writeSharedConfig(toml: string): { path: string; backedUpTo?: string };
// Adopt mode's one write: the shared ~/.config/starship.toml (e.g. a config
// fetched via --import-url), backing up anything already there.

function applyShellConfig(
  shellId: ShellId,
  opts?: { ensurePathDir?: string | null; pointAtSharedConfig?: boolean }
): { applied: boolean; note?: string };
// Appends the STARSHIP_CONFIG pin + init line to the shell's rc file, or — with
// pointAtSharedConfig (adopt mode) — the init line alone so the shell reads the
// shared ~/.config/starship.toml by default. Returns { applied: false, note }
// for manual-only shells or when already configured. First drops any stale block
// of the opposite mode (unset guard, adopt block, or per-shell export), so a
// re-run can repair a polluted rc file.

function appliedRcContent(
  shellId: ShellId,
  existing: string,
  opts?: ApplyShellConfigOptions,
  io?: RcIo
): { content: string; applied: boolean; note?: string } | null;
function resetRcContent(shellId: ShellId, existing: string, io?: RcIo): RcPlan | null;
// What applyShellConfig / resetSharedShellConfig make of the rc text `existing`,
// without writing: the writers call these and write `content` when it differs.
// The dry-run diff and ReviewScreen use them too, so a preview never drifts from
// the real write. Null for manual-only shells.

function resetSharedShellConfig(shellId: ShellId): { applied: boolean; note?: string };
// Removes a per-shell block an earlier run wrote (keeping its PATH line and the
// Starship init) and adds an unset guard above the init line, so the shell uses
// the shared config. A user's own STARSHIP_CONFIG export is left in place.

function hasManagedRcBlock(shellId: ShellId, io?: RcIo): boolean;
// Whether the shell's rc file carries a ShellConfigurator block (either marker).

function removeManagedRcBlocks(shellId: ShellId): RemovalResult;
// uninstall: backs up the rc, then drops every ShellConfigurator block. When the
// user's own starship init line remains, the PATH line a block carried is kept
// above it (for fish's conf.d init, at the end). { removed: false, note } when
// there was nothing to remove.

function startsStarship(shellId: ShellId, withoutManagedBlocks: boolean, io?: RcIo): boolean;
// Whether the shell starts Starship from its rc (ignoring ShellConfigurator's
// blocks when withoutManagedBlocks), fish's conf.d file, or a hand-applied
// Nushell/PowerShell setup. uninstall keeps Starship while any shell does.

function removeShellConfigFile(shellId: ShellId): RemovalResult;
// uninstall: renames ~/.config/starship/<shell>.toml to a .bak-* backup.
// RemovalResult = { removed: boolean; backedUpTo?: string; note?: string }
```

Config and rc file writes (per-shell, shared, and rc appends) go through a
temp-file-and-rename in the same directory, so a crash or interrupted run can
never leave a half-written file.

---

## Service Exports

### detector.ts

All detection is async — there are no sync counterparts, because every function
runs while the Ink render loop is live and must not block it.

```typescript
function detectPackageManagerAsync(): Promise<PackageManager>;
// Returns detected package manager or 'script' fallback

function isStarshipInstalledAsync(): Promise<{ installed: boolean; version?: string }>;
// Checks `starship -V`

function detectInstalledShellsAsync(): Promise<ShellId[]>;
// Returns shells found on PATH, one binary check per SHELLS entry

function detectTerminalAsync(): Promise<TerminalId | null>;
// Detects the terminal emulator the wizard runs in (alacritty | kitty | wezterm
// | ghostty | foot) from environment markers ($TERM_PROGRAM, $TERM,
// KITTY_WINDOW_ID, WEZTERM_PANE, …). null when unknown.

function detectCurrentShellAsync(): Promise<ShellId | null>;
// Best-effort detection of the shell the wizard runs in (for pre-selecting it
// on ShellScreen): $SHELL first, then the process command name. null when it
// cannot be mapped to a known shell.

function detectContainerAsync(): Promise<boolean>;
// True inside a container/CI sandbox: a truthy CODESPACES, REMOTE_CONTAINERS,
// DEVCONTAINER, CI, KUBERNETES_SERVICE_HOST or container env var, or a marker
// file (/.dockerenv, /run/.containerenv, /run/systemd/container).
// Fonts are per-host there and chsh is meaningless, so both tasks are skipped.
```

### installer.ts

```typescript
function installStarship(pm: PackageManager, signal?: AbortSignal): Promise<void>;
// Installs Starship via package manager or curl script

function installShell(shellId: ShellId, pm: PackageManager, signal?: AbortSignal): Promise<void>;
// Installs a shell via package manager. Throws if pm is 'script'.

function installNerdFont(fontId: string, signal?: AbortSignal): Promise<string | undefined>;
// Downloads the font zip from GitHub, verifies the archive's SHA-256 against the
// digest published in the release asset metadata (fails closed on mismatch,
// missing digest, or lookup failure), then extracts it to the platform-specific
// fonts directory. Extraction happens in a sandboxed worker (fontExtractor.ts)
// so malformed archives cannot crash the wizard. Resolves to a note string when
// the verified archive was served from the local font cache instead of the
// network, else undefined.
// macOS: ~/Library/Fonts (fc-cache skipped), Linux: ~/.local/share/fonts (runs fc-cache)

function setDefaultShell(shellId: ShellId, signal?: AbortSignal): Promise<void>;
// Runs chsh -s <binary_path>

function getNerdFontsDir(): string;
// Platform fonts directory: ~/Library/Fonts on darwin, ~/.local/share/fonts elsewhere

function getMissingStarshipPathDir(): string | null;
// The directory (~/.local/bin) that must be on PATH when the install script put
// the binary there and the shell can't reach it, or null when starship is already
// reachable.

function plannedStarshipRemoval(pm: PackageManager): Promise<StarshipRemoval>;
// How uninstall --starship would remove Starship: { kind: 'script', path } for the
// install script's ~/.local/bin binary, { kind: 'package', pm, command } when
// pacman (-Qqo) or apk (--who-owns) owns the binary on PATH, or its real path is
// inside the real path of `brew --prefix starship`,
// { kind: 'manual', path } for any other binary, { kind: 'absent' } when it is
// not installed.

function removeStarship(plan: StarshipRemoval, signal?: AbortSignal): Promise<void>;
// Deletes the script binary or runs the package manager's remove command.

function installedFontFiles(fontId: string): Promise<string[] | null>;
// The installed files of a Nerd Font, listed from its verified cached archive's
// entry headers (fontFileNames, nothing is decompressed); null when nothing is
// cached, so its files cannot be told apart.

function removeFontFiles(files: string[]): Promise<void>;
// Deletes the files, then refreshes fc-cache off macOS.
```

### uninstall.ts

```typescript
function planUninstall(options: UninstallOptions, deps?: UninstallDeps): Promise<UninstallStep[]>;
// Read-only plan in reverse install order: each shell's rc lines and per-shell
// config, then the font (options.fontId), then Starship (options.starship).
// options.shells defaults to every shell with an rc block or a config. A step
// without run() has nothing to do and its detail says why. The Starship step
// has no run() while a shell would still start Starship after the cleanup, and
// the font step names any terminal still set to the font.

function runUninstall(
  steps: UninstallStep[],
  opts?: { dryRun?: boolean }
): Promise<UninstallReport>;
// Runs each step; a failure does not stop the rest, but a step whose `after`
// step failed (a shell's config, after its rc) is skipped. Statuses: removed |
// skipped | failed | planned; a removal that made a backup carries
// backup: { file, backup }. ok is false when any step failed.

function formatUninstallReport(report: UninstallReport): string;
// The text report; --json prints the report object.
```

### runCapture.ts

```typescript
function trackedFiles(): string[];
// Every file a wizard run, apply or uninstall may change: each shell's rc and
// per-shell config, the shared starship.toml, and every terminal config
// wireTerminalFont may edit (terminalFontConfigFiles).

function captureRun<T>(
  files: string[],
  run: () => Promise<T>,
  options?: {
    onChanged?: (runId: string, files: RunFile[], error?: unknown) => void;
    rewritable?: readonly string[];
  }
): Promise<{ result: T; runId: string | null }>;
// Copies the files into <stateDir>/runs/<runId>/files before run(), then keeps
// only those the run changed in manifest.json ({ version, runId, files: [{ path,
// before: copy name | null, after: sha256 | null }] }). Best-effort: a capture
// that cannot be written never stops the run. runId is null then, and when the
// run changed nothing. Each run gets its own folder (created exclusively), and
// each file's mode is kept so a restore gets it back. A throwing run rejects
// with a CapturedRunError carrying its runId, which apply and the wizard still
// record. A capture that fails partway removes its folder; a file the run left
// unreadable is kept with after: 'unreadable' (UNREADABLE_AFTER); only the
// newest 50 run folders are kept (pruneRuns, KEPT_RUNS). Tests get a stub from
// setup.ts. onChanged runs once the run is over and changed files (also after a
// throw, with the error), before the manifest is written, so whatever it writes
// to a captured file is part of the run; its own errors are ignored. Files in
// rewritable are marked `rewritable: true`: rollback leaves such a file alone,
// without counting it as left, only when a later captured run wrote its current
// content (laterRunWrites). The manifest is written to a temp file and renamed.

function readRunManifest(runId: string): RunManifest | null;
function laterRunWrites(runId: string, file: string): Set<string | null>;
```

### rollback.ts

```typescript
function listRollbackRuns(records?: HistoryRecord[]): RollbackRun[];
// The recorded runs with a manifest, newest first, each marked rolledBack while
// a complete rollback of it stands (one that was not itself rolled back; a
// rollback recorded `partial` left some changes and does not count; one whose
// own capture failed, with no runId, counts and can never be undone).

function defaultRollbackRun(runs: RollbackRun[]): RollbackRun | null;
// The newest non-rollback run that still stands: what a plain `rollback` undoes.

function planRollback(manifest: RunManifest): RollbackStep[];
// Per file: put back the copy's exact bytes and mode, or delete a file the run
// created. A file whose hash no longer matches the run's `after` changed since,
// and is left alone (checked again right before each change); one already back
// to its copy needs nothing. A file whose copy cannot be read, or that the run
// left unreadable, is skipped and left in place; the other files still go.

function runRollback(
  runId: string,
  steps: RollbackStep[],
  opts?: { dryRun?: boolean }
): RollbackReport;
// Statuses: restored | removed | skipped | failed | planned. complete is false
// while a change of the run stays in place (left: true on that action).
```

### whatChanged.ts / listings.ts

```typescript
function writeWhatChangedSafely(run: WhatChangedRun): string | null;
// Called from the onChanged step of a wizard install's or apply's captureRun,
// so only for a run that changed files (a crashed apply too, with its unfinished
// tasks failed; the wizard skips it once its screen has unmounted): writes ~/.config/starship/WHAT-CHANGED.md (renderWhatChanged) listing the
// tasks and their outcome, the files the run changed (created/modified/removed,
// the files the capture step passes), each selected shell's Starship lines and config (the
// shared starship.toml in adopt mode), and the rollback/uninstall/doctor
// commands, with a note that a later uninstall or rollback may have undone it.
// The summary is a captured, rewritable file of that run, so rolling the run
// back puts the previous summary back; a later run rewriting it does not make
// an older run's rollback partial, while a hand edit does. A run that changed
// nothing leaves the last summary alone, and uninstall and rollback never touch
// it. Home is shown as ~, the recorded command has URL
// credentials and queries dropped (redactUrls), and the --font and --starship
// removal hints appear only when this run installed them. Returns the path, or null when it
// did not write (never throws). Tests get a stub from setup.ts.

function listEntries(kind: 'presets' | 'modules' | 'fonts'): ListEntry[];
// The ids --list-presets/--list-modules/--list-fonts print, with label,
// description and, for --json, the data a script needs (a preset's palette,
// powerline and modules; a module's default side; a font's family).
```

### cliSurface.ts / completions.ts

```typescript
const SUBCOMMAND_INFO: Record<Subcommand, SubcommandInfo>;
// Each subcommand's description and flags (FLAGS), and completions' positional
// shell argument. A test keeps FLAGS in step with the parser's KNOWN_FLAGS, so
// a new flag must be described here.

function completionScript(shell: 'bash' | 'zsh' | 'fish'): string;
// A completion script generated from SUBCOMMAND_INFO: subcommands, each one's
// flags, and flag values (preset, palette, shell, font and character ids, files;
// --shells completes a comma-separated list).
```

### starshipProbe.ts / share.ts

```typescript
function timePrompt(toml: string, path: string, deps?: ProbeDeps): Promise<TimingsReport>;
// Writes `toml` to a temporary folder and runs `starship timings --path <path>`
// against it (PWD = path, the real HOME), then parses the rows (parseTimings,
// slowest first) and suggests fixes (suggestFixes): a command that timed out
// raises command_timeout (at least 1000ms), a timed-out folder scan raises
// scan_timeout, and each module at or over SLOW_MODULE_MS (50) gets a fix
// (git_status/git_metrics: core.fsmonitor or disabling it; a language module
// that runs a version command: disabling it; directory: a slow drive). Modules
// run in parallel, so `slow` compares the slowest module with SLOW_PROMPT_MS
// (200). Rejects with StarshipMissingError without Starship.

function explainPromptAsync(state: WizardState, deps?: ProbeDeps): Promise<ExplainResult>;
// `starship explain` for the generated config in the preview's sample project:
// { mode: 'real', items: [{ output, description }] }, or { mode: 'unavailable',
// reason: 'starship-missing' | 'explain-failed' }. Never throws. Stubbed in
// setup.ts so no test runs Starship.

function renderShare(state: WizardState): string;
// Markdown for an issue, a gist or the Starship presets gallery: the generated
// starship.toml and a state card (serializeState of shareableState, which drops
// this machine's shells, font install and default shell) that rebuilds exactly
// that TOML with `apply --state prompt.json --shells <your shells>`.

function writeShareFile(state: WizardState, dir?: string): string;
// Writes renderShare to starship-prompt.md in `dir` (default: the current
// folder), or starship-prompt-2.md and so on, never over an existing file.
```

### debugInfo.ts

```typescript
function collectDebugInfo(version: string, deps?: DebugInfoDeps): Promise<DebugInfo>;
// Read-only: versions, OS and distro (PRETTY_NAME), package manager, container,
// terminal, locale, current shell, Starship (path, version, off-PATH dir,
// recorded version, STARSHIP_CONFIG), each shell's install/rc/init/block/config
// facts, the PATH entries (marking the one with starship), the last history
// record (URL credentials, queries and fragments in its command hidden) and the
// doctor report.

function formatDebugInfo(info: DebugInfo): string;
// The Markdown report; the home directory is shown as ~ (redactHome).
```

### fontExtractor.ts

```typescript
function extractFontFiles(zipBytes: Uint8Array): Promise<ExtractedFontFile[]>;
// Decompresses the archive in an isolated `eval` Worker and returns only the
// font-file entries, flattened to basenames: { name, bytes }. Never touches the
// filesystem — the caller (installNerdFont) does the writes. Rejects on invalid
// archives, worker crashes, or a ~60s timeout.

interface ExtractedFontFile {
  name: string; // basename only; any directory component from the unverified archive is stripped
  bytes: Uint8Array;
}
```

All install commands go through `runCommand` in `src/services/exec.ts`: an async
`spawn` with `stdio: 'inherit'` (so sudo prompts pass through), tty suspension
via `src/services/tty.ts` for the child's lifetime, an optional `AbortSignal` to
cancel in flight, and rejection on spawn error, signal kill, or non-zero exit.
The Ink render loop is never blocked — commands run through `runInstallTasks`,
not `spawnSync`.

### terminalFont.ts

Points the detected terminal at a Nerd Font family, editing its config file
idempotently. Backs up the existing file first; WezTerm's Lua config is never
edited, the exact line is returned as a note instead.

```typescript
type TerminalId = 'alacritty' | 'kitty' | 'wezterm' | 'ghostty' | 'foot';

const TERMINAL_LABELS: Record<TerminalId, string>;
// Human-readable names, for task labels and doctor output.

function wireTerminalFont(id: TerminalId, family: string): TerminalFontResult;
// Sets `family` in the terminal's config (alacritty [font.normal] in
// alacritty.toml, kitty font_family, ghostty font-family, foot font= under
// [main]), backing up any existing file; a missing config is created and
// reported as applied. Returns { applied, path, backedUpTo, note }.
// Applied=false signals "changed nothing": the font was already set, or the
// config cannot be edited and a note gives the manual step (WezTerm's Lua
// config, a legacy alacritty.yml, or an Alacritty older than 0.13 — the YAML
// file is never edited).

function readTerminalFontFamily(id: TerminalId): string | null;
// The family the terminal is configured to use, or null when unset/unknown.
```

### installTasks.ts

```typescript
function buildTaskList(state: WizardState, resetShells?: readonly ShellId[]): InstallTask[];
// Pure — builds the task queue (starship, font, terminal font, shells, chsh,
// config, rc, verify, then an unset-guard task per resetShells entry)

interface InstallTaskDeps {
  isStarshipInstalled: () => Promise<{ installed: boolean; version?: string }>;
  installStarship: (pm: PackageManager, signal?: AbortSignal) => Promise<void>;
  installNerdFont: (fontId: string, signal?: AbortSignal) => Promise<string | undefined>;
  installShell: (shellId: ShellId, pm: PackageManager, signal?: AbortSignal) => Promise<void>;
  setDefaultShell: (shellId: ShellId, signal?: AbortSignal) => Promise<void>;
  generateToml: (state: WizardState) => string;
  writeShellConfig: (toml: string, shellId: ShellId) => WriteConfigResult;
  writeSharedConfig: (toml: string) => WriteConfigResult;
  // One shared ~/.config/starship.toml written in adopt mode only.
  backupSharedConfig: () => string | null;
  // Snapshots the existing shared config to a .bak-* file (null when absent),
  // so --restore can bring it back.
  sharedConfigExists: () => boolean;
  applyShellConfig: (
    shellId: ShellId,
    options?: ApplyShellConfigOptions
  ) => {
    applied: boolean;
    note?: string;
  };
  resetSharedShellConfig: (shellId: ShellId) => { applied: boolean; note?: string };
  getShellsUsingStarship: () => Promise<ShellId[]>;
  // Installed shells whose rc already loads Starship, so could inherit a leaked
  // STARSHIP_CONFIG.
  getMissingStarshipPathDir: () => string | null;
  readStarshipVersion: (pathDir: string) => Promise<string | null>;
  // Reads the version of a script install that PATH does not reach yet.
  recordStarshipVersion: (version: string) => void;
  // Persists the version a fresh Starship install produced to the cache dir, so
  // the doctor can flag drift when a later package-manager update moves it.
  verifyConfig: (configPath: string, pathDir?: string | null) => Promise<void>;
  // Runs `starship print-config` against the written config; pathDir lets a
  // script install add its own bin dir to PATH before the binary resolves.
  wireTerminalFont: (terminalId: TerminalId, family: string) => TerminalFontResult;
  // Points the detected terminal's config at the installed Nerd Font. WezTerm's
  // Lua config is never edited — the exact line is returned as a note instead.
}

const DEFAULT_INSTALL_TASK_DEPS: InstallTaskDeps;
// Wires the real installer/generator/detector functions

function runInstallTasks(
  state: WizardState,
  deps: InstallTaskDeps,
  onUpdate: (id: string, patch: Partial<InstallTask>) => void,
  signal?: AbortSignal
): Promise<InstallTask[]>;
// Executes every task sequentially, reporting status changes via onUpdate and
// returning the final task list. Per-task failures don't halt the pipeline. An
// optional AbortSignal halts the chain at phase boundaries and marks every task
// that never ran as failed — never silently done.
```

---

## Headless CLI & Run Data

The public flag surface in `src/index.tsx`/`src/services/args.ts`, in ten groups.

### Interactive

```
shell-configurator              start the wizard
shell-configurator --dry-run    preview changes without installing (alias --no-install, -d)
```

### lifecycle

```
--restore / --undo    Copy the newest .bak-* backup over the shared and per-shell
                      configs created by earlier runs (see restoreConfigBackups);
                      after an uninstall it brings the configs back
--version / -v        Print the version
--help / -h           Print usage
```

### generate (a config from flags)

```
shell-configurator generate --preset <id> [flags]
  --palette <id>           override the colour palette
  --powerline/--no-powerline
  --shells <id,...>        zsh,bash,fish,nushell,powershell
  --font <none|id>         Nerd Font to install, or 'none'
  --has-nerd-font/--no-nerd-font
  --character <arrow|lambda|dollar>
  --set-default <shell>    chsh target
  --skip-starship          config-only run
  -o, --output <file>      write the TOML instead of stdout
  --export <file>          write the state card (add -o to keep the TOML too)
  --import, --state <file> start from a state card instead of flags
```

### apply (an install from a state card)

```
shell-configurator apply [--state <file>] [generate flags] [--dry-run [--json]] [--adopt] [--import-url <url>]
  --state       the state card to install (also: --import); without it, apply
                takes the generate flags above and --shells is required
  --adopt       keep the shared ~/.config/starship.toml (never writes per-shell files)
  --import-url  fetch a starship.toml and adopt it (implies --adopt; the fetch is
                bounded — a 10s timeout and a 1 MB cap reject a hung or oversized
                response. A non-http(s) URL is a usage error; an HTTP error, an
                empty or HTML body is a run error)
  --json        with --dry-run, print { dryRun, shells, installStarship, tasks,
                config, changes } instead of text; config is { kind: 'per-shell', toml,
                tomlIfFontFails? } (the glyph-free config written when a planned font
                install fails),
                { kind: 'imported', path, toml } or { kind: 'kept', path, exists }.
                A real apply with --json is a usage error
```

When the run installs a Nerd Font and the config would differ without it, the
text dry run and the Review screen add `If the Nerd Font install fails, the config
is written without Nerd Font glyphs instead.` (`configIfFontFails` in
`installTasks.ts`).

A dry run also diffs the config and rc files the run would write against what is
on disk (`plannedFileChanges` in `services/fileDiff.ts`), using the same planners
as the real writers. The text output ends with `Changes to config and rc files on
disk:` and a `git diff`-style unified diff per file (a last line without a newline
is marked `\ No newline at end of file`, as git does); a config the run creates is
not repeated there, only pointed at (`create <path>: the config shown above`).
Then a line notes that a real run also saves backups of the configs it replaces
and writes WHAT-CHANGED.md. With nothing to change it says `No config or rc file on
disk would change.` In `--json`, `changes` is a list of `{ path, status: 'create'
| 'modify', added, removed, diff }`, or `{ path, status: 'unreadable', error }`
for a file it cannot read; files that would stay as they are are left out.
Backups, WHAT-CHANGED.md, fonts, the Starship binary and terminal configs are not
part of it.

A real apply writes `~/.config/starship/WHAT-CHANGED.md` and ends with
`What changed, and how to undo it: <path>`; the wizard's Done screen shows the
same line.

### List flags

```
shell-configurator --list-presets | --list-modules | --list-fonts [--json]
```

Print the ids `--preset`, the module lists and `--font` accept, as aligned
`id  label — description` lines, or as JSON. They run without a subcommand, one
at a time, and only `--json` may go with them; any other flag is a usage error.

### doctor / repair (day-2 health)

```
shell-configurator doctor [--state <file>] [--json] [--fix [--include-warnings]]
shell-configurator repair [--state <file>] [--json] [--dry-run] [--include-warnings]
```

`doctor` is read-only and never installs. It checks Starship on `PATH`, a
UTF-8 locale, the `starship init` line and `STARSHIP_CONFIG` export in each
shell rc (or the shared config in adopt mode), that the configs load under the
real `starship print-config`, that a Nerd Font is installed, and that it is
selected in the detected terminal (`src/services/doctor.ts`). With `--state`
it checks the card's shells and wiring mode (`keepExistingConfig`); without
one it checks every installed shell and reads each one's mode (per-shell or
shared) from its rc. The locale, terminal-font and (without a card)
font-installed checks only ever warn; a font the card asked for that is missing
fails. Two further checks are also `warn`-only and read the runtime: **version drift** — the installed
starship binary no longer matches the version the last install/apply recorded,
which means a package-manager upgrade happened outside the tool — and the
**current shell** — the shell this terminal is _running_ is not one of the
configured ones, so the new prompt won't show until the user starts it. Each
finding is `pass`/`warn`/`fail`; any `fail` sets exit code `1`. `--json` prints
the report object.

`repair` (or `doctor --fix`) applies the fix each failing finding carries —
re-add the init line, reinstall Starship via the detected package manager,
rewrite a missing per-shell config from the `--state` card, reinstall the font
the card names (from the verified cache, else downloaded) — then re-runs the
doctor and reports the _result_. Warnings are left alone unless
`--include-warnings` is passed; that also applies the fixes warnings carry, such
as rewiring the terminal font or adding a missing `STARSHIP_CONFIG` export. The
font fixes exist only when a `--state` card names a font. `--dry-run` lists the
planned fixes without applying them. A check that still fails keeps the exit
code non-zero.

Flags may appear before or after the subcommand; when a flag is repeated, the
last one wins. Unknown or malformed flags (a bogus `--name`, an unparseable
value on a boolean flag, a missing value, a stray positional) throw a
`CliUsageError`, so a typo can never start the real installer. Config flags
passed to `doctor`/`repair` without `--state` are ignored with a stderr warning.

### uninstall

```
shell-configurator uninstall [--shells <id,...>] [--starship] [--font <id>] [--yes] [--dry-run] [--json]
```

Removes what the wizard set up, in reverse install order (`src/services/uninstall.ts`).
For each shell (by default every shell with a ShellConfigurator rc block or a
per-shell config) it backs up and strips every `# Added by ShellConfigurator`
block from the rc, and moves `~/.config/starship/<shell>.toml` to a `.bak-*`
backup. Nushell and PowerShell were set up by hand, so their step only names
the file to clean. `--font <id>` deletes that Nerd Font's files, listed from its
cached archive, and names any terminal still set to it. `--starship` deletes
the script install's binary, or removes the pacman/apk/Homebrew package when
that package manager owns the binary, and forgets the recorded version; it is
held back while any shell would still start Starship. A shell's config stays
when its rc could not be cleaned. A real run is captured like any other, so
the text report ends with `Undo it with: shell-configurator rollback` (or, when
the capture could not be written, the `cp` commands that copy each backup
back). Rollback only puts files back, so when Starship or a font was removed the
report adds that they need reinstalling with `apply` or `repair`. The Starship
step re-checks just before it deletes anything that no shell still starts it.
Without
`--yes` it prints the plan and asks on a terminal; off a terminal, or with
`--json`, a run that would change something is a `CliUsageError`. `--dry-run`
only prints the plan. A failed step does not stop the rest and sets exit code
`1`. Config flags other than `--shells` and `--font`, and `--state`, are usage
errors, as are `--yes` and `--starship` outside `uninstall`.

### rollback

```
shell-configurator rollback [--run <id>] [--yes] [--dry-run] [--json]
shell-configurator rollback --list [--json]
```

Puts back the files a captured run changed (`src/services/rollback.ts`): by
default the newest install, apply or uninstall that still stands, otherwise the
run `--run` names (an id from `--list`). Each file goes back to its copy from
before that run, or is deleted when that run created it. A file that changed
again since is skipped (checked again right before it is changed, so an edit
made at the prompt survives), so a rollback never overwrites a later edit: roll
back the later run first. Restores keep the exact bytes and the file's mode. A
rollback that left some changes in place is recorded `partial: true`, and that
run stays next to roll back; files already restored then report "already as it
was before that run". The rollback is captured and recorded (`kind: 'rollback'`,
`rollbackOf`), so a second `rollback` undoes the run before, and
`rollback --run <rollback id>` redoes the run it undid. It asks like
`uninstall` (`--yes` off a terminal or with `--json`). A file it could not put
back sets exit code `1`. Config flags, `--state` and `--fix` are usage errors,
as are `--list` and `--run` outside `rollback`.

### debug-info

```
shell-configurator debug-info [--json]
```

Prints a Markdown report of the setup for a bug report
(`src/services/debugInfo.ts`): versions, detection, Starship, a table of the
shells, the PATH entries and the full doctor report, plus the last recorded run.
`--json` prints the same data as JSON. The home directory is shown as `~` in
both, and URL credentials, queries and fragments are dropped from the recorded
command. It reads only, so a failing doctor check does not change its exit
code. Config flags, `--state`, `--fix` and `--dry-run` are usage errors.

### completions

```
shell-configurator completions <bash|zsh|fish>
```

Prints a completion script for the shell (`src/services/completions.ts`). It
is the only subcommand that takes a positional argument. A missing or unknown
shell, or any other flag, is a usage error. `--help` shows where each shell
loads the script from: `~/.local/share/bash-completion/completions/`, the
first `$fpath` directory as `_shell-configurator`, and
`~/.config/fish/completions/`.

### timings

```
shell-configurator timings [--config <file> | generate flags] [--json]
```

Times each module of a config in the current folder with `starship timings`
and prints them slowest first, how long the prompt waits for its slowest module,
and suggestions with the TOML to add (`timePrompt` in
`src/services/starshipProbe.ts`). `--config` times an existing file; without it
the config is built from the generate flags (`--preset`, `--palette`,
`--state`, ...), and the two cannot be combined. `--json` prints `{ config,
path, slowestMs, slow, modules: [{ module, ms, output }], suggestions: [{ module?,
text, toml? }] }`. It reads only. Without Starship it is a run error; `--shells`,
`--yes` and other flags are usage errors.

### share

```
shell-configurator share [generate flags] [-o <file>]
```

Prints the prompt the generate flags (or `--state`) build as Markdown: its
`starship.toml` and the state card that rebuilds it (`renderShare` in
`src/services/share.ts`). `-o` writes it to a file instead. The card leaves out
this machine's shells, font install and default shell. `--shells`, `--json` and
other flags are usage errors.

### Exit Codes

| Code | Meaning                                                                                                                                                                                                                                                                                                                                       |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Success.                                                                                                                                                                                                                                                                                                                                      |
| `1`  | A wizard install finished with at least one failed task, a headless run failed (`CliRunError`, e.g. a failed `--import-url` fetch or an unwritable `-o`/`--export`), a `doctor`/`repair` check still fails, an `uninstall` step failed, a `rollback` could not put a file back, a `--restore` copy failed, or any fatal crash.                |
| `2`  | `CliUsageError` — an unknown or malformed flag, an invalid flag value, `--adopt`/`--import-url` with `generate` or no subcommand, config flags without a subcommand, `uninstall` or `rollback` without `--yes` off a terminal or with `--json`, an unknown `rollback --run` id, or an unreadable state card; reads clean with no stack trace. |

### Persisted Run Data

All of it lives under XDG dirs resolved by `src/services/paths.ts`, so the
tarball stays self-contained and nothing is written next to the binary:

| Path                                                                                | Contents                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `$XDG_STATE_HOME` or `~/.local/state`/`shell-configurator/history.jsonl`            | Append-only ledger; one JSON `HistoryRecord` per run (`install`/`apply`/`uninstall`/`rollback`; `runId` names its captured files, `rollbackOf` the run a rollback undid), in file order = chronological order.                                           |
| `…/runs/<runId>/manifest.json` + `files/<n>`                                        | The files a run changed: a copy of each from before the run (`0600`, in a `0700` folder) and its hash after. Only the newest 50 runs are kept. `rollback` reads it.                                                                                      |
| `…/snapshots/<iso-timestamp>.json`                                                  | The versioned state card each wizard install or headless `apply` applied; the id is the ISO timestamp with `:` replaced by `-`. The ledger's `snapshotId` points at it, and `--restore` reads the newest one to learn which shells the last run touched. |
| `$XDG_CACHE_HOME` or `~/.cache`/`shell-configurator/fonts/<id>.zip` + `<id>.sha256` | Font cache: the verified archive plus its pinned SHA-256 pin file. A cached archive is reused offline only while its bytes still match the pin.                                                                                                          |
| `$XDG_CACHE_HOME` or `~/.cache`/`shell-configurator/starship.version`               | The starship version recorded by the last run that freshly installed Starship (`recordStarshipVersion`). Feeds the doctor's `version-drift` check.                                                                                                       |

### State Card (`serializeState` / `parseState` in `src/services/state.ts`)

`STATE_VERSION = 1`. A card captures only what the user decided — never wizard
runtime (step, detection results, task state) — so the same card produces the
same prompt on any machine. It is what `--export`, `--import`/`--state`, and
every snapshot use.

```typescript
{
  version: 1,
  wizard: {
    preset: string | null;
    leftModules: ModuleId[];
    rightModules: ModuleId[];
    characterSymbol: CharacterSymbol;
    palette: PaletteId;
    powerline: boolean;
    continuationPrompt: ContinuationPrompt;
    addNewline: boolean;
    vimMode: boolean;
    directoryTruncationLength: number;
    directorySubstitutions: DirectorySubstitution[];
    selectedShells: ShellId[];
    nerdFontToInstall: NerdFontChoice;
    setDefaultShell: ShellId | null;
    skipStarshipInstall: boolean;
    keepExistingConfig: boolean;
    hasNerdFont: boolean;
  }
}
```

`parseState` starts a parsed card from runtime defaults (`step: 'welcome'`,
detection-based fields cleared) and re-detects per run.

### Backup/Restore

`backupSharedConfig()` copies the existing shared config to
`<file>.bak-<timestamp>` (reusing the newest backup when it is identical) inside
the Config task: before per-shell configs shadow it, or before adopt mode points
shells at it (an `--import-url` overwrite is backed up by `writeSharedConfig`
itself). `restoreConfigBackups()` copies the newest `.bak-*` files back over the
shared and per-shell configs (`--restore`). `uninstall` backs up each rc file
before editing it and moves per-shell configs to `.bak-*` backups, and prints
points at `rollback` to undo it; `--restore` would also roll the shared config
back, so it is not the uninstall undo.

---

## Extensibility Guide

### Adding a Module

1. **`src/config/modules.ts`** — add the id to `ConfigurableModuleId` and an
   entry to `MODULE_DEFS`. Every module needs `label`, `description`,
   `defaultLeft`/`defaultRight`, `previewSegment`, and `content` (the format the
   powerline generator wraps in separators); most also provide `settings`:

   ```typescript
   perl: {
     label: 'Perl',
     description: 'Perl version (shown in Perl projects)',
     defaultLeft: false,
     defaultRight: false,
     ...symbolModule(() => '🐪 ', '5.38'), // previewSegment + settings
     content: '$symbol$version',
   },
   ```
2. **`src/config/palettes.ts`** — add a colour. `PaletteColorName` is keyed on
   `ConfigurableModuleId`, so every palette is a compile error until it picks a
   colour for the new module — this is deliberate. No other step: the generator
   emits the `[section]`, `style`, and powerline `format` keys itself.
3. **`src/components/PromptPreview.tsx`** — nothing to do. The preview reads
   `previewSegment()` from the same definition.

### Adding a Preset

**`src/config/presets.ts`** — add entry to `PRESETS` array with a `palette` and
`powerline` setting (name a palette no other preset uses, adding one first if
needed, so the preset renders differently):

```typescript
{
  id: 'minimal-monochrome',
  label: 'Minimal Monochrome',
  description: 'Single-color prompt, no icons',
  requiresNerdFont: false,
  leftModules: ['directory', 'git_branch', 'character'],
  rightModules: [],
  palette: 'monochrome', // a new palette; 'mono' already belongs to plain-text
  powerline: false,
}
```

PresetScreen reads from the `PRESETS` array directly. The golden test
(`src/__tests__/generators/golden.test.ts`) covers every preset, so run
`npx vitest run src/__tests__/generators/golden.test.ts -u` once to commit the
new fixture(s) under `src/__tests__/golden/`.

### Adding a Shell

1. **`src/types.ts`** — add to `ShellId` union
2. **`src/config/shells.ts`** — add to `SHELLS` array with `binary`, `rcFile`,
   `initLine`, and optional `manualNote`/`pathLine`. Shells without a script rc
   file (nushell, powershell) use `rcFile: null` and get a manual `initLine` shown
   on DoneScreen
3. **`src/services/installer.ts`** — add package name mappings to
   `SHELL_PACKAGES` (per package manager) for auto-install support
4. **`src/generators/shellRc.ts`** — add the shell's `starship init` command to
   `INIT_COMMAND`; an rc shell also needs a `configEnv` (export/unset syntax) in
   `SHELLS`
5. **`src/index.tsx`** — add it to the hard-coded `--shells` list in the `--help` text
6. **`src/services/detector.ts`** — no change needed: `detectInstalledShellsAsync`
   iterates `SHELLS` and checks each `binary`

### Adding a Palette

1. **`src/config/palettes.ts`** — add an entry to `PALETTE_DEFS` with a colour for
   every `PaletteColorName`. That is the only step: `PaletteId`, the `PALETTES`
   list, the StyleScreen picker, and the generated `[palettes.<id>]` table are all
   derived from it.

### Adding a Character Symbol

1. **`src/types.ts`** — add to `CharacterSymbol` union
2. **`src/config/promptSymbols.ts`** — add to `CHARACTER_SYMBOLS`, the single
   table the generator and the preview both read
3. **`src/screens/StyleScreen.tsx`** — add to `CHAR_OPTIONS` array
4. **`src/services/headless.ts`** and **`src/services/state.ts`** — add to their
   accepted-symbol lists, and to the `--character` line in the `--help` text
   (`src/index.tsx`)
