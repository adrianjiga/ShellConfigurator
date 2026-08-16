import type { ModuleId } from './modules.ts';
import type { PaletteId } from './palettes.ts';

export interface PresetDef {
  id: string;
  label: string;
  description: string;
  requiresNerdFont: boolean;
  // Overrides for left/right modules when this preset is selected
  leftModules?: ModuleId[];
  rightModules?: ModuleId[];
  /** The colour theme this preset starts from. Every preset names a different
   *  one, so no two presets generate the same colours. The Style screen seeds
   *  its picker from this and the user can then change it. */
  palette: PaletteId;
  /** Whether this preset draws segments as interlocking coloured blocks. */
  powerline: boolean;
}

export const PRESETS: PresetDef[] = [
  {
    id: 'custom',
    label: 'Custom (start from scratch)',
    description: 'Choose each option manually',
    requiresNerdFont: false,
    leftModules: ['directory', 'git_branch', 'git_status', 'character'],
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
    leftModules: ['directory', 'git_branch', 'git_status', 'character'],
    rightModules: ['cmd_duration'],
    palette: 'terminal',
    powerline: false,
  },
  {
    id: 'plain-text',
    label: 'Plain Text',
    description: 'ASCII-only in white and grey, maximum compatibility',
    requiresNerdFont: false,
    leftModules: ['directory', 'git_branch', 'git_status', 'character'],
    rightModules: [],
    palette: 'mono',
    powerline: false,
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
  },
  {
    id: 'pure-prompt',
    label: 'Pure Prompt',
    description: 'Minimal, emulates the Pure zsh theme',
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
    description: 'Dark theme with blue and purple tones',
    requiresNerdFont: true,
    leftModules: ['directory', 'git_branch', 'git_status', 'character'],
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
    leftModules: ['directory', 'git_branch', 'git_status', 'character'],
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
    leftModules: ['directory', 'git_branch', 'git_status', 'character'],
    rightModules: [],
    palette: 'slate',
    powerline: false,
  },
];
