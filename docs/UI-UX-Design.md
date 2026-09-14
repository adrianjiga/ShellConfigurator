# UI/UX Design

## Framework

The app is built with [Ink](https://github.com/vadimdemedes/ink), a React renderer for the terminal. All layout uses Ink's `<Box>` (flexbox) and `<Text>` components. Keyboard input is handled via Ink's `useInput` hook.

---

## Screen Layout

Every screen (except Welcome and Done) uses a two-column layout provided by `WizardLayout`:

```
┌──────────────────────────────────────────────────────────────────┐
│  ShellConfigurator                                               │
│  ● ● ● ◉ ○ ○ ○ ○ ○ ○  4. Preset                                  │
│                                                                  │
│  ┌─── Content (flexGrow=1, minWidth=40) ──┐ ┌─── Preview ──────┐ │
│  │                                        │ │                  │ │
│  │  [Screen-specific UI]                  │ │  $ some-command  │ │
│  │                                        │ │  output...       │ │
│  │                                        │ │                  │ │
│  │                                        │ │  ~/projects ❯    │ │
│  │                                        │ │                  │ │
│  │                                        │ │  3 left, 1 right │ │
│  └────────────────────────────────────────┘ └──────────────────┘ │
│                                                                  │
│  [↑↓] navigate  [Space] toggle  [Enter] confirm  [Esc] back      │
└──────────────────────────────────────────────────────────────────┘
```

Screens that don't benefit from a preview (Welcome, Installing, Done) set `hidePreview` to use the full width.

---

## Screen-by-Screen Breakdown

### 1. Welcome

**Purpose**: Detect system state, gate entry into the wizard.

**Layout**: Full-width (no preview). Shows title, description, and a bordered detection results box.

**Flow**:

- On mount, runs async detection: package manager and Starship status (installed shells are detected later, on the Shell Select step)
- Displays results as they complete
- If Starship is installed: Enter to continue
- If not: SelectInput with "Install automatically" / "I'll install manually"
  - "Install manually" shows install instructions (package manager command + docs link) and offers:
    - **Re-check**: re-runs detection (for when user installs in another terminal)
    - **Continue without Starship**: proceeds to the wizard without installing Starship — the Installing step skips the Starship install and the RC config writes, so no `eval "$(starship init …)"` lines end up in shell configs for a shell that has no Starship

**Keys**: `Enter` (continue, if Starship detected)

---

### 2. Font Check

**Purpose**: Determine Nerd Font status.

**Layout**: Shows a grid of 4 test icons that render correctly only with a Nerd Font installed. The user visually confirms whether they see icons or boxes.

**Options**:
| Choice | Effect |
|--------|--------|
| "Yes, I already have one" | `hasNerdFont: true`, skip font picker |
| "No, install one for me" | `hasNerdFont: true`, route to font picker |
| "No, use text symbols only" | `hasNerdFont: false`, skip font picker |

**Keys**: `↑↓` navigate, `Enter` select, `Esc` back

---

### 3. Font Select

**Purpose**: Choose which Nerd Font to install.

**Layout**: SelectInput list of 6 fonts. Shows the platform-specific install path hint (`~/Library/Fonts` on macOS, `~/.local/share/fonts` on Linux).

**Only shown when**: User chose "install one for me" on Font Check.

**Keys**: `↑↓` navigate, `Enter` select, `Esc` back

---

### 4. Preset

**Purpose**: Choose a starting configuration to customize.

**Layout**: Filtered list of presets. Presets requiring Nerd Fonts are hidden if the user selected "no Nerd Font". Each preset shows a description below the list when highlighted.

**Preview**: The highlighted preset's description updates live below the list; the preview pane itself swaps only once a preset is confirmed with Enter (modules, palette, and powerline are committed together then).

**Keys**: `↑↓` navigate, `Enter` select, `Esc` back

---

### 5 & 6. Segments (Left / Right)

**Purpose**: Toggle individual modules on or off for each side of the prompt.

**Layout**: Vertical checklist with cursor indicator. Each row shows:

```
  › [✓] Directory        Current directory path
    [ ] Node.js
    [✓] Git Branch
```

- `›` marks the cursor position
- Description shown only for the focused module
- `character` module is not shown (always included automatically)

**Preview**: Updates in real time as modules are toggled — `useEffect` pushes every change to parent via `onUpdate`.

**Keys**: `↑↓` navigate, `Space` toggle, `Enter`/`Tab`/`→` confirm, `Esc` back

---

### 7. Style

**Purpose**: Choose character symbol and color scheme.

**Layout**: Three sections stacked vertically — character, palette, and segment style (plain / powerline) — each with its own focus indicator:

```
  Style options

  Prompt character
  › Arrow    ❯
    Lambda   λ
    Dollar   $

  Colour palette
  › Default
    Pastel
    ...

  Segment style
  › Plain
    Powerline   — separators between segments
```

`Tab` cycles focus between sections. The focused section shows items in bold and reacts to arrows.

**Preview**: Updates live as selections change.

**Keys**: `↑↓` navigate within focused section, `Tab` switch section, `Enter` confirm, `Esc` back

---

### 8. Shell Select

**Purpose**: Choose which shells to configure and optionally set a default.

**Layout**: Vertical checklist with status indicators:

```
  › [✓] Zsh         [installed]  [will set as login shell]
    [✓] Bash        [installed]
    [ ] Fish        [will install]
    [ ] Nushell     [will install]
    [ ] PowerShell  [will install]
```

- `[installed]` / `[will install]` based on detection
- `[will set as login shell]` shown when user presses `D` on a selected shell
- RC file path and manual notes shown for focused item
- Warning shown if no shells are selected

**Keys**: `↑↓` navigate, `Space` toggle, `D` set as default shell, `Enter` confirm, `Esc` back

---

### 9. Review

**Purpose**: Confirmation gate between shell selection and the install — nothing has
been written yet, so this is the last chance to change things (Esc) before the
irreversible install/config-write phase.

**Layout**: Install plan from `buildTaskList` plus, per selected shell, the config
file path, the rc lines that will be appended (`STARSHIP_CONFIG` export + init line,
or the manual setup command for nushell/PowerShell), and the generated TOML:

```
  Review your configuration

  This run will
    • Install zsh
    • Write config files
    • Configure zsh

  Configuration to write
    ~/.config/starship/zsh.toml (Zsh)
      export STARSHIP_CONFIG="~/.config/starship/zsh.toml"
      eval "$(starship init zsh)"
      format = "$directory$character"
      ...
```

**Adopt mode** (`apply --adopt` / `--import-url` reaches review in dry-run only)
never generates a per-shell TOML. The section header becomes **"Config to keep"**
and shows the shared path, the `(shared config)` marker, and the init line alone
(no `STARSHIP_CONFIG` export); a config fetched via `--import-url` is previewed
inline, otherwise the screen states the existing file will be kept as-is. The plan
labels shells the package manager cannot auto-install as `Install <shell> (manual)`.

In `--dry-run` mode the same screen appears but states that nothing will be applied;
`installing` is still skipped afterwards.

**Keys**: `Enter`/`Space` confirm, `Esc` back

---

### 10. Installing

**Purpose**: Execute all installation tasks and show progress.

**Layout**: Full-width (no preview). Task list with status icons:

```
  Installing
  sudo prompts will appear in terminal

  [✓] Starship
  [✓] Nerd Font (JetBrains Mono)
  [~] Install fish
  [ ] Write starship.toml
  [ ] Apply shell configs

  All done — continuing...
```

Error details appear indented below failed tasks in red italic.

If the user chose "Continue without Starship", the Starship task is omitted entirely and "Apply shell configs" is skipped with an "install Starship first" note — no init lines are written without Starship present.

**Input**: Minimal. `c` cancels the run — the task chain aborts at the next phase boundary, the command in flight is killed, and tasks that never ran are marked failed ("cancelled"), never done. Otherwise auto-advances to Done after a 1200ms pause.

---

### 11. Done

**Purpose**: Summary of what was installed and configured.

**Layout**: Full-width. Reads `installResults` from `WizardState` to display actual task outcomes:

- Green ✓ for successful tasks, red ✗ for failed tasks
- Error details shown indented below failed tasks in red italic
- Header shows "All done!" (green) or "Finished with errors" (yellow) based on failures
- Config file path
- Font installed with human-readable label (if any)
- Per-shell status (installed + configured, or failure details)
- Default shell status (if set via chsh)
- Post-install instructions (restart terminal, set font in terminal settings)
- Yellow reminder about Nerd Font terminal setup

**Keys**: `Enter` / `Esc` / `Q` to exit; `r` runs a one-key undo — it copies the
newest `.bak-*` backups back over the shared and per-shell configs (the same
code path as the CLI's `--restore`) and prints what was restored.

---

## Prompt Preview

**Files**: `src/components/PromptPreview.tsx` (panel), `src/services/preview.ts` (rendering)

The panel shows what the prompt will look like. When a real `starship` binary is on
PATH it renders the current config live through it; otherwise it falls back to a
simulated terminal prompt:

```
  $ some-command
  output line...

  ~/projects  main +1  ❯
  right: 2s  12:34
  ─────────────────
  3 left segment(s), 2 right
```

### Live Rendering via the Starship Binary

When starship is present, `src/services/preview.ts` replaces the simulation with the
binary's own output:

1. `renderPromptAsync` creates a scratch dir under the cache and writes
   `generateToml(state)` to `starship.toml` there.
2. `STARSHIP_CONFIG` is pointed at that file, `HOME` at the scratch dir, and a
   throwaway `git` repo is scaffolded as the working directory so the
   directory/git/branch modules render real data.
3. `starship prompt` runs against the scratch config; its output is painted by the
   panel with a "rendered live by the starship binary" caption.
4. The render is debounced (`PREVIEW_DEBOUNCE_MS`) and gated on the preview-relevant
   state (modules, palette, powerline, character symbol, nerd font, shared-config
   flag), so a keyboard storm settles on exactly one invocation.

If starship is missing (it is installed later in the flow) or the render fails, the
simulation below is shown instead; the scratch dir is always cleaned up afterwards.

### Module Rendering

The static fallback calls `previewSegment(hasNerdFont)` from each module definition
to get display text:

- With Nerd Font: ` main` (branch icon)
- Without: `on main`

The live render instead shows exactly what the real binary prints for the same config,
so the two only line up where the generator and the static approximation already agree.

### Color Application

Colors come from two sources:

1. **Palette colors** (from `palette`): every module is drawn in the palette entry of
   the same name, and the prompt character in `ok`. There are twelve palettes, one
   seeded by each preset.
2. **Powerline blocks** (from `powerline`): each segment is drawn as `fg` text on its
   own colour as a background, followed (or preceded) by a separator tinted with its
   neighbour's colour. The preview mirrors the generator so both show the same prompt.

### Update Behavior

`PromptPreview` re-renders whenever the preview-relevant state changes (modules,
palette, powerline, character symbol, nerd font, shared-config flag). Screens that
push live updates via `onUpdate` (SegmentsScreen as modules toggle, ShellScreen when
detection lands) cause immediate visual feedback; the other screens change the prompt
only when the user confirms a choice and the step advances. Navigation between steps
never re-runs starship, because the render is keyed to those fields rather than to the
step itself.

---

## Navigation Hints

**File**: `src/components/NavHints.tsx`

Each screen provides its own hint array. Hints render as a horizontal bar at the bottom:

```
[↑↓] navigate  [Space] toggle  [Enter] confirm  [Esc] back
```

Keys are styled cyan, labels are gray. Each screen customizes its hints to match available actions.

---

## Interaction Patterns

| Pattern                        | Screens                       | Implementation                                        |
| ------------------------------ | ----------------------------- | ----------------------------------------------------- |
| **SelectInput** (Ink built-in) | FontCheck, FontSelect, Preset | `<SelectInput>` with `onSelect` and `onHighlight`     |
| **Custom checklist**           | Segments, Shell               | Manual cursor + `useInput` with `↑↓ Space`            |
| **Multi-section focus**        | Style                         | `Tab` switches focus, `↑↓` navigates within section   |
| **Async detection**            | Welcome, Shell                | Async `useEffect` with `cancelled` flag; non-blocking |
| **Auto-advance**               | Installing                    | No input; advances after task completion + delay      |
