# UI/UX Design

## Framework

The app is built with [Ink](https://github.com/vadimdemedes/ink), a React renderer for the terminal. All layout uses Ink's `<Box>` (flexbox) and `<Text>` components. Keyboard input is handled via Ink's `useInput` hook.

---

## Screen Layout

Every screen renders inside `WizardLayout`, which draws the header and progress bar and, by default, a two-column body with the live preview on the right:

```
┌──────────────────────────────────────────────────────────────────┐
│  ShellConfigurator — Starship prompt wizard                      │
│  ● ● ● ◉ ○ ○ ○ ○ ○ ○ ○  4. Preset                                │
│                                                                  │
│  ┌─── Content (flexGrow=1, minWidth=40) ──┐ ┌─── Preview ──────┐ │
│  │                                        │ │                  │ │
│  │  [Screen-specific UI]                  │ │  Preview         │ │
│  │                                        │ │  $ some-command  │ │
│  │                                        │ │  output line...  │ │
│  │                                        │ │  ~/projects main │ │
│  │                                        │ │  ❯               │ │
│  │                                        │ │  3 left segments,│ │
│  │                                        │ │  1 right         │ │
│  └────────────────────────────────────────┘ └──────────────────┘ │
│                                                                  │
│  ↑↓ navigate  Space toggle  Enter confirm  Esc back              │
└──────────────────────────────────────────────────────────────────┘
```

Screens that don't benefit from a preview (Welcome, Installing, Done) set `hidePreview` to use the full width. The progress bar has one dot per step this run visits (Font Pick drops out when no font is being installed, Installing in dry-run mode), so a full run shows 11. Below 100 columns the preview is dropped and the content column shows "Preview hidden — widen the terminal to see it live." instead.

---

## Screen-by-Screen Breakdown

### 1. Welcome

**Purpose**: Detect system state, gate entry into the wizard.

**Layout**: Full-width (no preview). Shows title, description, and a bordered detection results box.

**Flow**:

- On mount, runs async detection: package manager, Starship status (including a script install that PATH does not reach yet), terminal emulator, and container (installed shells are detected later, on the Shell Select step). A detected container shows a note that the font and default-shell steps will be skipped
- Displays results as they complete
- If Starship is installed: Enter to continue
- If not: SelectInput with "Install automatically" / "I'll install manually"
  - "Install manually" shows the install-script command (`curl -sS https://starship.rs/install.sh | sh`) and the docs link, and offers:
    - **Re-check**: re-runs detection (for when user installs in another terminal)
    - **Continue without Starship**: proceeds to the wizard without installing Starship — the Installing step skips the Starship install and the RC config writes, so no `eval "$(starship init …)"` lines end up in shell configs for a shell that has no Starship

**Keys**: `Enter` (continue, if Starship detected); otherwise the menus take `↑↓`, `Enter`, or `1-9` to select

---

### 2. Font Check

**Purpose**: Determine Nerd Font status.

**Layout**: Shows four Nerd Font glyph samples (folder, Git branch, Node.js, and Python) in a bordered list. The user visually confirms whether they see icons or boxes.

**Options** (inside a container the install choice is not offered, since fonts belong to the host terminal):

| Choice                      | Effect                                    |
| --------------------------- | ----------------------------------------- |
| "Yes, I already have one"   | `hasNerdFont: true`, skip font picker     |
| "No, install one for me"    | `hasNerdFont: true`, route to font picker |
| "No, use text symbols only" | `hasNerdFont: false`, skip font picker    |

**Keys**: `↑↓` navigate, `Enter`/`1-9` select, `Esc` back

---

### 3. Font Select

**Purpose**: Choose which Nerd Font to install.

**Layout**: SelectInput list of 6 fonts. Shows the platform-specific install path hint (`~/Library/Fonts` on macOS, `~/.local/share/fonts` on Linux), and either that the font will be selected in the detected terminal for the user or that it must be set in the terminal settings by hand (no terminal detected, or WezTerm).

**Only shown when**: User chose "install one for me" on Font Check.

**Keys**: `↑↓` navigate, `Enter`/`1-9` select, `Esc` back

---

### 4. Preset

**Purpose**: Choose a starting configuration to customize.

**Layout**: Filtered list of presets. Presets requiring Nerd Fonts are marked `★` and are hidden (with a note saying so) if the user selected "no Nerd Font". The list shows a limited number of rows and scrolls; each preset shows a description below the list when highlighted. Choosing a preset on a revisit asks for confirmation first, since it replaces the segment and style choices.

**Preview**: The highlighted preset's description updates live below the list; the preview pane itself swaps only once a preset is confirmed with Enter (modules, palette, and powerline are committed together then).

**Keys**: `↑↓` navigate, `Enter`/`1-9` select, `Esc` back

---

### 5 & 6. Segments (Left / Right)

**Purpose**: Choose and order the modules for each side of the prompt.

**Layout**: A filter line, then a checklist in two groups — **Prompt order** (the selected modules, numbered in the order they render) and **Available** (everything else):

```
  Filter: type to search▌

  Prompt order
  › [✓] 1. Directory
        Current directory path
    [✓] 2. Git Branch
  Available
    [ ] Node.js
    [–] Time — already on the left
```

- `›` marks the cursor position
- Description shown only for the focused module, on its own line
- On the right side, a module already on the left shows as `[–]` and cannot be toggled; picking a module on the left removes it from the right
- `character` module is not shown as a toggle; it is included automatically
- Typing filters the list by label or description (a new filter jumps to its first match); `Backspace` edits it, and `Esc` clears it before a second `Esc` goes back

**Preview**: Updates in real time as modules are toggled — `useUpdateEffect` pushes every change (after the first render) to the parent via `onUpdate`.

**Keys**: `↑↓` navigate, `Space` toggle, `Shift+↑↓`/`Ctrl+↑↓` reorder a selected module, `Enter`/`Tab`/`→` confirm, `Esc`/`←` back (with a filter typed, `Esc` clears it and `←` does nothing)

---

### 7. Style

**Purpose**: Tune prompt symbols, palette, segment style, wrapped-line marker, prompt behavior, and directory display.

**Layout**: Six sections stacked vertically — character, palette, segment style (plain / powerline), wrapped-line marker, prompt extras, and directory display. Only the focused section is expanded; the others collapse to a one-line `Title: summary` so the screen fits a normal terminal:

```
  Style options

  Prompt character
  › ❯ Arrow
    λ Lambda
    $ Dollar

  Colour palette: Default
  Segment style: Plain
  Wrapped-line marker (fish has none): ∙ Dot
  Prompt extras: blank line
  Directory display: 3 folders, no substitutions
```

Expanded, the other sections look like this (the focused row's hint sits on its own line below it):

```
  Colour palette
  › Default   ● ● ● ● ●
    Pastel    ● ● ● ● ●
    ...

  Segment style
  › Plain — Coloured text, no backgrounds
    Powerline — Interlocking coloured blocks (needs a Nerd Font)

  Wrapped-line marker (fish has none)
  › ∙ Dot — Starship's default marker
    ❯ Arrow — Matches the prompt character
    None — No marker on wrapped lines

  Prompt extras
  › [✓] Blank line before prompt
    [ ] Vim mode symbol

  Directory display
  › Depth: 3 folders
        ←→ adjusts · 0 shows the full path
    Substitutions: none
```

`Tab` cycles focus between sections and `Shift+Tab` moves back. The focused section reacts to arrows; the extras section toggles its checkboxes with `Space`. On the depth row `←→` changes the folder count; on the substitutions row `Enter` opens an editor for comma-separated `from=to` pairs, where Enter saves and Esc cancels (an invalid draft shows the error until edited).

**Preview**: Updates live as selections change.

**Keys**: `↑↓` navigate within focused section, `Space` toggle extras, `←→` depth, `Tab`/`Shift+Tab` switch section, `Enter` confirm (or edit substitutions on that row), `Esc` back

---

### 8. Shell Select

**Purpose**: Choose which shells to configure and optionally set a default.

**Layout**: Vertical checklist with status indicators:

```
  › [✓] Zsh [installed] [will set as login shell]
        → ~/.zshrc
    [ ] Bash
    [✓] Fish [will install]
    [ ] Nushell
    [ ] PowerShell
```

- The shell the wizard runs in is pre-selected (from `$SHELL`, then the parent process) when nothing is selected yet
- Checked rows show `[installed]`, `[will install]`, or `[install it yourself]` (no package for the detected package manager); unchecked rows show no tag
- `[will set as login shell]` shown when user presses `D` on a selected shell; `D` again clears it. Inside a container `D` is disabled
- RC file path, or a manual-setup warning for nushell/PowerShell, shown below the focused item
- Warning shown if no shells are selected; Enter waits until shell detection finishes

**Keys**: `↑↓` navigate, `Space` toggle, `D` set as default shell, `Enter` confirm, `Esc` back

---

### 9. Review

**Purpose**: Confirmation gate between shell selection and the install — nothing has
been written yet, so this is the last chance to change things (Esc) before the
irreversible install/config-write phase.

**Layout**: Install plan from `buildTaskList` (the `TaskPlan` component), the
config paths with the generated TOML shown once (`ConfigPlan`), a **Files on
files** list of every config and rc file the run creates or edits with its added
and removed line counts (paths under home shown as `~/…`), then a **Shell wiring**
section with, per selected shell, the diff of its rc file against what is on disk
(`plannedFileChanges`, from the same planner the real write uses: where the block
goes, a PATH line when a script install needs one, the `STARSHIP_CONFIG` export,
the init line, and any stale block it removes). An rc that is already set up says
so; nushell/PowerShell show their manual setup command:

```
  Review your configuration

  This run will
    • Starship
    • Install zsh
    • Write config files
    • Configure zsh
    • Verify config

  Configuration to write
    /home/me/.config/starship/zsh.toml (Zsh)
      format = "$directory$character"
      ...

  Config and rc files
    create ~/.config/starship/zsh.toml (+42 -0)
    edit   ~/.zshrc (+4 -0)

  Shell wiring
    Zsh — /home/me/.zshrc
      @@ -1,1 +1,5 @@
       alias ll="ls -l"
      +
      +# Added by ShellConfigurator
      +export STARSHIP_CONFIG='/home/me/.config/starship/zsh.toml'
      +eval "$(starship init zsh)"
```

When a shared `~/.config/starship.toml` already exists, a warning says it stays on
disk (backed up) but the chosen shells will read their own configs instead. The plan
labels shells the package manager cannot auto-install as `Install <shell> (manual)`.
With "Continue without Starship", the screen says no rc file changes until Starship
is installed.

`ConfigPlan` also has an adopt-mode variant (**"Config to keep"**, the shared path,
and the imported TOML or a "kept as-is" note), but no wizard screen sets
`keepExistingConfig` and headless `apply` never renders this screen, so the wizard
does not reach it today.

In `--dry-run` mode the same screen appears but states that nothing will be applied;
`installing` is still skipped afterwards.

`e` shows (and hides) **Why each part of the prompt shows**: `starship explain` run
against the generated config in the preview's sample project (`explainPromptAsync`),
one row per segment with its output and Starship's description. It is asked once;
without Starship the section says it cannot explain the prompt. It is not offered in
adopt mode, where no config is generated.

**Keys**: `Enter` confirm (only Enter — a stray `Space` or `Tab` does nothing), `e` explain the prompt, `Esc` back

---

### 10. Installing

**Purpose**: Execute all installation tasks and show progress.

**Layout**: Full-width (no preview). Task list with status icons:

```
  Installing
  This may take a moment. Password prompts (sudo, chsh) will appear in the terminal.
  Press c to cancel.

  [✓] Starship
  [✓] Nerd Font (JetBrains Mono)
  [✓] Set Alacritty font
  [✓] Install fish
  [~] Write config files
  [ ] Configure fish
  [ ] Verify config
```

The password line appears only when a step can prompt (chsh, or a sudo package
install). Error details appear indented below failed tasks in red italic, notes in
grey; skipped tasks show `[–]`. When every task has finished the screen shows "All
done — continuing...", or "Finished with errors" / "Cancelled" followed by
"— continuing to the summary...".

Two tasks are conditional: **Set <terminal> font** (wires the installed Nerd
Font into the detected terminal's config) appears only when a concrete font was
chosen and a terminal was detected; **Verify config** always follows the rc
steps and loads the written configs through the real `starship print-config`. In
a container both the font and the default-shell (`chsh`) tasks are dropped — fonts
belong to the host terminal there.

If the user chose "Continue without Starship", the Starship task is omitted entirely, each "Configure <shell>" task is skipped and relabelled "Configure <shell> (skipped — install Starship first)", and Verify config does not run — no init lines are written without Starship present.

**Input**: Minimal. `c` (or `Ctrl+C`) cancels the run — the task chain aborts at the next phase boundary, the command in flight is killed, and tasks that never ran are marked failed ("cancelled"), never done. Otherwise auto-advances to Done after a 1200ms pause.

---

### 11. Done

**Purpose**: Summary of what was installed and configured.

**Layout**: Full-width. Reads `installResults` from `WizardState` to display actual task outcomes:

- Green ✓ for successful tasks, red ✗ for failed tasks, grey `–` for skipped ones, and a yellow `?` when no result was recorded for a step
- Error details shown indented below failed tasks in red italic
- Header shows "All done!" (green), "Finished with errors" (yellow), or "Finished — no results recorded" (yellow, when the install step reported nothing back)
- Config file path
- Font installed with human-readable label (if any)
- Per-shell status (installed + configured, or failure details)
- Default shell status (if set via chsh)
- Post-install instructions (restart the terminal when the config was written, `starship print-config`, and `shell-configurator doctor` to check the setup)
- Yellow reminder to set the installed font family in the terminal — shown only when the font install succeeded but the terminal-font wiring task did **not** complete (no terminal detected, or the terminal config needs a manual step like WezTerm), since otherwise the font is already selected

In `--dry-run` mode the header reads "Dry run — no changes were made" and the screen
shows the same plan sections as Review (`TaskPlan` titled "Tasks that would run",
plus `ConfigPlan`) and a hint to run without `--dry-run`.

**Keys**: `Enter` / `Esc` / `Q` to exit; `r` runs a one-key undo — it copies the
newest `.bak-*` backups back over the shared and per-shell Starship configs (the
same code path as the CLI's `--restore`) and prints what was restored. It does not
undo rc-file edits or terminal font configs, runs at most once, and is disabled in
dry-run mode (no backups were made). `s` saves the prompt as Markdown to share
(`writeShareFile`: `starship-prompt.md` in the current folder, or a numbered name
next to an existing one) and shows where; it works in dry-run mode too, saves
once (after a failure `s` tries again), and is not offered in adopt mode.

---

## Prompt Preview

**Files**: `src/components/PromptPreview.tsx` (panel), `src/services/preview.ts` (rendering)

The panel shows what the prompt will look like. When a real `starship` binary is on
PATH it renders the current config live through it; otherwise it falls back to a
simulated terminal prompt:

```
  Preview
  $ some-command
  output line...

  ~/projects  main +1
  ❯

  right: 2s  12:34

  3 left segments, 2 right
```

The blank line above the prompt appears only with "Blank line before prompt" on;
the prompt character sits on its own line, as in the generated config.

### Live Rendering via the Starship Binary

When starship is present, `src/services/preview.ts` replaces the simulation with the
binary's own output:

1. `renderPromptAsync` creates a scratch dir in the system temp dir and writes
   `generateToml(state)` to `starship.toml` there.
2. `STARSHIP_CONFIG` is pointed at that file, `HOME` at the scratch dir, and a
   throwaway `git` repo is scaffolded as the working directory so the
   directory/git/branch modules render real data.
3. `starship prompt` runs against the scratch config at the preview panel's width;
   its output is painted by the panel with a "rendered live by the starship binary"
   caption ("updating…" while a newer render is pending). A script install that
   PATH does not reach yet is still used.
4. The render is debounced (`PREVIEW_DEBOUNCE_MS`) and gated on the preview-relevant
   state (preset, modules, palette, powerline, character symbol, blank line, vim
   mode, directory depth and substitutions, nerd font) plus the panel width, so a
   keyboard storm settles on exactly one invocation. The last render is kept across
   screens, so a step change does not flash the static frame.

If starship is missing (it is installed later in the flow) or the render fails, the
simulation below is shown instead; the scratch dir is always cleaned up afterwards.

### Module Rendering

The static fallback calls `previewSegment(hasNerdFont)` from each module definition
to get display text:

- With Nerd Font: ` main` (branch icon; directory and runtime modules also use their glyphs)
- Without: `on main`

The live render instead shows exactly what the real binary prints for the same config,
so the two only line up where the generator and the static approximation already agree.

### Color Application

Colors come from two sources:

1. **Palette colors** (from `palette`): every module is drawn in the palette entry of
   the same name, and the prompt character in `ok`. There are fourteen palettes: one
   seeded by each preset, plus `high-contrast` and `colorblind` for accessibility.
2. **Powerline blocks** (from `powerline`): each segment is drawn as `fg` text on its
   own colour as a background; separators use the current segment as foreground and
   the neighboring segment as background. The preview mirrors the generator.

### Colour Accessibility

Every colour prop in the wizard goes through `uiColor` in `config/colors.ts`. When
`NO_COLOR` is set to a non-empty value (https://no-color.org), `uiColor` returns
`undefined`, so Ink renders plain text. The `ink-select-input` lists use a gated
wrapper for the same reason. Bold, dim, and the cursor markers still apply, so the
screen keeps its hierarchy; only hue is removed. The palette swatches are hidden
because five same-coloured dots carry no information.

The generated `starship.toml` is unaffected — `NO_COLOR` governs the wizard's own
output, not the config it writes.

### Update Behavior

`PromptPreview` re-renders whenever the preview-relevant state listed above changes.
Screens that push live updates via `onUpdate` (SegmentsScreen as modules toggle,
StyleScreen as any option changes) cause immediate visual feedback; Preset changes
the prompt only when a preset is confirmed and the step advances. Navigation between steps
never re-runs starship, because the render is keyed to those fields rather than to the
step itself.

---

## Navigation Hints

**File**: `src/components/NavHints.tsx`

Each screen provides its own hint array; plain option lists share `LIST_HINTS`
(`↑↓ navigate  Enter/1-9 select  Esc back`). Hints render as a horizontal bar at the bottom:

```
↑↓ navigate  Space toggle  Enter confirm  Esc back
```

Keys are bold cyan, labels are gray. Each screen customizes its hints to match available actions (Style changes them with the focused section and row). Done draws its exit keys as plain text instead of `NavHints`.

---

## Interaction Patterns

| Pattern                                                           | Screens                                | Implementation                                                     |
| ----------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------ |
| **SelectInput** (`ink-select-input`, wrapped by `AppSelectInput`) | Welcome, FontCheck, FontSelect, Preset | `<AppSelectInput>` with `onSelect`; Preset also uses `onHighlight` |
| **Custom checklist**                                              | Segments, Shell                        | `PickerRow` rows + `useInput` with `↑↓ Space`                      |
| **Multi-section focus**                                           | Style                                  | `Tab` switches focus, `↑↓` navigates within section                |
| **Async detection**                                               | Welcome, Shell                         | Async `useEffect` with `cancelled` flag; non-blocking              |
| **Auto-advance**                                                  | Installing                             | Only `c` (cancel) is read; advances after task completion + delay  |
