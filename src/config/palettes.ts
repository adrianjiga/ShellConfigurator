import type { ConfigurableModuleId } from './modules.ts';

/**
 * Named colour palettes — one per preset, so no two presets render alike.
 *
 * A palette gives every module its own colour rather than grouping modules into
 * shared roles. That costs a wider table here, but it is what makes a powerline
 * prompt read as distinct blocks (adjacent segments sharing a colour would merge
 * into one), and it is the only way "Gruvbox Rainbow" can actually rainbow.
 *
 * The generator emits the chosen palette as a starship `[palettes.<id>]` table and
 * refers to colours by name, so the generated config stays readable and a user can
 * retune a whole theme by editing one table.
 *
 * Colour values are written in starship's own notation — a hex literal, or one of
 * its named colours. Ink spells a few of those names differently, so the preview
 * translates them via `inkColor` below rather than storing every colour twice.
 */

/**
 * The colours a palette defines: one per module, plus three that are not modules.
 *
 * Keying on `ConfigurableModuleId` is deliberate — adding a module turns every
 * palette into a compile error until it picks a colour, which is the same
 * type-forces-the-data discipline `MODULE_DEFS` uses for module ids.
 */
export type PaletteColorName =
  | ConfigurableModuleId
  /** Text drawn on top of a module colour used as a background (powerline only). */
  | 'fg'
  /** The prompt character after a successful command. */
  | 'ok'
  /** The prompt character after a failure, and the root username. */
  | 'err';

export interface PaletteDef {
  id: string;
  label: string;
  description: string;
  colors: Record<PaletteColorName, string>;
}

const PALETTE_DEFS = {
  default: {
    label: 'Default',
    description: 'Bold blues, purples, and greens from your terminal theme',
    colors: {
      fg: 'black',
      ok: 'green',
      err: 'red',
      username: 'yellow',
      hostname: 'green',
      directory: 'blue',
      git_branch: 'purple',
      git_status: 'red',
      nodejs: 'green',
      python: 'yellow',
      rust: 'red',
      docker_context: 'blue',
      kubernetes: 'cyan',
      aws: 'yellow',
      time: 'white',
      battery: 'yellow',
      cmd_duration: 'yellow',
      jobs: 'blue',
    },
  },
  vivid: {
    label: 'Vivid',
    description: 'Saturated brights that make every icon pop',
    colors: {
      fg: 'black',
      ok: 'bright-green',
      err: 'bright-red',
      username: 'bright-yellow',
      hostname: 'bright-green',
      directory: 'bright-blue',
      git_branch: 'bright-purple',
      git_status: 'bright-red',
      nodejs: 'bright-green',
      python: 'bright-yellow',
      rust: 'bright-red',
      docker_context: 'bright-blue',
      kubernetes: 'bright-cyan',
      aws: 'bright-yellow',
      time: 'bright-white',
      battery: 'bright-green',
      cmd_duration: 'bright-yellow',
      jobs: 'bright-blue',
    },
  },
  terminal: {
    label: 'Terminal',
    description: 'The eight base ANSI colours, nothing your terminal cannot show',
    colors: {
      fg: 'black',
      ok: 'green',
      err: 'red',
      username: 'white',
      hostname: 'white',
      directory: 'blue',
      git_branch: 'purple',
      git_status: 'red',
      nodejs: 'green',
      python: 'yellow',
      rust: 'red',
      docker_context: 'blue',
      kubernetes: 'cyan',
      aws: 'yellow',
      time: 'white',
      battery: 'green',
      cmd_duration: 'white',
      jobs: 'blue',
    },
  },
  mono: {
    label: 'Monochrome',
    description: 'White and grey, with colour only where it carries meaning',
    colors: {
      fg: 'black',
      ok: 'white',
      err: 'red',
      username: 'bright-black',
      hostname: 'bright-black',
      directory: 'white',
      git_branch: 'bright-black',
      git_status: 'red',
      nodejs: 'bright-black',
      python: 'bright-black',
      rust: 'bright-black',
      docker_context: 'bright-black',
      kubernetes: 'bright-black',
      aws: 'bright-black',
      time: 'bright-black',
      battery: 'bright-black',
      cmd_duration: 'bright-black',
      jobs: 'bright-black',
    },
  },
  muted: {
    label: 'Muted',
    description: 'Desaturated tones that sit quietly behind your output',
    colors: {
      fg: '#1c1c1c',
      ok: '#8faf8f',
      err: '#cc8a8a',
      username: '#9a8f7a',
      hostname: '#8faf8f',
      directory: '#7f9abf',
      git_branch: '#a08fbf',
      git_status: '#cc8a8a',
      nodejs: '#8faf8f',
      python: '#bfae7f',
      rust: '#bf8f7f',
      docker_context: '#7f9abf',
      kubernetes: '#7fb0b0',
      aws: '#bfae7f',
      time: '#8a8a8a',
      battery: '#8faf8f',
      cmd_duration: '#9a9a8a',
      jobs: '#7f9abf',
    },
  },
  pure: {
    label: 'Pure',
    description: 'Blue path and grey git, as in the Pure zsh theme',
    colors: {
      fg: '#1c1c1c',
      ok: '#af5fff',
      err: '#ff5f5f',
      username: '#6c6c6c',
      hostname: '#6c6c6c',
      directory: '#0087d7',
      git_branch: '#6c6c6c',
      git_status: '#6c6c6c',
      nodejs: '#5faf5f',
      python: '#d7af5f',
      rust: '#d75f5f',
      docker_context: '#0087d7',
      kubernetes: '#00afaf',
      aws: '#d7af5f',
      time: '#6c6c6c',
      battery: '#5faf5f',
      cmd_duration: '#d7af00',
      jobs: '#6c6c6c',
    },
  },
  pastel: {
    label: 'Pastel',
    description: 'Soft washed-out hues with plenty of contrast between segments',
    colors: {
      fg: '#2e2e3e',
      ok: '#a8e6a1',
      err: '#ffadad',
      username: '#ffd6a5',
      hostname: '#caffbf',
      directory: '#a0c4ff',
      git_branch: '#bdb2ff',
      git_status: '#ffadad',
      nodejs: '#caffbf',
      python: '#fdffb6',
      rust: '#ffc6a5',
      docker_context: '#9bf6ff',
      kubernetes: '#a0e7e5',
      aws: '#fdffb6',
      time: '#d8d8e8',
      battery: '#caffbf',
      cmd_duration: '#fdffb6',
      jobs: '#bdb2ff',
    },
  },
  'tokyo-night': {
    label: 'Tokyo Night',
    description: 'Dark theme with blue and purple tones',
    colors: {
      fg: '#1a1b26',
      ok: '#9ece6a',
      err: '#f7768e',
      username: '#ff9e64',
      hostname: '#e0af68',
      directory: '#7aa2f7',
      git_branch: '#bb9af7',
      git_status: '#f7768e',
      nodejs: '#9ece6a',
      python: '#e0af68',
      rust: '#ff9e64',
      docker_context: '#7dcfff',
      kubernetes: '#2ac3de',
      aws: '#e0af68',
      time: '#a9b1d6',
      battery: '#9ece6a',
      cmd_duration: '#e0af68',
      jobs: '#bb9af7',
    },
  },
  gruvbox: {
    label: 'Gruvbox',
    description: 'Warm earth tones, a different colour on every segment',
    colors: {
      fg: '#282828',
      ok: '#b8bb26',
      err: '#fb4934',
      username: '#fe8019',
      hostname: '#fabd2f',
      directory: '#83a598',
      git_branch: '#d3869b',
      git_status: '#fb4934',
      nodejs: '#b8bb26',
      python: '#fabd2f',
      rust: '#fe8019',
      docker_context: '#83a598',
      kubernetes: '#8ec07c',
      aws: '#fabd2f',
      time: '#a89984',
      battery: '#b8bb26',
      cmd_duration: '#fabd2f',
      jobs: '#d3869b',
    },
  },
  jetpack: {
    label: 'Jetpack',
    description: 'Cool teals and cyans, pseudo-minimalist',
    colors: {
      fg: '#0b1a1a',
      ok: '#26c6a2',
      err: '#ef5f6b',
      username: '#7fd1c1',
      hostname: '#5ec8c8',
      directory: '#26c6a2',
      git_branch: '#8ab4f8',
      git_status: '#ef5f6b',
      nodejs: '#7ed957',
      python: '#f5c542',
      rust: '#f57a42',
      docker_context: '#5ec8c8',
      kubernetes: '#5ec8c8',
      aws: '#f5c542',
      time: '#7a8f8f',
      battery: '#26c6a2',
      cmd_duration: '#f5c542',
      jobs: '#8ab4f8',
    },
  },
  catppuccin: {
    label: 'Catppuccin Mocha',
    description: 'Soothing pastels on a deep mocha base',
    colors: {
      fg: '#1e1e2e',
      ok: '#a6e3a1',
      err: '#f38ba8',
      username: '#fab387',
      hostname: '#f9e2af',
      directory: '#89b4fa',
      git_branch: '#cba6f7',
      git_status: '#f38ba8',
      nodejs: '#a6e3a1',
      python: '#f9e2af',
      rust: '#fab387',
      docker_context: '#89dceb',
      kubernetes: '#94e2d5',
      aws: '#f9e2af',
      time: '#bac2de',
      battery: '#a6e3a1',
      cmd_duration: '#f9e2af',
      jobs: '#cba6f7',
    },
  },
  slate: {
    label: 'Slate',
    description: 'Cool greys with a single blue accent, for shared machines',
    colors: {
      fg: '#0f172a',
      ok: '#38bdf8',
      err: '#f43f5e',
      username: '#94a3b8',
      hostname: '#94a3b8',
      directory: '#38bdf8',
      git_branch: '#818cf8',
      git_status: '#f43f5e',
      nodejs: '#64748b',
      python: '#64748b',
      rust: '#64748b',
      docker_context: '#7dd3fc',
      kubernetes: '#7dd3fc',
      aws: '#94a3b8',
      time: '#64748b',
      battery: '#38bdf8',
      cmd_duration: '#94a3b8',
      jobs: '#818cf8',
    },
  },
  // `satisfies` (not a type annotation) so the literal keys survive for PaletteId
  // while every entry is still checked for a complete colour table.
} satisfies Record<string, Omit<PaletteDef, 'id'>>;

export type PaletteId = keyof typeof PALETTE_DEFS;

export const PALETTES: readonly PaletteDef[] = (Object.keys(PALETTE_DEFS) as PaletteId[]).map(
  (id) => ({ id, ...PALETTE_DEFS[id] })
);

export function getPalette(id: PaletteId): PaletteDef {
  return { id, ...PALETTE_DEFS[id] };
}

/**
 * Starship's named colours do not all spell the same as Ink's. Only the names
 * differ — hex literals pass through untouched — so this maps the handful that
 * clash and leaves everything else alone.
 */
const INK_COLOR_NAMES: Record<string, string> = {
  purple: 'magenta',
  'bright-black': 'gray',
  'bright-red': 'redBright',
  'bright-green': 'greenBright',
  'bright-yellow': 'yellowBright',
  'bright-blue': 'blueBright',
  'bright-purple': 'magentaBright',
  'bright-cyan': 'cyanBright',
  'bright-white': 'whiteBright',
};

/** Translates a palette colour into the spelling Ink's `<Text color>` expects. */
export function inkColor(color: string): string {
  return INK_COLOR_NAMES[color] ?? color;
}
