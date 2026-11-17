# Types and schemas

**File**: `src/types.ts`

## Enums

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

## WizardState

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
  keepExistingConfig: boolean; // Adopt mode: keep the shared starship.toml as-is
  sharedConfigToml: string | null; // Imported shared config (--import-url); runtime-only, never serialized
  selectedShells: ShellId[]; // Shells to configure
  packageManager: PackageManager; // Detected package manager
  installedShells: ShellId[]; // Shells already on system
  terminal: TerminalId | null; // Detected terminal emulator; lets the wizard select the font in it
  container: boolean; // True inside a container/CI sandbox — fonts are per-host and chsh is skipped
  remoteSession: RemoteSession; // 'ssh' | 'wsl' | null — the terminal and its fonts belong to another computer or to Windows
  nerdFontToInstall: NerdFontChoice; // {kind:'none'|'select'|'install',id}
  fontAnswer: 'have' | 'install' | 'none' | null; // Nerd Font answer, for a revisit (runtime-only)
  setDefaultShell: ShellId | null; // Shell to set via chsh
  skipStarshipInstall: boolean; // "Continue without Starship" — drops the Starship install, Verify and the unset pass; rc tasks stay in the plan, marked skipped
  dryRun: boolean; // No install or config-write happens — the wizard only previews
  installResults: InstallTask[]; // Final task statuses from InstallingScreen
  runId: string | null; // The install's captured run, which rollback can put back; runtime-only
  summaryPath: string | null; // Where WHAT-CHANGED.md was written; runtime-only
}
```

## InstallTask

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

## Nerd Font Choice

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

## Constants

```typescript
const STEP_ORDER: readonly [...]; // `as const`; WizardStep is its element type
// welcome → fontcheck → font_select → preset → segments_left → segments_right → style → shells → review → installing → done
```

## Step Machine

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

## ModuleId

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

## ModuleDef

```typescript
interface ModuleDef {
  id: ConfigurableModuleId;
  label: string; // Display name in UI
  description: string; // Shown when module is focused
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
(`username` → `style_user`/`style_root`, `battery` →
`[[battery.display]]`) need `styleFor`; the generator emits the plain `style` key
for everyone else.

## Lookup

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

## Example Entry

```typescript
// MODULE_DEFS is keyed by id; MODULES adds `id` from the key.
git_branch: {
  label: 'Git Branch',
  description: 'Active git branch name',
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

## PresetDef

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

## ShellDef

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

## Shell Init Lines

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

## Lookup

```typescript
function getShell(id: ShellId): ShellDef | undefined;
```

---
