# Service exports

## detector.ts

All detection is async — there are no sync counterparts, because every function
runs while the Ink render loop is live. When `starship` is not on PATH,
`findStarshipAsync` only checks for the binary in the script-install bin dir.
The preview and the Review screen still call `getMissingStarshipPathDir`,
which runs one short sync `command -v starship`.

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

## installer.ts

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

## uninstall.ts

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
  opts?: { dryRun?: boolean; keepConfigs?: boolean }
): Promise<UninstallReport>;
// Runs each step; a failure does not stop the rest, but a step whose `after`
// step failed (a shell's config, after its rc) is skipped. With keepConfigs
// (set when rollback could not record the run) per-shell configs stay. Statuses: removed |
// skipped | failed | planned. ok is false when any step failed.

function formatUninstallReport(report: UninstallReport): string;
// The text report; --json prints the report object.
```

## runCapture.ts

```typescript
function trackedFiles(): string[];
// Every file a wizard run, apply or uninstall may change: each shell's rc and
// per-shell config, the shared starship.toml, and every terminal config
// wireTerminalFont may edit (terminalFontConfigFiles), plus the
// .pre-shell-configurator copy each may get, so rolling back the run that made
// a copy deletes it.

function captureRun<T>(
  files: string[],
  run: (uncaptured: boolean) => Promise<T>,
  options?: {
    onChanged?: (runId: string, files: RunFile[], error?: unknown) => void;
    rewritable?: readonly string[];
  }
): Promise<{ result: T; runId: string | null; uncaptured: boolean }>;
// uncaptured is true when the run could not be recorded, whether the capture
// failed to start or to write its manifest at the end; runId alone is also null
// for a run that changed nothing.
// Copies the files into <stateDir>/runs/<runId>/files before run(), then keeps
// only those the run changed in manifest.json ({ version, runId, files: [{ path,
// before: copy name | null, after: sha256 | null }] }). Best-effort: a capture
// that cannot be written never stops the run; run() is told (uncaptured) so it
// can hold back what nothing could bring back. runId is null then, and when the
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

## rollback.ts

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

## whatChanged.ts / listings.ts

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
// The ids `list presets|modules|fonts` prints, with label,
// description and, for --json, the data a script needs (a preset's palette,
// powerline and modules; whether a module is on the default left or right
// side, read from DEFAULT_STATE; a font's family).
```

## cliSurface.ts / completions.ts

```typescript
const SUBCOMMAND_INFO: Record<Subcommand, SubcommandInfo>;
// Each subcommand's description and flags (FLAGS), and the positional argument
// of completions (a shell) and list (what to list), with the values it takes. A test keeps FLAGS in step with the parser's KNOWN_FLAGS, so
// a new flag must be described here.

function completionScript(shell: 'bash' | 'zsh' | 'fish'): string;
// A completion script generated from SUBCOMMAND_INFO: subcommands, each one's
// flags, and flag values (preset, palette, shell, font and character ids, files;
// --shells completes a comma-separated list).
```

## starshipProbe.ts / share.ts

```typescript
function timePrompt(
  config: { toml: string; path?: string },
  folder: string,
  deps?: ProbeDeps,
  scratchDeps?: Pick<ScratchDeps, 'createScratch' | 'writeConfig' | 'cleanup'>
): Promise<TimingsReport>;
// Times `config.path` when it is given; otherwise writes `config.toml` to a
// temporary folder and times that. Runs `starship timings --path <folder>`
// (PWD = folder, the real HOME), then parses the rows (parseTimings,
// slowest first) and suggests fixes (suggestFixes): a command that timed out
// raises command_timeout (at least 1000ms), a timed-out folder scan raises
// scan_timeout, and each module at or over SLOW_MODULE_MS (50) gets a fix
// (git_status/git_metrics: core.fsmonitor or disabling it; a language module
// that runs a version command: disabling it; directory: a slow drive). Modules
// run in parallel, so `slow` compares the slowest module with SLOW_PROMPT_MS
// (200). `character`, `line_break` and `fill` never get a fix, and a module
// that ran into the timeout gets only the command_timeout advice (git_status,
// git_metrics and directory keep theirs). An existing config is timed where it
// is, Starship's defaults through the missing path itself, and a TOML without a
// path goes to a scratch folder (ScratchDeps). `doctor --timings` always times
// a file: --config, else the config Starship loads in the current folder. Escapes are stripped with
// node:util's stripVTControlCharacters; brackets in strings and comments do not
// count when the top-level timeouts are read. The config's own
// command_timeout/scan_timeout are read from its top level (past multi-line
// strings, with `_` digit separators). Rejects with StarshipMissingError without
// Starship, and with StarshipTimedOutError when Starship is killed after 30s.

function explainPromptAsync(state: WizardState, deps?: ProbeDeps): Promise<ExplainResult>;
// `starship explain` for the generated config in the preview's sample project:
// { mode: 'real', items: [{ output, description }] }, or { mode: 'unavailable',
// reason: 'starship-missing' | 'explain-failed' }. Never throws. Stubbed in
// setup.ts so no test runs Starship.

function renderShare(state: WizardState): string;
// `generate --markdown` and the Done screen's `s`. Markdown for an issue, a
// gist or the Starship presets gallery: the generated
// starship.toml and a state card (serializeState of shareableState, which drops
// this machine's shells, font install and default shell) that rebuilds exactly
// that TOML with `apply --state prompt.json --shells <your shells>`. The home
// folder is shown as `~` (redactHome), and the Markdown says so when it was;
// with directory substitutions it also says to check those paths before posting.

function withPreviewProject<T>(state, deps: ScratchDeps, run): Promise<T>;
// preview.ts: a scratch folder with the generated config and the sample project
// for `run`, removed afterwards; renderPromptAsync and explainPromptAsync use it.

function writeShareFile(state: WizardState, dir?: string): string;
// The Done screen's `s`: writes renderShare to starship-prompt.md in `dir` (default: the current
// folder), or starship-prompt-2.md and so on, never over an existing file.
```

## debugInfo.ts

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

## fontExtractor.ts

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

## terminalFont.ts

Points the detected terminal at a Nerd Font family, editing its config file
idempotently. Keeps the user's original first (`keepOriginal`, once per file);
WezTerm's Lua config is never
edited, the exact line is returned as a note instead.

```typescript
type TerminalId = 'alacritty' | 'kitty' | 'wezterm' | 'ghostty' | 'foot';

const TERMINAL_LABELS: Record<TerminalId, string>;
// Human-readable names, for task labels and doctor output.

function wireTerminalFont(id: TerminalId, family: string): TerminalFontResult;
// Sets `family` in the terminal's config (alacritty [font.normal] in
// alacritty.toml, kitty font_family, ghostty font-family, foot font= under
// [main]), keeping a .pre-shell-configurator copy of an existing file the
// first time; a missing config is created and reported as applied. Returns
// { applied, path, note }.
// Applied=false signals "changed nothing": the font was already set, or the
// config cannot be edited and a note gives the manual step (WezTerm's Lua
// config, a legacy alacritty.yml, or an Alacritty older than 0.13 — the YAML
// file is never edited).

function readTerminalFontFamily(id: TerminalId): string | null;
// The family the terminal is configured to use, or null when unset/unknown.
```

## installTasks.ts

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
