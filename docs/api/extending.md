# Extending

## Adding a Module

1. **`src/config/modules.ts`** — add the id to `ConfigurableModuleId` and an
   entry to `MODULE_DEFS`. Every module needs `label`, `description`,
   `previewSegment`, and `content` (the format the
   powerline generator wraps in separators); most also provide `settings`:

   ```typescript
   perl: {
     label: 'Perl',
     description: 'Perl version (shown in Perl projects)',
     ...symbolModule(() => '🐪 ', '5.38'), // previewSegment + settings
     content: '$symbol$version',
   },
   ```
2. **`src/config/palettes.ts`** — add a colour. `PaletteColorName` is keyed on
   `ConfigurableModuleId`, so every palette is a compile error until it picks a
   colour for the new module — this is deliberate. No other step: the generator
   emits the `[section]`, `style`, and powerline `format` keys itself.
3. **`src/components/PromptPreview.tsx`** — nothing to do. The preview reads
   `previewSegment()` from the same definition.

## Adding a Preset

**`src/config/presets.ts`** — add entry to `PRESETS` array with a `palette` and
`powerline` setting (name a palette no other preset uses, adding one first if
needed, so the preset renders differently):

```typescript
{
  id: 'minimal-monochrome',
  label: 'Minimal Monochrome',
  description: 'Single-color prompt, no icons',
  requiresNerdFont: false,
  leftModules: ['directory', 'git_branch', 'character'],
  rightModules: [],
  palette: 'monochrome', // a new palette; 'mono' already belongs to plain-text
  powerline: false,
}
```

PresetScreen reads from the `PRESETS` array directly. The golden test
(`src/__tests__/generators/golden.test.ts`) covers every preset, so run
`npx vitest run src/__tests__/generators/golden.test.ts -u` once to commit the
new fixture(s) under `src/__tests__/golden/`.

## Adding a Shell

1. **`src/types.ts`** — add to `ShellId` union
2. **`src/config/shells.ts`** — add to `SHELLS` array with `binary`, `rcFile`,
   `initLine`, and optional `manualNote`/`pathLine`. Shells without a script rc
   file (nushell, powershell) use `rcFile: null` and get a manual `initLine` shown
   on DoneScreen
3. **`src/services/installer.ts`** — add package name mappings to
   `SHELL_PACKAGES` (per package manager) for auto-install support
4. **`src/generators/rcLines.ts`** — add the shell's `starship init` command to
   `INIT_COMMAND`; an rc shell also needs a `configEnv` (export/unset syntax) in
   `SHELLS`
5. **`src/cli/help.ts`** — add it to the hard-coded `--shells` list in the `--help` text
6. **`src/services/detector.ts`** — no change needed: `detectInstalledShellsAsync`
   iterates `SHELLS` and checks each `binary`

## Adding a Palette

1. **`src/config/palettes.ts`** — add an entry to `PALETTE_DEFS` with a colour for
   every `PaletteColorName`. That is the only step: `PaletteId`, the `PALETTES`
   list, the StyleScreen picker, and the generated `[palettes.<id>]` table are all
   derived from it.

## Adding a Character Symbol

1. **`src/types.ts`** — add to `CharacterSymbol` union
2. **`src/config/promptSymbols.ts`** — add to `CHARACTER_SYMBOLS`, the single
   table the generator and the preview both read
3. **`src/screens/StyleScreen.tsx`** — add to `CHAR_OPTIONS` array
4. **`src/services/stateFlags.ts`** and **`src/services/state.ts`** — add to their
   accepted-symbol lists, and to the `--character` line in the `--help` text
   (`src/cli/help.ts`)
5. **`src/services/cliSurface.ts`** — add to the value list of `FLAGS.character`,
   which the shell completions offer
