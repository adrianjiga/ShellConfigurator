import { clampTruncationLength, DEFAULT_TRUNCATION_LENGTH } from '../config/directory.ts';
import { CORE_MODULES, getModule, type ModuleId } from '../config/modules.ts';
import { PALETTES, type PaletteId } from '../config/palettes.ts';
import { PRESETS } from '../config/presets.ts';
import { SHELLS } from '../config/shells.ts';
import {
  type CharacterSymbol,
  type ContinuationPrompt,
  type DirectorySubstitution,
  type NerdFontChoice,
  NO_NERD_FONT,
  type ShellId,
  type WizardState,
} from '../types.ts';
import { CliUsageError } from './errors.ts';

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
    /** Marker for wrapped input lines. */
    continuationPrompt: ContinuationPrompt;
    /** Blank line before each prompt. */
    addNewline: boolean;
    /** Distinct character while the shell is in vim normal mode. */
    vimMode: boolean;
    /** Parent folders shown by the directory module; `0` shows the full path. */
    directoryTruncationLength: number;
    /** Folder renames applied to the directory path. */
    directorySubstitutions: DirectorySubstitution[];
    selectedShells: ShellId[];
    nerdFontToInstall: NerdFontChoice;
    setDefaultShell: ShellId | null;
    skipStarshipInstall: boolean;
    /** Whether the shell should keep the shared starship.toml (adopt mode)
     *  instead of a regenerated per-shell config. */
    keepExistingConfig: boolean;
    /** Whether the generating machine renders Nerd Font glyphs already. */
    hasNerdFont: boolean;
  };
}

const CORE_MODULES_DEFAULT = [...CORE_MODULES];

/** The runtime fields a parsed card starts with; detection fills them per run. */
function runtimeDefaults(): Pick<
  WizardState,
  | 'step'
  | 'hasNerdFont'
  | 'packageManager'
  | 'installedShells'
  | 'terminal'
  | 'container'
  | 'dryRun'
  | 'installResults'
  | 'sharedConfigToml'
> {
  return {
    step: 'welcome',
    hasNerdFont: false,
    packageManager: 'script',
    installedShells: [],
    terminal: null,
    container: false,
    dryRun: false,
    installResults: [],
    sharedConfigToml: null,
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
      continuationPrompt: state.continuationPrompt,
      addNewline: state.addNewline,
      vimMode: state.vimMode,
      directoryTruncationLength: state.directoryTruncationLength,
      directorySubstitutions: state.directorySubstitutions,
      selectedShells: state.selectedShells,
      nerdFontToInstall: state.nerdFontToInstall,
      setDefaultShell: state.setDefaultShell,
      skipStarshipInstall: state.skipStarshipInstall,
      keepExistingConfig: state.keepExistingConfig,
      hasNerdFont: state.hasNerdFont,
    },
  };
  return `${JSON.stringify(card, null, 2)}\n`;
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === 'string');

const SHELL_IDS = new Set<string>(SHELLS.map((shell) => shell.id));

function parseBoolean(value: unknown, field: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') {
    throw new CliUsageError(`Invalid state card: ${field} must be true or false`);
  }
  return value;
}

/** Null when absent; otherwise the value must be one of `allowed`. */
function parseOptionalChoice<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[]
): T | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new CliUsageError(
      `Invalid state card: ${field} '${String(value)}' is not one of ${allowed.join(', ')}`
    );
  }
  return value as T;
}

function parseTruncationLength(value: unknown): number {
  if (value === undefined) return DEFAULT_TRUNCATION_LENGTH;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new CliUsageError('Invalid state card: directoryTruncationLength must be a number');
  }
  return clampTruncationLength(value);
}

function parseShellList(value: unknown): ShellId[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new CliUsageError('Invalid state card: selectedShells must be an array of shell ids');
  }
  const parsed = new Set<ShellId>();
  for (const id of value) {
    if (typeof id !== 'string') {
      throw new CliUsageError(
        `Invalid state card: selectedShells entry ${String(id)} is not a shell id`
      );
    }
    if (!SHELL_IDS.has(id)) {
      throw new CliUsageError(`Invalid state card: unknown shell '${id}' in selectedShells`);
    }
    parsed.add(id as ShellId);
  }
  return [...parsed];
}

function parseModuleList(value: unknown, slot: 'left' | 'right'): ModuleId[] | null {
  if (value === undefined || value === null) return null;
  if (!isStringArray(value)) {
    throw new CliUsageError(`Invalid state card: ${slot}Modules must be an array of module ids`);
  }

  const parsed = new Set<ModuleId>();
  for (const id of value) {
    if (id === 'character' && slot === 'right') {
      throw new CliUsageError(
        "Invalid state card: 'character' belongs in leftModules, not rightModules"
      );
    }
    if (id === 'character' || getModule(id)) {
      parsed.add(id as ModuleId);
    } else {
      throw new CliUsageError(`Invalid state card: unknown module '${id}' in ${slot}Modules`);
    }
  }
  return [...parsed];
}

/**
 * Reads a card's `directory.substitutions`. Malformed entries are dropped
 * rather than failing the whole card, matching how the other optional fields
 * degrade; a duplicate source keeps the last entry, as TOML would.
 */
function parseSubstitutionList(value: unknown): DirectorySubstitution[] {
  if (!Array.isArray(value)) return [];

  const parsed = new Map<string, DirectorySubstitution>();
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const from = (entry as { from?: unknown }).from;
    const to = (entry as { to?: unknown }).to;
    if (typeof from !== 'string' || from.length === 0 || typeof to !== 'string') continue;
    parsed.set(from, { from, to });
  }
  return [...parsed.values()];
}

/**
 * Resolves a card's `nerdFontToInstall` to a concrete choice. `none` and
 * missing degrade to the no-font default; anything `kind`-shaped that cannot
 * produce a runnable choice is a hard error instead of being passed through to
 * the installer as garbage.
 */
function parseNerdFontChoice(value: unknown): NerdFontChoice {
  if (value === undefined || value === null) return NO_NERD_FONT;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new CliUsageError('Invalid state card: nerdFontToInstall must be an object');
  }
  const kind = (value as { kind?: unknown }).kind;
  if (kind === undefined) {
    throw new CliUsageError(
      'Invalid state card: nerdFontToInstall needs a kind (none, select or install)'
    );
  }
  if (kind === 'none') return NO_NERD_FONT;
  if (kind === 'select') return { kind: 'select' };
  if (kind === 'install') {
    const id = (value as { id?: unknown }).id;
    if (typeof id !== 'string' || id.length === 0) {
      throw new CliUsageError(
        "Invalid state card: nerdFontToInstall kind 'install' requires a font id"
      );
    }
    return { kind: 'install', id };
  }
  throw new CliUsageError(`Invalid state card: unknown nerdFontToInstall kind '${String(kind)}'`);
}

/**
 * Parses a state card into a wizard state. Fails loudly on an unknown version
 * (a card written by a newer tool) rather than guessing. Present-but-malformed
 * fields fall back to their defaults so a hand-edited card degrades instead of
 * crashing the generator; a structurally broken `nerdFontToInstall` is a hard
 * error because an `{kind:'install'}` without an id crashes the installer.
 */
export function parseState(json: string): WizardState {
  let card: unknown;
  try {
    card = JSON.parse(json.replace(/^\uFEFF/, ''));
  } catch {
    throw new CliUsageError('Invalid state card: not valid JSON');
  }

  const version = (card as StateCard | null)?.version;
  if (version !== STATE_VERSION) {
    const clue =
      typeof version === 'number' && version < STATE_VERSION
        ? 'This card was written by an older ShellConfigurator; regenerate it with this version.'
        : 'This card was written by a newer ShellConfigurator; upgrade to read it.';
    throw new CliUsageError(
      `Unsupported state card version: ${String(version)} (expected ${STATE_VERSION}). ${clue}`
    );
  }

  const wizard = (card as StateCard).wizard;
  if (!wizard || typeof wizard !== 'object' || Array.isArray(wizard)) {
    throw new CliUsageError('Invalid state card: missing wizard object');
  }

  const selectedShells = parseShellList(wizard.selectedShells);
  const parsedLeftModules = parseModuleList(wizard.leftModules, 'left');
  const leftModules = parsedLeftModules ?? [...CORE_MODULES_DEFAULT];
  const leftModuleSet = new Set(leftModules);
  const rightModules = (parseModuleList(wizard.rightModules, 'right') ?? []).filter(
    (id) => !leftModuleSet.has(id)
  );

  return {
    ...runtimeDefaults(),
    preset: parseOptionalChoice(
      wizard.preset,
      'preset',
      PRESETS.map((preset) => preset.id)
    ),
    leftModules,
    rightModules,
    characterSymbol:
      parseOptionalChoice<CharacterSymbol>(wizard.characterSymbol, 'characterSymbol', [
        'arrow',
        'lambda',
        'dollar',
      ]) ?? 'arrow',
    palette:
      parseOptionalChoice<PaletteId>(
        wizard.palette,
        'palette',
        PALETTES.map((palette) => palette.id)
      ) ?? 'default',
    powerline: parseBoolean(wizard.powerline, 'powerline', false),
    continuationPrompt:
      parseOptionalChoice<ContinuationPrompt>(wizard.continuationPrompt, 'continuationPrompt', [
        'dot',
        'arrow',
        'none',
      ]) ?? 'dot',
    // Absent means "the starship default", which is on.
    addNewline: parseBoolean(wizard.addNewline, 'addNewline', true),
    vimMode: parseBoolean(wizard.vimMode, 'vimMode', false),
    directoryTruncationLength: parseTruncationLength(wizard.directoryTruncationLength),
    directorySubstitutions: parseSubstitutionList(wizard.directorySubstitutions),
    selectedShells,
    nerdFontToInstall: parseNerdFontChoice(wizard.nerdFontToInstall),
    setDefaultShell: parseOptionalChoice(wizard.setDefaultShell, 'setDefaultShell', [
      ...SHELL_IDS,
    ] as ShellId[]),
    skipStarshipInstall: parseBoolean(wizard.skipStarshipInstall, 'skipStarshipInstall', false),
    keepExistingConfig: parseBoolean(wizard.keepExistingConfig, 'keepExistingConfig', false),
    hasNerdFont: parseBoolean(wizard.hasNerdFont, 'hasNerdFont', false),
  };
}
