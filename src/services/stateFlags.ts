import * as fs from 'node:fs';
import { MODULES } from '../config/modules.ts';
import { PALETTES } from '../config/palettes.ts';
import { PRESETS, powerlineDroppedReason } from '../config/presets.ts';
import { SHELLS } from '../config/shells.ts';
import { type CharacterSymbol, DEFAULT_STATE, type ShellId, type WizardState } from '../types.ts';
import type { CliFlags } from './args.ts';
import { CliUsageError, errorMessage } from './errors.ts';
import { NERD_FONTS } from './installer.ts';
import { parseState } from './state.ts';

const SHELL_IDS = new Set<string>(SHELLS.map((s) => s.id));

const MODULE_IDS = new Set<string>([...MODULES.map((m) => m.id), 'character']);

const PRESET_IDS = PRESETS.map((p) => p.id);

const PALETTE_IDS: string[] = PALETTES.map((p) => p.id);

const CHARACTER_SYMBOLS: readonly CharacterSymbol[] = ['arrow', 'lambda', 'dollar'];

const FONT_IDS = new Set<string>(NERD_FONTS.map((f) => f.id));

function unknown(what: string, value: string, valid: readonly string[]): CliUsageError {
  return new CliUsageError(`Unknown ${what}: '${value}' (expected one of: ${valid.join(', ')})`);
}

/**
 * Fail-fast validation of the public flag surface (D2). Every value that can
 * reach the generator must be one it understands: a typo'd `--preset`,
 * `--palette`, `--character`, `--set-default`, `--shells` or `--font` must
 * error before any install work, not crash deep in the generator with a
 * confusing TypeError or silently change the result.
 */
export function validateFlagValues(flags: CliFlags): void {
  if (flags.shells) {
    for (const shell of flags.shells) {
      if (!SHELL_IDS.has(shell)) throw unknown('shell id (--shells)', shell, [...SHELL_IDS]);
    }
  }
  if (flags.preset && !PRESET_IDS.includes(flags.preset)) {
    throw unknown('preset (--preset)', flags.preset, PRESET_IDS);
  }
  if (flags.palette && !PALETTE_IDS.includes(flags.palette)) {
    throw unknown('palette (--palette)', flags.palette, PALETTE_IDS);
  }
  if (
    flags.characterSymbol &&
    !CHARACTER_SYMBOLS.includes(flags.characterSymbol as CharacterSymbol)
  ) {
    throw unknown('character symbol (--character)', flags.characterSymbol, [...CHARACTER_SYMBOLS]);
  }
  if (flags.setDefaultShell && !SHELL_IDS.has(flags.setDefaultShell)) {
    throw unknown('shell id (--set-default)', flags.setDefaultShell, [...SHELL_IDS]);
  }
  if (flags.font && flags.font !== 'none' && !FONT_IDS.has(flags.font)) {
    throw unknown('Nerd Font (--font)', flags.font, ['none', ...FONT_IDS]);
  }
}

/**
 * Same fail-fast discipline for the merged flags-and-card state: the card parser
 * checks each value on its own, but only the merged state shows an unknown font
 * id, a default shell that is not being configured, or a font left to the picker.
 */
function assertValidState(state: WizardState): void {
  if (state.preset !== null && !PRESET_IDS.includes(state.preset)) {
    throw unknown('preset', state.preset, PRESET_IDS);
  }
  if (!PALETTE_IDS.includes(state.palette)) {
    throw unknown('palette', state.palette, PALETTE_IDS);
  }
  if (!CHARACTER_SYMBOLS.includes(state.characterSymbol)) {
    throw unknown('character symbol', state.characterSymbol, [...CHARACTER_SYMBOLS]);
  }
  for (const moduleId of [...state.leftModules, ...state.rightModules]) {
    if (!MODULE_IDS.has(moduleId)) throw unknown('module', moduleId, [...MODULE_IDS]);
  }
  if (state.setDefaultShell !== null && !SHELL_IDS.has(state.setDefaultShell)) {
    throw unknown('shell id (--set-default)', state.setDefaultShell, [...SHELL_IDS]);
  }
  for (const shell of state.selectedShells) {
    if (!SHELL_IDS.has(shell)) throw unknown('shell id', shell, [...SHELL_IDS]);
  }
  if (state.setDefaultShell !== null && !state.selectedShells.includes(state.setDefaultShell)) {
    throw new CliUsageError(
      `Cannot set '${state.setDefaultShell}' as the default shell: it is not one of the ` +
        `shells being configured (${state.selectedShells.join(', ') || 'none'}).`
    );
  }
  const font = state.nerdFontToInstall;
  if (font.kind === 'install' && !FONT_IDS.has(font.id)) {
    throw unknown('Nerd Font', font.id, [...FONT_IDS]);
  }
  if (font.kind === 'select') {
    throw new CliUsageError(
      'The state card defers the font choice to the interactive picker; pass --font <id> or --font none instead.'
    );
  }
}

/**
 * Builds a WizardState from CLI flags (and optionally a state card), reusing the
 * exact decisions the wizard makes:
 *
 * - a `--preset` seeds left/right modules, palette and powerline, exactly like
 *   choosing it on the Preset screen;
 * - every explicit flag then overrides the card/preset value;
 * - runtime fields (package manager, installed shells, step) stay at their
 *   defaults — `apply` fills those via detection before running.
 */
export function stateFromFlags(flags: CliFlags): WizardState {
  validateFlagValues(flags);
  let state: WizardState;
  if (flags.stateFile) {
    let json: string;
    try {
      json = fs.readFileSync(flags.stateFile, 'utf8');
    } catch (err) {
      throw new CliUsageError(
        `Could not read state card '${flags.stateFile}': ${errorMessage(err)}`
      );
    }
    state = parseState(json);
  } else {
    state = { ...DEFAULT_STATE };
  }

  if (flags.preset) {
    const preset = PRESETS.find((p) => p.id === flags.preset)!;
    state = {
      ...state,
      preset: preset.id,
      leftModules: [...preset.leftModules],
      rightModules: [...preset.rightModules],
      palette: preset.palette,
      powerline: preset.powerline,
    };
    // A preset that needs Nerd Font glyphs implies the machine renders them —
    // the wizard only offers those presets to users who already have a font.
    // An explicit --has-nerd-font / --no-nerd-font (or a later --font) still wins.
    if (flags.hasNerdFont === undefined && !flags.stateFile) {
      state = { ...state, hasNerdFont: preset.requiresNerdFont };
    }
  }

  if (flags.palette) state = { ...state, palette: flags.palette as WizardState['palette'] };
  if (flags.powerline !== undefined) state = { ...state, powerline: flags.powerline };
  if (flags.shells) {
    const shells = [...new Set(flags.shells)] as ShellId[];
    state = { ...state, selectedShells: shells };
  }
  if (flags.characterSymbol) {
    state = { ...state, characterSymbol: flags.characterSymbol as CharacterSymbol };
  }
  if (flags.setDefaultShell) {
    state = { ...state, setDefaultShell: flags.setDefaultShell as ShellId };
  }
  if (flags.skipStarship) state = { ...state, skipStarshipInstall: true };
  if (flags.hasNerdFont !== undefined) state = { ...state, hasNerdFont: flags.hasNerdFont };
  if (flags.adopt) state = { ...state, keepExistingConfig: true };

  if (flags.font) {
    state = {
      ...state,
      nerdFontToInstall:
        flags.font === 'none' ? { kind: 'none' } : { kind: 'install', id: flags.font },
    };
    // Choosing a concrete font implies the machine will render its glyphs; an
    // explicit --has-nerd-font / --no-nerd-font still wins.
    if (flags.hasNerdFont === undefined) {
      state = { ...state, hasNerdFont: flags.font !== 'none' };
    }
  }

  assertValidState(state);
  const droppedPowerline = powerlineDroppedReason(state);
  if (droppedPowerline) {
    process.stderr.write(
      `shell-configurator: warning: ${droppedPowerline}; a plain prompt will be generated.\n`
    );
  }
  return state;
}
