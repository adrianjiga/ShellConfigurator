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
  starshipInstalled: boolean; // Starship detected on system
  hasNerdFont: boolean; // User has or is installing a Nerd Font
  preset: string | null; // Selected preset ID
  leftModules: string[]; // Module IDs for left prompt
  rightModules: string[]; // Module IDs for right prompt
  characterSymbol: CharacterSymbol;
  palette: PaletteId; // Colour theme; one per preset, changeable on StyleScreen
  powerline: boolean; // Draw segments as interlocking coloured blocks
  selectedShells: ShellId[]; // Shells to configure
  packageManager: PackageManager; // Detected package manager
  installedShells: ShellId[]; // Shells already on system
  nerdFontToInstall: NerdFontChoice; // {kind:'none'|'select'|'install',id}
  setDefaultShell: ShellId | null; // Shell to set via chsh
  skipStarshipInstall: boolean; // "Continue without Starship" — skips install + RC steps
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

function applyShellConfig(
  shellId: ShellId,
  opts?: { ensurePathDir?: string | null }
): { applied: boolean; note?: string };
// Appends the STARSHIP_CONFIG pin + init line to the shell's rc file.
// Returns { applied: false, note } for manual-only shells or when already
// configured. Drops stale unset-guard blocks from earlier runs first, so
// a re-run can repair a polluted rc file.

function resetSharedShellConfig(shellId: ShellId): { applied: boolean; note?: string };
// Removes any per-shell wiring and appends an unset guard so the shell
// falls back to the shared ~/.config/starship.toml instead of inheriting
// a leaked STARSHIP_CONFIG. The mirror image of applyShellConfig.
```

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
```

### installer.ts

```typescript
function installStarship(pm: PackageManager): Promise<void>;
// Installs Starship via package manager or curl script

function installShell(shellId: ShellId, pm: PackageManager): Promise<void>;
// Installs a shell via package manager. Throws if pm is 'script'.

function installNerdFont(fontId: string): Promise<void>;
// Downloads font zip from GitHub, extracts to platform-appropriate fonts directory
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
  installNerdFont: (fontId: string) => Promise<void>;
  installShell: (shellId: ShellId, pm: PackageManager) => Promise<void>;
  setDefaultShell: (shellId: ShellId) => Promise<void>;
  generateToml: (state: WizardState) => string;
  writeShellConfig: (toml: string, shellId: ShellId) => WriteConfigResult;
  applyShellConfig: (
    shellId: ShellId,
    opts?: { ensurePathDir?: string | null }
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
