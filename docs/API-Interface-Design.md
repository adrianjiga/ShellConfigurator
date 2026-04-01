# API & Interface Design

## Core Types

**File**: `src/types.ts`

### Enums

```typescript
type ShellId = 'zsh' | 'bash' | 'fish' | 'nushell' | 'powershell';
type CharacterSymbol = 'arrow' | 'lambda' | 'dollar';
type ColorScheme = 'default' | 'pastel' | 'minimal';
type PackageManager = 'pacman' | 'apt' | 'dnf' | 'brew' | 'script';
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
  colorScheme: ColorScheme;
  selectedShells: ShellId[]; // Shells to configure
  packageManager: PackageManager; // Detected package manager
  installedShells: ShellId[]; // Shells already on system
  nerdFontToInstall: string | null; // Font ID, sentinel, or null
  setDefaultShell: ShellId | null; // Shell to set via chsh
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
}
```

### Constants

```typescript
const FONT_SELECT_SENTINEL = '__select__' as const;
```

Sentinel value stored in `nerdFontToInstall` to signal that the user chose to install a font but hasn't picked which one yet. The step machine uses this to decide whether to show `font_select`.

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
  id: string;
  label: string; // Display name in UI
  description: string; // Shown when module is focused
  defaultLeft: boolean; // Included in left prompt by default
  defaultRight: boolean; // Included in right prompt by default
  previewSegment: (hasNerdFont: boolean) => string; // Text for PromptPreview
  formatKey: string; // Starship format string key
}
```

### Lookup

```typescript
function getModule(id: string): ModuleDef | undefined;
```

The `MODULES` array is the single registry. All module-aware code reads from it.

### Example Entry

```typescript
{
  id: 'git_branch',
  label: 'Git Branch',
  description: 'Active git branch name',
  defaultLeft: true,
  defaultRight: false,
  formatKey: 'git_branch',
  previewSegment: (nf) => `${nf ? ' ' : 'on '}main`,
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
  leftModules?: string[]; // Overrides default left modules
  rightModules?: string[]; // Overrides default right modules
}
```

12 presets defined. Presets with `requiresNerdFont: true` are filtered out in PresetScreen when `state.hasNerdFont` is `false`.

When a preset is selected, its `leftModules` and `rightModules` replace the current state (with `character` always appended to leftModules by SegmentsScreen).

---

## Shell Schema

**File**: `src/config/shells.ts`

### ShellDef

```typescript
interface ShellDef {
  id: ShellId;
  label: string;
  rcFile: string | null; // Absolute path, or null for manual-only shells
  initLine: string; // Starship init command for this shell
  manualNote?: string; // Instructions shown on DoneScreen
}
```

### Shell Init Lines

| Shell      | RC File                      | Init Line                                       |
| ---------- | ---------------------------- | ----------------------------------------------- |
| zsh        | `~/.zshrc`                   | `eval "$(starship init zsh)"`                   |
| bash       | `~/.bashrc`                  | `eval "$(starship init bash)"`                  |
| fish       | `~/.config/fish/config.fish` | `starship init fish \| source`                  |
| nushell    | `null` (manual)              | `starship init nu \| save -f ...`               |
| powershell | `null` (manual)              | `Invoke-Expression (&starship init powershell)` |

Shells with `rcFile: null` are not auto-configured. Instead, `manualNote` is displayed on DoneScreen.

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
function getConfigPath(): string;
// Returns ~/.config/starship.toml

function writeStarshipConfig(toml: string): void;
// Writes TOML string to config path, creating ~/.config/ if needed

function applyShellConfig(shellId: ShellId): { applied: boolean; note?: string };
// Appends init line to RC file. Returns { applied: false, note } if
// shell is manual-only or already configured.
```

---

## Service Exports

### detector.ts

```typescript
function detectPackageManager(): PackageManager;
// Returns detected package manager or 'script' fallback

function isStarshipInstalled(): { installed: boolean; version?: string };
// Checks starship --version

function detectInstalledShells(): ShellId[];
// Returns array of shells found in PATH

// Async versions (non-blocking for Ink render loop)
function detectPackageManagerAsync(): Promise<PackageManager>;
function isStarshipInstalledAsync(): Promise<{ installed: boolean; version?: string }>;
function detectInstalledShellsAsync(): Promise<ShellId[]>;
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
```

All installer functions use `spawnSync` with `stdio: 'inherit'` — they block execution and pass terminal I/O through for sudo prompts.

---

## Extensibility Guide

### Adding a Module

1. **`src/types.ts`** — no change needed (modules use string IDs)
2. **`src/config/modules.ts`** — add to `ModuleId` type and `MODULES` array:
   ```typescript
   {
     id: 'lua',
     label: 'Lua',
     description: 'Lua version',
     defaultLeft: false,
     defaultRight: false,
     formatKey: 'lua',
     previewSegment: (nf) => `${nf ? '🌙 ' : 'lua '}5.4.0`,
   }
   ```
3. **`src/generators/starship.ts`** — add case to `moduleBlock()`:
   ```typescript
   case 'lua':
     return `
   [lua]
   symbol   = "${hasNerdFont ? '🌙 ' : 'lua '}"
   style    = "bold blue"
   disabled = false
   `.trim();
   ```
4. **`src/components/PromptPreview.tsx`** — (optional) add entry to `MODULE_COLORS` for preview coloring

Modules without a case in `moduleBlock()` fall through to the default block: `[id]\ndisabled = false`.

### Adding a Preset

**`src/config/presets.ts`** — add entry to `PRESETS` array:

```typescript
{
  id: 'minimal-monochrome',
  label: 'Minimal Monochrome',
  description: 'Single-color prompt, no icons',
  requiresNerdFont: false,
  leftModules: ['directory', 'git_branch', 'character'],
  rightModules: [],
}
```

No other files need changes. PresetScreen reads from the `PRESETS` array directly.

### Adding a Shell

1. **`src/types.ts`** — add to `ShellId` union
2. **`src/config/shells.ts`** — add to `SHELLS` array with `rcFile`, `initLine`, and optional `manualNote`
3. **`src/services/installer.ts`** — add package name mappings to `SHELL_PACKAGES` and binary name to `setDefaultShell()`
4. **`src/services/detector.ts`** — add binary check to `detectInstalledShells()`

### Adding a Color Scheme

1. **`src/types.ts`** — add to `ColorScheme` union
2. **`src/generators/starship.ts`** — add to `COLOR_STYLES`
3. **`src/components/PromptPreview.tsx`** — add to `SCHEME_COLORS`
4. **`src/screens/StyleScreen.tsx`** — add to `COLOR_OPTIONS` array

### Adding a Character Symbol

1. **`src/types.ts`** — add to `CharacterSymbol` union
2. **`src/generators/starship.ts`** — add to `SYMBOLS`
3. **`src/components/PromptPreview.tsx`** — add to `CHAR_SYMBOLS`
4. **`src/screens/StyleScreen.tsx`** — add to `CHAR_OPTIONS` array
