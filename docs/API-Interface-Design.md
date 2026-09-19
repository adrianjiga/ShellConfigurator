# API & Interface Design

## Core Types

**File**: `src/types.ts`

### Enums

```typescript
type ShellId = 'zsh' | 'bash' | 'fish' | 'nushell' | 'powershell';
type CharacterSymbol = 'arrow' | 'lambda' | 'dollar';
type PackageManager = 'pacman' | 'apt' | 'dnf' | 'brew' | 'apk' | 'script';
type InstallStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

type WizardStep =
  | 'welcome'
  | 'fontcheck'
  | 'font_select'
  | 'preset'
  | 'segments_left'
  | 'segments_right'
  | 'style'
  | 'shells'
  | 'review'
  | 'installing'
  | 'done';
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
  selectedShells: ShellId[]; // Shells to configure
  packageManager: PackageManager; // Detected package manager
  installedShells: ShellId[]; // Shells already on system
  nerdFontToInstall: NerdFontChoice; // {kind:'none'|'select'|'install',id}
  setDefaultShell: ShellId | null; // Shell to set via chsh
  skipStarshipInstall: boolean; // "Continue without Starship" — skips install + RC steps
  keepExistingConfig: boolean; // Adopt mode: keep the shared starship.toml as-is
  sharedConfigToml: string | null; // Imported shared config (--import-url); runtime-only, never serialized
  dryRun: boolean; // No install or config-write happens — the wizard only previews
  installResults: InstallTask[]; // Final task statuses from InstallingScreen
}
```

### InstallTask

Tracks individual installation task state in InstallingScreen:

```typescript
interface InstallTask {
  id: string; // Unique task identifier
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
const STEP_ORDER: WizardStep[];
// welcome → fontcheck → font_select → preset → segments_left → segments_right → style → shells → review → installing → done
```

### Step Machine

**File**: `src/stepMachine.ts`

```typescript
function getNextStep(state: WizardState, update?: Partial<WizardState>): WizardState;
// Merges update, advances to the next step, skipping font_select when not wanted.
// Returns the original state unchanged if there is no next step.

function getPrevStep(state: WizardState): WizardState;
// Moves back a step, skipping font_select when it was never intended.
// Returns the original state unchanged if there is no previous step.
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
  | 'character';
```

16 built-in modules.

### ModuleDef

```typescript
interface ModuleDef {
  id: ConfigurableModuleId;
  label: string; // Display name in UI
  description: string; // Shown when module is focused
  defaultLeft: boolean; // Included in left prompt by default
  defaultRight: boolean; // Included in right prompt by default
  previewSegment: (hasNerdFont: boolean) => string; // Text for PromptPreview
  content: string; // Inner format, e.g. '$symbol$version' — what powerline wraps in separators
  settings?: (ctx: ModuleTomlContext) => string; // TOML keys other than style/format
  stylesItself?: boolean; // Module carries its colour in keys other than `style`
}
```

`Id` is typed as `ConfigurableModuleId` (the 15 placeable modules); `character`
is not placeable and so has no entry — it gets special placement on its own line
and is configured on the Style screen instead.

`ModuleTomlContext` hands each `settings` builder `{ hasNerdFont, styleFor }`
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

The `MODULES` array is the single registry. All module-aware code reads from it, and `MODULE_DEFS` is checked with `satisfies Record<ConfigurableModuleId, …>` so a missing entry or a stray one is a compile error.

### Example Entry

```typescript
{
  id: 'git_branch',
  label: 'Git Branch',
  description: 'Active git branch name',
  defaultLeft: true,
  defaultRight: false,
  previewSegment: (nf) => `${nf ? ' ' : 'on '}main`,
  content: '$symbol$branch',
  settings: ({ hasNerdFont }) =>
    `symbol = "${hasNerdFont ? ' ' : 'on '}"`,
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
  leftModules?: ModuleId[]; // Overrides default left modules
  rightModules?: ModuleId[]; // Overrides default right modules
  palette: PaletteId; // Colour theme this preset starts from
  powerline: boolean; // Whether segments render as interlocking coloured blocks
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
  pathLine?: (dir: string) => string; // PATH addition in this shell's syntax, used when starship needs one
}
```

### Shell Init Lines

| Shell      | RC File                      | Init Line                                                                                           |
| ---------- | ---------------------------- | --------------------------------------------------------------------------------------------------- |
| zsh        | `~/.zshrc`                   | `eval "$(starship init zsh)"`                                                                       |
| bash       | `~/.bashrc`                  | `eval "$(starship init bash)"`                                                                      |
| fish       | `~/.config/fish/config.fish` | `starship init fish \| source`                                                                      |
| nushell    | `null` (manual)              | `mkdir ...; $"export-env { $env.STARSHIP_CONFIG = ... }" \| save ...; starship init nu \| save ...` |
| powershell | `null` (manual)              | `Invoke-Expression (&starship init powershell)`                                                     |

Shells with `rcFile: null` are not auto-configured. Instead, `manualNote` is displayed on DoneScreen.

For nushell the manual command writes two files into `$nu.data-dir/vendor/autoload`:
an `export-env` block (`starship-config.nu`) that pins `$env.STARSHIP_CONFIG` to the
shell's per-shell `starship/nushell.toml`, and the `starship init` output
(`starship.nu`). Nushell auto-sources every file in that directory at startup, so
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

function resetSharedShellConfig(shellId: ShellId): { applied: boolean; note?: string };
// Removes any per-shell wiring and appends an unset guard so the shell
// falls back to the shared ~/.config/starship.toml instead of inheriting
// a leaked STARSHIP_CONFIG. The mirror image of applyShellConfig.
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
// Checks `starship --version`

function detectInstalledShellsAsync(): Promise<ShellId[]>;
// Returns shells found on PATH, one binary check per SHELLS entry

function detectCurrentShellAsync(): Promise<ShellId | null>;
// Best-effort detection of the shell the wizard runs in (for pre-selecting it
// on ShellScreen): $SHELL first, then the process command name. null when it
// cannot be mapped to a known shell.
```

### installer.ts

```typescript
function installStarship(pm: PackageManager): Promise<void>;
// Installs Starship via package manager or curl script

function installShell(shellId: ShellId, pm: PackageManager): Promise<void>;
// Installs a shell via package manager. Throws if pm is 'script'.

function installNerdFont(fontId: string): Promise<string | undefined>;
// Downloads the font zip from GitHub, verifies the archive's SHA-256 against the
// digest published in the release asset metadata (fails closed on mismatch,
// missing digest, or lookup failure), then extracts it to the platform-specific
// fonts directory. Extraction happens in a sandboxed worker (fontExtractor.ts)
// so malformed archives cannot crash the wizard. Resolves to a note string when
// the verified archive was served from the local font cache instead of the
// network, else undefined.
// macOS: ~/Library/Fonts (fc-cache skipped), Linux: ~/.local/share/fonts (runs fc-cache)

function setDefaultShell(shellId: ShellId): Promise<void>;
// Runs chsh -s <binary_path>

function getNerdFontsDir(): string;
// Platform fonts directory: ~/Library/Fonts on darwin, ~/.local/share/fonts elsewhere

function getMissingStarshipPathDir(): string | null;
// The directory (~/.local/bin) that must be on PATH when the install script put
// the binary there and the shell can't reach it, or null when starship is already
// reachable.
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

### installTasks.ts

```typescript
function buildTaskList(state: WizardState): InstallTask[];
// Pure — builds the task queue (starship, font, shells, chsh, config, rc)

interface InstallTaskDeps {
  isStarshipInstalled: () => Promise<{ installed: boolean; version?: string }>;
  installStarship: (pm: PackageManager) => Promise<void>;
  installNerdFont: (fontId: string) => Promise<string | undefined>;
  installShell: (shellId: ShellId, pm: PackageManager) => Promise<void>;
  setDefaultShell: (shellId: ShellId) => Promise<void>;
  generateToml: (state: WizardState) => string;
  writeShellConfig: (toml: string, shellId: ShellId) => WriteConfigResult;
  writeSharedConfig: (toml: string) => WriteConfigResult;
  // One shared ~/.config/starship.toml written in adopt mode only.
  backupSharedConfig: () => string | null;
  // Snapshots the existing shared config to a .bak-* file (null when absent),
  // so --restore can bring it back.
  applyShellConfig: (
    shellId: ShellId,
    options?: { ensurePathDir?: string | null; pointAtSharedConfig?: boolean }
  ) => {
    applied: boolean;
    note?: string;
  };
  resetSharedShellConfig: (shellId: ShellId) => { applied: boolean; note?: string };
  getShellsUsingStarship: () => Promise<ShellId[]>;
  // Shells that run Starship and could inherit a leaked STARSHIP_CONFIG.
  getMissingStarshipPathDir: () => string | null;
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

The public flag surface in `src/index.tsx`/`src/services/args.ts`, in four groups.

### Interactive

```
shell-configurator              start the wizard
shell-configurator --dry-run    preview changes without installing (alias --no-install, -d)
```

### lifecycle

```
--restore / --undo    Copy the newest .bak-* backup over the shared and per-shell
                      configs created by earlier runs (see restoreConfigBackups)
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
  -o <file>                write the TOML instead of stdout
  --export <file>          write the state card (add -o to keep the TOML too)
  --import <file>          start from a state card instead of flags
```

### apply (an install from a state card)

```
shell-configurator apply --state <file> [--dry-run] [--adopt] [--import-url <url>]
  --adopt       keep the shared ~/.config/starship.toml (never writes per-shell files)
  --import-url  fetch a starship.toml and adopt it (implies --adopt; the fetch is
                bounded — a 10s timeout and a 1 MB cap reject a hung or oversized
                response, and a non-http(s) URL, HTTP error, or empty body is a
                usage error)
```

### doctor / repair (day-2 health)

```
shell-configurator doctor [--state <file>] [--json] [--fix]
shell-configurator repair [--state <file>] [--json]
```

`doctor` is read-only and never installs. It checks Starship on `PATH`, a
UTF-8 locale, the `starship init` line and `STARSHIP_CONFIG` export in each
shell rc (or the shared config in adopt mode), that the configs load under the
real `starship print-config`, that a Nerd Font is installed, and that it is
selected in the detected terminal (`src/services/doctor.ts`). Each finding is
`pass`/`warn`/`fail`; any `fail` sets exit code `1`. `--json` prints the report
object.

`repair` (or `doctor --fix`) applies the fix each failing finding carries —
re-add the init line, reinstall Starship via the detected package manager,
reinstall the font from cache, rewire the terminal font — then re-runs the
doctor and reports the *result*. A check that still fails keeps the exit code
non-zero.

Flags may appear before or after the subcommand; when a flag is repeated, the
last one wins. Unknown or malformed flags (a bogus `--name`, a value on a
boolean flag, a missing value) are collected as `warnings` on `CliFlags`,
printed to stderr, and ignored — they never abort the run.

### Exit Codes

| Code | Meaning                                                                 |
| ---- | ----------------------------------------------------------------------- |
| `0`  | Success.                                                               |
| `1`  | A wizard install finished with at least one failed task, a headless run failed, or a `doctor`/`repair` check still fails (also any fatal crash). |
| `2`  | `CliUsageError` — an invalid flag value, `--adopt`/`--import-url` outside `apply`, or an unreadable state card; reads clean with no stack trace. |

### Persisted Run Data

All of it lives under XDG dirs resolved by `src/services/paths.ts`, so the
tarball stays self-contained and nothing is written next to the binary:

| Path                                          | Contents                                                                |
| --------------------------------------------- | ----------------------------------------------------------------------- |
| `$XDG_STATE_HOME` or `~/.local/state`/`shell-configurator/history.jsonl` | Append-only ledger; one JSON `HistoryRecord` per run (`install`/`apply`/…), in file order = chronological order. |
| `…/snapshots/<iso-timestamp>.json`            | The versioned state card each run applied. The `snapshotId` field in the ledger is the rollback handle that `uninstall`/rollback resolves. |
| `$XDG_CACHE_HOME` or `~/.cache`/`shell-configurator/fonts/<id>.zip` + `<id>.sha256` | Font cache: the verified archive plus its pinned SHA-256 pin file. A cached archive is reused offline only while its bytes still match the pin. |

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

`backupSharedConfig()` copies the existing shared config to `<dir>.bak-<timestamp>`
before an adopt run overwrites it; `restoreConfigBackups()` copies the newest
`.bak-*` files back over the shared and per-shell configs (`--restore`).

---

## Extensibility Guide

### Adding a Module

1. **`src/config/modules.ts`** — add the id to `ConfigurableModuleId` and an
   entry to `MODULE_DEFS`. Every module needs `label`, `description`,
   `defaultLeft`/`defaultRight`, `previewSegment`, and `content` (the format the
   powerline generator wraps in separators); most also provide `settings`:
   ```typescript
   {
     id: 'lua',
     label: 'Lua',
     description: 'Lua version',
     defaultLeft: false,
     defaultRight: false,
     previewSegment: (nf) => `${nf ? '🌙 ' : 'lua '}5.4.0`,
     content: '$symbol$version',
     settings: ({ hasNerdFont }) =>
       `symbol   = "${hasNerdFont ? '🌙 ' : 'lua '}"
        disabled = false`.trim(),
   }
   ```
2. **`src/config/palettes.ts`** — add a colour. `PaletteColorName` is keyed on
   `ConfigurableModuleId`, so every palette is a compile error until it picks a
   colour for the new module — this is deliberate. No other step: the generator
   emits the `[section]`, `style`, and powerline `format` keys itself.
3. **`src/components/PromptPreview.tsx`** — nothing to do. The preview reads
   `previewSegment()` from the same definition.

### Adding a Preset

**`src/config/presets.ts`** — add entry to `PRESETS` array with a `palette` and
`powerline` setting (name a distinct palette so the preset renders differently):

```typescript
{
  id: 'minimal-monochrome',
  label: 'Minimal Monochrome',
  description: 'Single-color prompt, no icons',
  requiresNerdFont: false,
  leftModules: ['directory', 'git_branch', 'character'],
  rightModules: [],
  palette: 'mono',
  powerline: false,
}
```

No other files need changes. PresetScreen reads from the `PRESETS` array directly.

### Adding a Shell

1. **`src/types.ts`** — add to `ShellId` union
2. **`src/config/shells.ts`** — add to `SHELLS` array with `binary`, `rcFile`,
   `initLine`, and optional `manualNote`/`pathLine`. Shells without a script rc
   file (nushell, powershell) use `rcFile: null` and get a manual `initLine` shown
   on DoneScreen
3. **`src/services/installer.ts`** — add package name mappings to
   `SHELL_PACKAGES` (per package manager) for auto-install support
4. **`src/services/detector.ts`** — no change needed: `detectInstalledShellsAsync`
   iterates `SHELLS` and checks each `binary`

### Adding a Palette

1. **`src/config/palettes.ts`** — add an entry to `PALETTE_DEFS` with a colour for
   every `PaletteColorName`. That is the only step: `PaletteId`, the `PALETTES`
   list, the StyleScreen picker, and the generated `[palettes.<id>]` table are all
   derived from it.

### Adding a Character Symbol

1. **`src/types.ts`** — add to `CharacterSymbol` union
2. **`src/generators/starship.ts`** — add to `SYMBOLS`
3. **`src/components/PromptPreview.tsx`** — add to `CHAR_SYMBOLS`
4. **`src/screens/StyleScreen.tsx`** — add to `CHAR_OPTIONS` array
