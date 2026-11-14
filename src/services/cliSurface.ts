import { PALETTES } from '../config/palettes.ts';
import { PRESETS } from '../config/presets.ts';
import { SHELLS } from '../config/shells.ts';
import type { Subcommand } from './args.ts';
import { NERD_FONTS } from './installer.ts';

export type FlagValues = readonly string[] | 'file' | 'text';

export interface FlagInfo {
  name: string;
  short?: string;
  description: string;
  values?: FlagValues;
}

const SHELL_IDS = SHELLS.map((shell) => shell.id);
const FONT_IDS = NERD_FONTS.map((font) => font.id);

const flag = (
  name: string,
  description: string,
  values?: FlagValues,
  short?: string
): FlagInfo => ({
  name,
  description,
  ...(values ? { values } : {}),
  ...(short ? { short } : {}),
});

export const FLAGS = {
  help: flag('--help', 'Show the help and exit', undefined, '-h'),
  version: flag('--version', 'Print the version and exit', undefined, '-v'),
  dryRun: flag('--dry-run', 'Change nothing; print what would happen', undefined, '-d'),
  noInstall: flag('--no-install', 'Alias for --dry-run'),
  restore: flag('--restore', 'Copy the newest backups back over the configs'),
  listPresets: flag('--list-presets', 'List the presets (--json for data)'),
  listModules: flag('--list-modules', 'List the prompt modules (--json for data)'),
  listFonts: flag('--list-fonts', 'List the Nerd Fonts (--json for data)'),
  listJson: flag('--json', 'With a --list-* flag, print the data as JSON'),
  undo: flag('--undo', 'Alias for --restore'),
  preset: flag(
    '--preset',
    'Seed modules, palette and powerline from a preset',
    PRESETS.map((p) => p.id)
  ),
  palette: flag(
    '--palette',
    'Override the colour palette',
    PALETTES.map((p) => p.id)
  ),
  powerline: flag('--powerline', 'Draw segments as interlocking blocks'),
  noPowerline: flag('--no-powerline', 'Draw plain segments'),
  shells: flag('--shells', 'Shells to configure, comma-separated', SHELL_IDS),
  font: flag('--font', 'Nerd Font to install, or none', ['none', ...FONT_IDS]),
  hasNerdFont: flag('--has-nerd-font', 'The terminal already renders Nerd Font glyphs'),
  noNerdFont: flag('--no-nerd-font', 'The terminal does not render Nerd Font glyphs'),
  character: flag('--character', 'The prompt character symbol', ['arrow', 'lambda', 'dollar']),
  setDefault: flag('--set-default', 'Make a shell the login default', SHELL_IDS),
  skipStarship: flag('--skip-starship', 'Do not install or require Starship'),
  output: flag('--output', 'Write the TOML to this file', 'file', '-o'),
  export: flag('--export', 'Write the state card to this file', 'file'),
  state: flag('--state', 'Use a saved state card', 'file'),
  import: flag('--import', 'Alias for --state', 'file'),
  adopt: flag('--adopt', 'Keep the existing shared starship.toml'),
  importUrl: flag('--import-url', 'Fetch a starship.toml over https and adopt it', 'text'),
  json: flag('--json', 'Print the report as JSON'),
  fix: flag('--fix', 'Apply the repairs for failing checks'),
  includeWarnings: flag('--include-warnings', 'Also apply the fixes warnings suggest'),
  yes: flag('--yes', 'Go ahead without asking', undefined, '-y'),
  starship: flag('--starship', 'Also remove Starship itself'),
  uninstallFont: flag('--font', 'Also remove this Nerd Font', FONT_IDS),
  list: flag('--list', 'List the runs that changed files'),
  run: flag('--run', 'Roll back this run (an id from --list)', 'text'),
  config: flag('--config', 'Time this starship.toml instead of one built from flags', 'file'),
} satisfies Record<string, FlagInfo>;

export const GLOBAL_FLAGS: readonly FlagInfo[] = [FLAGS.help, FLAGS.version];

export const WIZARD_FLAGS: readonly FlagInfo[] = [
  FLAGS.dryRun,
  FLAGS.noInstall,
  FLAGS.restore,
  FLAGS.undo,
  FLAGS.listPresets,
  FLAGS.listModules,
  FLAGS.listFonts,
  FLAGS.listJson,
];

const CONFIG_FLAGS = [
  FLAGS.preset,
  FLAGS.palette,
  FLAGS.powerline,
  FLAGS.noPowerline,
  FLAGS.shells,
  FLAGS.font,
  FLAGS.hasNerdFont,
  FLAGS.noNerdFont,
  FLAGS.character,
  FLAGS.setDefault,
  FLAGS.skipStarship,
  FLAGS.state,
  FLAGS.import,
];

const LOOK_FLAGS = [
  FLAGS.preset,
  FLAGS.palette,
  FLAGS.powerline,
  FLAGS.noPowerline,
  FLAGS.font,
  FLAGS.hasNerdFont,
  FLAGS.noNerdFont,
  FLAGS.character,
  FLAGS.state,
  FLAGS.import,
];

export interface SubcommandInfo {
  description: string;
  flags: readonly FlagInfo[];
  argument?: readonly string[];
}

export const COMPLETION_SHELLS = ['bash', 'zsh', 'fish'] as const;
export type CompletionShell = (typeof COMPLETION_SHELLS)[number];

export const SUBCOMMAND_INFO: Record<Subcommand, SubcommandInfo> = {
  generate: {
    description: 'Render a starship.toml from flags',
    flags: [...CONFIG_FLAGS, FLAGS.output, FLAGS.export, FLAGS.dryRun],
  },
  apply: {
    description: 'Run a full install headlessly',
    flags: [...CONFIG_FLAGS, FLAGS.adopt, FLAGS.importUrl, FLAGS.dryRun, FLAGS.json],
  },
  doctor: {
    description: 'Check the setup and report problems',
    flags: [FLAGS.state, FLAGS.import, FLAGS.json, FLAGS.fix, FLAGS.includeWarnings],
  },
  repair: {
    description: 'Fix the problems doctor finds',
    flags: [FLAGS.state, FLAGS.import, FLAGS.dryRun, FLAGS.includeWarnings, FLAGS.json],
  },
  uninstall: {
    description: 'Remove what the wizard set up',
    flags: [FLAGS.shells, FLAGS.starship, FLAGS.uninstallFont, FLAGS.yes, FLAGS.dryRun, FLAGS.json],
  },
  rollback: {
    description: 'Put back the files the last run changed',
    flags: [FLAGS.list, FLAGS.run, FLAGS.yes, FLAGS.dryRun, FLAGS.json],
  },
  'debug-info': {
    description: 'Print a report of the setup for a bug report',
    flags: [FLAGS.json],
  },
  completions: {
    description: 'Print a shell completion script',
    flags: [],
    argument: COMPLETION_SHELLS,
  },
  timings: {
    description: 'Time each prompt module here and suggest fixes for slow ones',
    flags: [...LOOK_FLAGS, FLAGS.config, FLAGS.json],
  },
  share: {
    description: 'Print the prompt as Markdown to share, with the card that rebuilds it',
    flags: [...LOOK_FLAGS, { ...FLAGS.output, description: 'Write the Markdown to this file' }],
  },
};
