# Architecture Overview

## Entry Point

The app starts in `src/index.tsx`, which renders the root `App` component using Ink's renderer. Ink is a React-based framework for building interactive CLI applications — it translates a React component tree into terminal output.

## Component Tree

```
<Ink renderer>
└── App                           (src/app.tsx)
    └── [switch on state.step]
        ├── WelcomeScreen         (src/screens/WelcomeScreen.tsx)
        │   └── WizardLayout      (hidePreview)
        │
        ├── FontCheckScreen       (src/screens/FontCheckScreen.tsx)
        │   └── WizardLayout
        │       └── PromptPreview
        │
        ├── FontSelectScreen      (src/screens/FontSelectScreen.tsx)
        │   └── WizardLayout
        │       └── PromptPreview
        │
        ├── PresetScreen          (src/screens/PresetScreen.tsx)
        │   └── WizardLayout
        │       └── PromptPreview
        │
        ├── SegmentsScreen (left) (src/screens/SegmentsScreen.tsx)
        │   └── WizardLayout
        │       └── PromptPreview
        │
        ├── SegmentsScreen (right)
        │   └── WizardLayout
        │       └── PromptPreview
        │
        ├── StyleScreen           (src/screens/StyleScreen.tsx)
        │   └── WizardLayout
        │       └── PromptPreview
        │
        ├── ShellScreen           (src/screens/ShellScreen.tsx)
        │   └── WizardLayout
        │       └── PromptPreview
        │
        ├── InstallingScreen      (src/screens/InstallingScreen.tsx)
        │   └── WizardLayout      (hidePreview)
        │
        └── DoneScreen            (src/screens/DoneScreen.tsx)
            └── WizardLayout      (hidePreview)
```

### Shared Components

| Component       | File                               | Purpose                                                                                                |
| --------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `WizardLayout`  | `src/components/WizardLayout.tsx`  | Wraps every screen. Renders header, progress bar, two-column layout (content + preview), and NavHints. |
| `PromptPreview` | `src/components/PromptPreview.tsx` | Live prompt visualization in the right column. Updates in real time as state changes.                  |
| `NavHints`      | `src/components/NavHints.tsx`      | Renders keyboard shortcut hints at the bottom of each screen.                                          |

---

## Step Machine

The wizard is a linear state machine defined by the `STEP_ORDER` array in `app.tsx`:

```
welcome → fontcheck → font_select → preset → segments_left → segments_right → style → shells → installing → done
```

### Navigation Functions

| Function                   | Behavior                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `goNext(update?)`          | Uses functional `setState` updater — merges update, advances to next step safely      |
| `goBack()`                 | Uses functional `setState` updater — moves to previous step, avoids stale closures    |
| `advanceTo(step, update?)` | Jumps to a specific step (used by InstallingScreen to reach `done` with task results) |

### Conditional Skip: `font_select`

The `font_select` step is only shown when the user chooses "install a font" on FontCheckScreen. This is controlled by a sentinel value:

```
FontCheckScreen → "No, install one for me"
  → sets nerdFontToInstall = FONT_SELECT_SENTINEL ('__select__')
  → goNext() sees sentinel, includes font_select

FontCheckScreen → "Yes, I already have one" / "No, use text symbols"
  → sets nerdFontToInstall = null
  → goNext() skips font_select, advances to preset
```

The same logic runs in reverse for `goBack()` — if the user never intended to visit `font_select` (`nerdFontToInstall === null`), pressing Esc from `preset` skips back over it.

### Progress Bar

`WizardLayout` renders a 10-step progress indicator:

```
● ● ◉ ○ ○ ○ ○ ○ ○ ○  4. Preset
```

- `●` green = completed
- `◉` cyan = current
- `○` gray = pending

Step labels are defined in `STEP_LABELS` inside `WizardLayout.tsx`.

---

## Data Flow

### State Shape

All wizard state lives in a single `WizardState` object held by `App` via `useState`:

```typescript
interface WizardState {
  step: WizardStep;
  starshipInstalled: boolean;
  hasNerdFont: boolean;
  preset: string | null;
  leftModules: string[];
  rightModules: string[];
  characterSymbol: CharacterSymbol;
  colorScheme: ColorScheme;
  selectedShells: ShellId[];
  packageManager: PackageManager;
  installedShells: ShellId[];
  nerdFontToInstall: string | null;
  setDefaultShell: ShellId | null;
  installResults: InstallTask[]; // Final task statuses from InstallingScreen
}
```

### Flow Pattern

```
App (owns state)
 │
 ├── passes state as read-only prop to active screen
 ├── passes callback props: onNext, onBack, onUpdate
 │
 └── Screen
      ├── reads state for display
      ├── calls onUpdate(partial) for live preview sync (no step change)
      └── calls onNext(partial) to commit changes and advance
```

### Which Screens Set Which State

| Screen                 | Fields Updated                                            |
| ---------------------- | --------------------------------------------------------- |
| WelcomeScreen          | `starshipInstalled`, `packageManager`                     |
| FontCheckScreen        | `hasNerdFont`, `nerdFontToInstall`                        |
| FontSelectScreen       | `nerdFontToInstall`                                       |
| PresetScreen           | `preset`, `leftModules`, `rightModules`                   |
| SegmentsScreen (left)  | `leftModules` (live via `onUpdate`)                       |
| SegmentsScreen (right) | `rightModules` (live via `onUpdate`)                      |
| StyleScreen            | `characterSymbol`, `colorScheme`                          |
| ShellScreen            | `selectedShells`, `installedShells`, `setDefaultShell`    |
| InstallingScreen       | `installResults` (passes final task list via `advanceTo`) |
| DoneScreen             | (reads `installResults` for status display)               |

### Live Preview Sync

Some screens push state changes in real time (without advancing) so `PromptPreview` updates as the user toggles options:

- **SegmentsScreen**: `useEffect` calls `onUpdate({ leftModules: [...] })` on every toggle
- **ShellScreen**: pushes `installedShells` after async detection completes
- **PresetScreen**: updates modules on highlight (before user confirms)

---

## Module System

Module definitions live in `src/config/modules.ts`. Each module has:

```typescript
interface ModuleDef {
  id: string;
  label: string;
  description: string;
  defaultLeft: boolean;
  defaultRight: boolean;
  previewSegment: (hasNerdFont: boolean) => string;
  formatKey: string;
}
```

The `character` module is special — it is never shown as a toggle in SegmentsScreen. Instead, it is always appended to the end of `leftModules` automatically.

---

## File Map

```
src/
├── index.tsx                  Entry point (Ink render)
├── app.tsx                    Root component, step machine, state owner
├── types.ts                   WizardState, enums, DEFAULT_STATE
├── config/
│   ├── modules.ts             Module definitions (16 modules)
│   ├── presets.ts             Preset definitions (12 presets)
│   └── shells.ts             Shell definitions (5 shells)
├── components/
│   ├── WizardLayout.tsx       Screen wrapper + progress bar
│   ├── PromptPreview.tsx      Live prompt preview
│   └── NavHints.tsx           Keyboard hint bar
├── screens/
│   ├── WelcomeScreen.tsx      System detection
│   ├── FontCheckScreen.tsx    Nerd Font question
│   ├── FontSelectScreen.tsx   Font picker
│   ├── PresetScreen.tsx       Preset picker
│   ├── SegmentsScreen.tsx     Module toggle list (used for left & right)
│   ├── StyleScreen.tsx        Character + color scheme picker
│   ├── ShellScreen.tsx        Shell toggle list
│   ├── InstallingScreen.tsx   Task runner with status display
│   └── DoneScreen.tsx         Summary and exit
├── generators/
│   ├── starship.ts            TOML config generation
│   └── shellRc.ts             RC file writing + starship.toml output
└── services/
    ├── detector.ts            System detection (PM, shells, Starship)
    └── installer.ts           Installation commands (Starship, fonts, shells)
```
