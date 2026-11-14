import { CORE_MODULES, type ModuleId } from './modules.ts';
import type { PaletteId } from './palettes.ts';

export interface PresetDef {
  id: string;
  label: string;
  description: string;
  requiresNerdFont: boolean;
  // Overrides for left/right modules when this preset is selected
  leftModules: readonly ModuleId[];
  rightModules: readonly ModuleId[];
  /** The colour theme this preset starts from. Every preset names a different
   *  one, so no two presets generate the same colours. The Style screen seeds
   *  its picker from this and the user can then change it. */
  palette: PaletteId;
  /** Whether this preset draws segments as interlocking coloured blocks. */
  powerline: boolean;
  /** Text symbols only, even for a user whose terminal has a Nerd Font. */
  textOnly?: boolean;
  /** Wraps each segment in square brackets, e.g. `[main]`. */
  bracketed?: boolean;
}

export const PRESETS: PresetDef[] = [
  {
    id: 'custom',
    label: 'Custom (start from scratch)',
    description: 'Choose each option manually',
    requiresNerdFont: false,
    leftModules: CORE_MODULES,
    rightModules: [],
    palette: 'default',
    powerline: false,
  },
  {
    id: 'nerd-font-symbols',
    label: 'Nerd Font Symbols',
    description: 'Rich icons from Nerd Fonts in saturated brights',
    requiresNerdFont: true,
    leftModules: ['username', 'hostname', 'directory', 'git_branch', 'git_status', 'character'],
    rightModules: ['nodejs', 'python', 'rust', 'cmd_duration'],
    palette: 'vivid',
    powerline: false,
  },
  {
    id: 'no-nerd-font',
    label: 'No Nerd Font',
    description: 'Pure Unicode/text symbols in base ANSI colours',
    requiresNerdFont: false,
    leftModules: CORE_MODULES,
    rightModules: ['cmd_duration'],
    palette: 'terminal',
    powerline: false,
    textOnly: true,
  },
  {
    id: 'plain-text',
    label: 'Plain Text',
    description: 'Text symbols only, in white and grey, for maximum compatibility',
    requiresNerdFont: false,
    leftModules: CORE_MODULES,
    rightModules: [],
    palette: 'mono',
    powerline: false,
    textOnly: true,
  },
  {
    id: 'bracketed-segments',
    label: 'Bracketed Segments',
    description: '[module] format in desaturated tones',
    requiresNerdFont: false,
    leftModules: ['username', 'directory', 'git_branch', 'git_status', 'character'],
    rightModules: ['time'],
    palette: 'muted',
    powerline: false,
    bracketed: true,
  },
  {
    id: 'pure-prompt',
    label: 'Pure Prompt',
    description: 'Minimal two-line prompt inspired by the Pure zsh theme',
    requiresNerdFont: false,
    leftModules: ['directory', 'git_branch', 'character'],
    rightModules: ['cmd_duration'],
    palette: 'pure',
    powerline: false,
  },
  {
    id: 'pastel-powerline',
    label: 'Pastel Powerline',
    description: 'Soft pastel blocks with powerline separators',
    requiresNerdFont: true,
    leftModules: ['username', 'directory', 'git_branch', 'git_status', 'character'],
    rightModules: ['nodejs', 'python', 'cmd_duration', 'time'],
    palette: 'pastel',
    powerline: true,
  },
  {
    id: 'tokyo-night',
    label: 'Tokyo Night',
    description: 'Nerd Font icons in deep blues and purples, runtimes on the right',
    requiresNerdFont: true,
    leftModules: CORE_MODULES,
    rightModules: ['nodejs', 'python', 'cmd_duration'],
    palette: 'tokyo-night',
    powerline: false,
  },
  {
    id: 'gruvbox-rainbow',
    label: 'Gruvbox Rainbow',
    description: 'Warm earth-tone powerline, a colour per segment',
    requiresNerdFont: true,
    leftModules: ['username', 'hostname', 'directory', 'git_branch', 'git_status', 'character'],
    rightModules: ['nodejs', 'rust', 'cmd_duration'],
    palette: 'gruvbox',
    powerline: true,
  },
  {
    id: 'jetpack',
    label: 'Jetpack',
    description: 'Pseudo-minimalist teals, inspired by Geometry/Spaceship',
    requiresNerdFont: true,
    leftModules: CORE_MODULES,
    rightModules: ['cmd_duration', 'time'],
    palette: 'jetpack',
    powerline: false,
  },
  {
    id: 'catppuccin-powerline',
    label: 'Catppuccin Powerline',
    description: 'Soothing mocha pastels with powerline separators',
    requiresNerdFont: true,
    leftModules: ['username', 'directory', 'git_branch', 'git_status', 'character'],
    rightModules: ['nodejs', 'python', 'cmd_duration'],
    palette: 'catppuccin',
    powerline: true,
  },
  {
    id: 'no-runtime-versions',
    label: 'No Runtime Versions',
    description: 'Cool greys, hides language versions (ideal for containers)',
    requiresNerdFont: false,
    leftModules: CORE_MODULES,
    rightModules: [],
    palette: 'slate',
    powerline: false,
  },
];

/**
 * Whether the prompt may use Nerd Font glyphs: the terminal must have the font
 * and the chosen preset must not be a text-only one.
 */
export function rendersGlyphs(state: { hasNerdFont: boolean; preset: string | null }): boolean {
  return state.hasNerdFont && !PRESETS.find((p) => p.id === state.preset)?.textOnly;
}

type GlyphState = { hasNerdFont: boolean; preset: string | null; powerline: boolean };

/** Whether powerline separators are drawn: they are Nerd Font glyphs too. */
export function drawsPowerline(state: GlyphState): boolean {
  return state.powerline && rendersGlyphs(state);
}

/** Why powerline was asked for but will not be drawn, or null when it will be (or was not asked for). */
export function powerlineDroppedReason(state: GlyphState): string | null {
  if (!state.powerline || drawsPowerline(state)) return null;
  if (!state.hasNerdFont) return 'Powerline separators need a Nerd Font';
  const label = PRESETS.find((p) => p.id === state.preset)?.label ?? state.preset;
  return `The ${label} preset uses text symbols only, so it has no powerline separators`;
}

/** Whether segments are drawn as `[content]`: the bracketed preset, without powerline. */
export function bracketsSegments(state: { preset: string | null; powerline: boolean }): boolean {
  return !state.powerline && Boolean(PRESETS.find((p) => p.id === state.preset)?.bracketed);
}
