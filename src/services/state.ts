import type { ModuleId } from '../config/modules.ts';
import type { PaletteId } from '../config/palettes.ts';
import {
  type CharacterSymbol,
  type NerdFontChoice,
  NO_NERD_FONT,
  type ShellId,
  type WizardState,
} from '../types.ts';

/**
 * The public, versioned state-card format (D2). A card captures only what the
 * user *decided* — never wizard runtime (step, detection results, task state) —
 * so the same card produces the same prompt on any machine. The interactive
 * wizard and the headless CLI share these shapes, and `#14` rollback will store
 * the very card an install applied.
 *
 * `version` is bumped on any breaking change to the shape; `parseState` refuses
 * cards it does not understand rather than silently misreading them.
 */

export const STATE_VERSION = 1;

export interface StateCard {
  version: number;
  wizard: {
    preset: string | null;
    leftModules: ModuleId[];
    rightModules: ModuleId[];
    characterSymbol: CharacterSymbol;
    palette: PaletteId;
    /** Interlocking coloured blocks; requires a Nerd Font to render. */
    powerline: boolean;
    selectedShells: ShellId[];
    nerdFontToInstall: NerdFontChoice;
    setDefaultShell: ShellId | null;
    skipStarshipInstall: boolean;
    /** Whether the generating machine renders Nerd Font glyphs already. */
    hasNerdFont: boolean;
  };
}

const CORE_MODULES: ModuleId[] = ['directory', 'git_branch', 'git_status', 'character'];

/** The runtime fields a parsed card starts with; detection fills them per run. */
function runtimeDefaults(): Pick<
  WizardState,
  | 'step'
  | 'starshipInstalled'
  | 'hasNerdFont'
  | 'packageManager'
  | 'installedShells'
  | 'dryRun'
  | 'installResults'
> {
  return {
    step: 'welcome',
    starshipInstalled: false,
    hasNerdFont: false,
    packageManager: 'script',
    installedShells: [],
    dryRun: false,
    installResults: [],
  };
}

/** Serializes the user choices of a wizard state into a versioned card. */
export function serializeState(state: WizardState): string {
  const card: StateCard = {
    version: STATE_VERSION,
    wizard: {
      preset: state.preset,
      leftModules: state.leftModules,
      rightModules: state.rightModules,
      characterSymbol: state.characterSymbol,
      palette: state.palette,
      powerline: state.powerline,
      selectedShells: state.selectedShells,
      nerdFontToInstall: state.nerdFontToInstall,
      setDefaultShell: state.setDefaultShell,
      skipStarshipInstall: state.skipStarshipInstall,
      hasNerdFont: state.hasNerdFont,
    },
  };
  return `${JSON.stringify(card, null, 2)}\n`;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/**
 * Parses a state card into a wizard state. Fails loudly on an unknown version
 * (a card written by a newer tool) rather than guessing. Present-but-malformed
 * fields fall back to their defaults so a hand-edited card degrades instead of
 * crashing the generator.
 */
export function parseState(json: string): WizardState {
  let card: unknown;
  try {
    card = JSON.parse(json);
  } catch {
    throw new Error('Invalid state card: not valid JSON');
  }

  const version = (card as StateCard | null)?.version;
  if (version !== STATE_VERSION) {
    throw new Error(
      `Unsupported state card version: ${String(version)} (expected ${STATE_VERSION}). ` +
        `This card was written by a newer ShellConfigurator; upgrade to read it.`
    );
  }

  const wizard = (card as StateCard).wizard;
  if (!wizard || typeof wizard !== 'object') {
    throw new Error('Invalid state card: missing wizard object');
  }

  const nerdFont = wizard.nerdFontToInstall;
  const selectedShells = isStringArray(wizard.selectedShells)
    ? (wizard.selectedShells as ShellId[])
    : [];

  return {
    ...runtimeDefaults(),
    preset: typeof wizard.preset === 'string' ? wizard.preset : null,
    leftModules:
      isStringArray(wizard.leftModules) && wizard.leftModules.length > 0
        ? (wizard.leftModules as ModuleId[])
        : CORE_MODULES,
    rightModules: isStringArray(wizard.rightModules) ? (wizard.rightModules as ModuleId[]) : [],
    characterSymbol:
      wizard.characterSymbol === 'lambda' || wizard.characterSymbol === 'dollar'
        ? wizard.characterSymbol
        : 'arrow',
    palette: typeof wizard.palette === 'string' ? (wizard.palette as PaletteId) : 'default',
    powerline: wizard.powerline === true,
    selectedShells,
    nerdFontToInstall:
      nerdFont && typeof nerdFont === 'object' && 'kind' in nerdFont
        ? (nerdFont as NerdFontChoice)
        : NO_NERD_FONT,
    setDefaultShell: typeof wizard.setDefaultShell === 'string' ? wizard.setDefaultShell : null,
    skipStarshipInstall: wizard.skipStarshipInstall === true,
    hasNerdFont: wizard.hasNerdFont === true,
  };
}
