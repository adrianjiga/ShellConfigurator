export interface PresetDef {
  id: string;
  label: string;
  description: string;
  requiresNerdFont: boolean;
  // Overrides for left/right modules when this preset is selected
  leftModules?: string[];
  rightModules?: string[];
}

export const PRESETS: PresetDef[] = [
  {
    id: 'custom',
    label: 'Custom (start from scratch)',
    description: 'Choose each option manually',
    requiresNerdFont: false,
    leftModules: ['directory', 'git_branch', 'git_status', 'character'],
    rightModules: [],
  },
  {
    id: 'nerd-font-symbols',
    label: 'Nerd Font Symbols',
    description: 'Rich icons from Nerd Fonts for every module',
    requiresNerdFont: true,
    leftModules: ['username', 'hostname', 'directory', 'git_branch', 'git_status', 'character'],
    rightModules: ['nodejs', 'python', 'rust', 'cmd_duration'],
  },
  {
    id: 'no-nerd-font',
    label: 'No Nerd Font',
    description: 'Pure Unicode/text symbols, broadly compatible',
    requiresNerdFont: false,
    leftModules: ['directory', 'git_branch', 'git_status', 'character'],
    rightModules: ['cmd_duration'],
  },
  {
    id: 'plain-text',
    label: 'Plain Text',
    description: 'ASCII-only, maximum compatibility',
    requiresNerdFont: false,
    leftModules: ['directory', 'git_branch', 'git_status', 'character'],
    rightModules: [],
  },
  {
    id: 'bracketed-segments',
    label: 'Bracketed Segments',
    description: '[module] format — clean and readable',
    requiresNerdFont: false,
    leftModules: ['username', 'directory', 'git_branch', 'git_status', 'character'],
    rightModules: ['time'],
  },
  {
    id: 'pure-prompt',
    label: 'Pure Prompt',
    description: 'Minimal, emulates the Pure zsh theme',
    requiresNerdFont: false,
    leftModules: ['directory', 'git_branch', 'character'],
    rightModules: ['cmd_duration'],
  },
  {
    id: 'pastel-powerline',
    label: 'Pastel Powerline',
    description: 'Colorful powerline with path substitution',
    requiresNerdFont: true,
    leftModules: ['username', 'directory', 'git_branch', 'git_status', 'character'],
    rightModules: ['nodejs', 'python', 'cmd_duration', 'time'],
  },
  {
    id: 'tokyo-night',
    label: 'Tokyo Night',
    description: 'Dark theme with blue/purple tones',
    requiresNerdFont: true,
    leftModules: ['directory', 'git_branch', 'git_status', 'character'],
    rightModules: ['nodejs', 'python', 'cmd_duration'],
  },
  {
    id: 'gruvbox-rainbow',
    label: 'Gruvbox Rainbow',
    description: 'Warm earth-tone powerline colors',
    requiresNerdFont: true,
    leftModules: ['username', 'hostname', 'directory', 'git_branch', 'git_status', 'character'],
    rightModules: ['nodejs', 'rust', 'cmd_duration'],
  },
  {
    id: 'jetpack',
    label: 'Jetpack',
    description: 'Pseudo-minimalist, inspired by Geometry/Spaceship',
    requiresNerdFont: true,
    leftModules: ['directory', 'git_branch', 'git_status', 'character'],
    rightModules: ['cmd_duration', 'time'],
  },
  {
    id: 'catppuccin-powerline',
    label: 'Catppuccin Powerline',
    description: 'Soothing pastel palette',
    requiresNerdFont: true,
    leftModules: ['username', 'directory', 'git_branch', 'git_status', 'character'],
    rightModules: ['nodejs', 'python', 'cmd_duration'],
  },
  {
    id: 'no-runtime-versions',
    label: 'No Runtime Versions',
    description: 'Hides language version numbers (ideal for containers)',
    requiresNerdFont: false,
    leftModules: ['directory', 'git_branch', 'git_status', 'character'],
    rightModules: [],
  },
];
