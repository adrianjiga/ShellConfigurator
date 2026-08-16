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

The wizard is a linear state machine defined by the `STEP_ORDER` array in `src/types.ts`:

```
welcome → fontcheck → font_select → preset → segments_left → segments_right → style → shells → installing → done
```

The navigation logic itself lives in `src/stepMachine.ts` as two pure functions, so the core flow is unit-testable without rendering the TUI:

### Navigation Functions

| Function                      | Behavior                                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `getNextStep(state, update?)` | Pure — merges `update`, advances to the next step, honoring the conditional `font_select` skip |
| `getPrevStep(state)`          | Pure — moves to the previous step, honoring the conditional `font_select` skip                 |

`src/app.tsx` wraps these in state setters: `goNext(update?)` calls `getNextStep` via a functional `setState` updater, `goBack()` calls `getPrevStep`. `advanceTo(step, update?)` jumps straight to a step (used by InstallingScreen to reach `done` with task results).

Both directions use the single `shouldVisitFontSelect(nerdFontToInstall)` predicate from `src/types.ts` — there is no duplicated skip logic.

### Conditional Skip: `font_select`

The `font_select` step is only shown when the user chooses "install a font" on FontCheckScreen. This is controlled by the `NerdFontChoice` union:

```
FontCheckScreen → "No, install one for me"
  → sets nerdFontToInstall = { kind: 'select' }
  → shouldVisitFontSelect() returns true, includes font_select

FontCheckScreen → "Yes, I already have one" / "No, use text symbols"
  → sets nerdFontToInstall = { kind: 'none' }
  → shouldVisitFontSelect() returns false, skips font_select, advances to preset
```

The same predicate runs in reverse for `getPrevStep()` — if the user never intended to visit `font_select`, pressing Esc from `preset` skips back over it.

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
  nerdFontToInstall: NerdFontChoice;
  setDefaultShell: ShellId | null;
  skipStarshipInstall: boolean; // "Continue without Starship" — skip install + RC steps
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

| Screen                 | Fields Updated                                                            |
| ---------------------- | ------------------------------------------------------------------------- |
| WelcomeScreen          | `starshipInstalled`, `packageManager`, `skipStarshipInstall`              |
| FontCheckScreen        | `hasNerdFont`, `nerdFontToInstall`                                        |
| FontSelectScreen       | `nerdFontToInstall`                                                       |
| PresetScreen           | `preset`, `leftModules`, `rightModules`                                   |
| SegmentsScreen (left)  | `leftModules` (live via `onUpdate`)                                       |
| SegmentsScreen (right) | `rightModules` (live via `onUpdate`)                                      |
| StyleScreen            | `characterSymbol`, `colorScheme`                                          |
| ShellScreen            | `selectedShells`, `installedShells`, `setDefaultShell`                    |
| InstallingScreen       | `installResults` (final task list passed via `advanceTo('done', update)`) |
| DoneScreen             | (reads `installResults` for status display)                               |

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
}
```

The `character` module is special — it is never shown as a toggle in SegmentsScreen. Instead, it is always appended to the end of `leftModules` automatically.

---

## File Map

```
src/
├── index.tsx                  Entry point (Ink render)
├── app.tsx                    Root component, state owner, step navigation wiring
├── stepMachine.ts             Pure getNextStep/getPrevStep step navigation
├── types.ts                   WizardState, enums, STEP_ORDER, DEFAULT_STATE
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
│   ├── InstallingScreen.tsx   Renders install progress (runs installTasks service)
│   └── DoneScreen.tsx         Summary and exit
├── generators/
│   ├── starship.ts            TOML config generation
│   └── shellRc.ts             RC file writing + starship.toml output
└── services/
    ├── detector.ts            System detection (PM, shells, Starship)
    ├── installer.ts           Installation commands (Starship, fonts, shells)
    └── installTasks.ts        Install task orchestration (buildTaskList, runInstallTasks)
```
