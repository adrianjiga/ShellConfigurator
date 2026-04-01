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

- On mount, runs async detection: package manager, Starship version, installed shells
- Displays results as they complete
- If Starship is installed: Enter to continue
- If not: SelectInput with "Install automatically" / "I'll install manually"
  - "Install manually" shows install instructions (package manager command + docs link) and offers:
    - **Re-check**: re-runs detection (for when user installs in another terminal)
    - **Continue without Starship**: proceeds to the wizard (Starship will be installed during the Installing step)

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

**Layout**: SelectInput list of 6 fonts. Shows install path hint (`~/.local/share/fonts/`).

**Only shown when**: User chose "install one for me" on Font Check.

**Keys**: `↑↓` navigate, `Enter` select, `Esc` back

---

### 4. Preset

**Purpose**: Choose a starting configuration to customize.

**Layout**: Filtered list of presets. Presets requiring Nerd Fonts are hidden if the user selected "no Nerd Font". Each preset shows a description below the list when highlighted.

**Preview**: Updates live on highlight — modules change in the preview pane as the user scrolls through presets.

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

**Layout**: Two side-by-side sections with focus indicator:

```
  Prompt character          Color scheme
  › Arrow    ❯              › Default
    Lambda   λ                Pastel
    Dollar   $                Minimal
```

`Tab` switches focus between sections. The focused section shows items in bold.

**Preview**: Updates live as selections change.

**Keys**: `↑↓` navigate within section, `Tab` switch section, `Enter` confirm, `Esc` back

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

### 9. Installing

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

**No user input** — fully automated. Auto-advances to Done after 1200ms.

---

### 10. Done

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

**Keys**: `Enter` / `Esc` / `Q` to exit

---

## Prompt Preview

**File**: `src/components/PromptPreview.tsx`

The preview panel renders a simulated terminal prompt that reflects the current wizard state:

```
  $ some-command
  output line...

  ~/projects  main +1  ❯
  right: 2s  12:34
  ─────────────────
  3 left segment(s), 2 right
```

### Module Rendering

Each module calls `previewSegment(hasNerdFont)` from its definition to get display text:

- With Nerd Font: ` main` (branch icon)
- Without: `on main`

### Color Application

Colors come from two sources:

1. **Scheme colors** (from `colorScheme`): applied to `directory`, `git_branch`, `git_status`, and `character`
2. **Module colors** (hardcoded map): applied to runtime modules like `nodejs` (green), `python` (yellow), `rust` (red), etc.

### Update Behavior

The preview re-renders on every state change. Screens that push live updates via `onUpdate` (SegmentsScreen, PresetScreen) cause immediate visual feedback as the user toggles modules or highlights presets.

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

| Pattern                        | Screens                       | Implementation                                       |
| ------------------------------ | ----------------------------- | ---------------------------------------------------- |
| **SelectInput** (Ink built-in) | FontCheck, FontSelect, Preset | `<SelectInput>` with `onSelect` and `onHighlight`    |
| **Custom checklist**           | Segments, Shell               | Manual cursor + `useInput` with `↑↓ Space`           |
| **Multi-section focus**        | Style                         | `Tab` switches focus, `↑↓` navigates within section  |
| **Async detection**            | Welcome, Shell                | `useEffect` runs detection, updates UI on completion |
| **Auto-advance**               | Installing                    | No input; advances after task completion + delay     |
