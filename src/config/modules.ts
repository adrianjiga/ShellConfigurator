import { tomlBasic } from '../generators/toml.ts';
import type { PaletteColorName } from './palettes.ts';

/**
 * What the generator hands each module's `settings` builder.
 *
 * Modules do not resolve their own colour: the generator emits the `style` key
 * from the palette entry matching the module id. Only modules that carry their
 * colour in differently-named keys need `styleFor`.
 */
export interface ModuleTomlContext {
  hasNerdFont: boolean;
  /**
   * Builds the style expression for a palette colour — the colour on its own in a
   * normal prompt, or an `fg:fg bg:<colour>` pair under powerline. Keeping this a
   * callback means a module never has to know which of the two it is in.
   */
  styleFor: (name: PaletteColorName) => string;
}

export interface ModuleDef {
  id: ConfigurableModuleId;
  label: string;
  description: string;
  defaultLeft: boolean;
  defaultRight: boolean;
  // Returns a short colored preview string for the prompt preview.
  // Only modules whose symbol is a genuine Nerd Font glyph branch on hasNerdFont;
  // emoji and plain Unicode render without one, so those symbols are unconditional.
  previewSegment: (hasNerdFont: boolean) => string;
  /**
   * The module's inner format — what sits inside the coloured segment. A normal
   * prompt leaves starship's own default format alone, but a powerline prompt has
   * to wrap the content in separator glyphs, and that needs the content spelled out.
   */
  content: string;
  /** This module's TOML keys other than `style` and `format`. */
  settings?: (ctx: ModuleTomlContext) => string;
  /**
   * Set when the module carries its colour in keys other than `style`
   * (`style_user`/`style_root`, `[[battery.display]]`), so the generator must not
   * emit a `style` of its own.
   */
  stylesItself?: boolean;
}

/**
 * The placeable modules.
 *
 * Spelled out rather than inferred from `MODULE_DEFS` because palettes key their
 * colour table on this union, and inferring it would make the two files reference
 * each other's types in a cycle. `satisfies Record<ConfigurableModuleId, …>` below
 * keeps the union and the data exhaustive in both directions, so neither a missing
 * entry nor a stray one compiles — which is the drift that caused the prompt
 * character to silently vanish from the preview.
 */
export type ConfigurableModuleId =
  | 'username'
  | 'hostname'
  | 'directory'
  | 'git_branch'
  | 'git_status'
  | 'nodejs'
  | 'python'
  | 'rust'
  | 'docker_context'
  | 'kubernetes'
  | 'aws'
  | 'time'
  | 'battery'
  | 'cmd_duration'
  | 'jobs';

/** The prompt character is always appended last and is configured on the Style
 *  screen, so it is not a placeable module and has no MODULE_DEFS entry. */
export type ModuleId = ConfigurableModuleId | 'character';

const MODULE_DEFS = {
  username: {
    label: 'Username',
    description: 'Current user (shown when SSH or root)',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: () => 'user',
    content: '$user',
    stylesItself: true,
    settings: ({ styleFor }) =>
      `
show_always = false
style_user  = "${tomlBasic(styleFor('username'))}"
style_root  = "${tomlBasic(styleFor('err'))}"
`.trim(),
  },
  hostname: {
    label: 'Hostname',
    description: 'Machine hostname (shown when SSH)',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: () => 'host',
    content: '$ssh_symbol$hostname',
    settings: () => `ssh_only = true`,
  },
  directory: {
    label: 'Directory',
    description: 'Current directory path',
    defaultLeft: true,
    defaultRight: false,

    previewSegment: () => '~/projects/myapp',
    content: '$path$read_only',
    settings: () =>
      `
truncation_length = 3
truncate_to_repo  = true
`.trim(),
  },
  git_branch: {
    label: 'Git Branch',
    description: 'Active git branch name',
    defaultLeft: true,
    defaultRight: false,

    previewSegment: (nf) => `${nf ? ' ' : 'on '}main`,
    content: '$symbol$branch',
    settings: ({ hasNerdFont }) => `symbol = "${hasNerdFont ? ' ' : 'on '}"`,
  },
  git_status: {
    label: 'Git Status',
    description: 'Staged, modified, and untracked file counts',
    defaultLeft: true,
    defaultRight: false,

    previewSegment: () => '+1',
    content: '$all_status$ahead_behind',
    settings: () =>
      `
ahead     = "⇡\${count}"
behind    = "⇣\${count}"
diverged  = "⇕⇡\${ahead_count}⇣\${behind_count}"
modified  = "!\${count}"
staged    = "+\${count}"
untracked = "?\${count}"
deleted   = "-\${count}"
`.trim(),
  },
  nodejs: {
    label: 'Node.js',
    description: 'Node version (shown in JS/TS projects)',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: (nf) => `${nf ? ' ' : 'node '}v22.0.0`,
    content: '$symbol$version',
    settings: ({ hasNerdFont }) =>
      `
symbol   = "${hasNerdFont ? ' ' : 'node '}"
disabled = false
`.trim(),
  },
  python: {
    label: 'Python',
    description: 'Python version (shown in Python projects)',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: (nf) => `${nf ? ' ' : 'py '}3.12.0`,
    content: '$symbol$version',
    settings: ({ hasNerdFont }) =>
      `
symbol   = "${hasNerdFont ? ' ' : 'py '}"
disabled = false
`.trim(),
  },
  rust: {
    label: 'Rust',
    description: 'Rust version (shown in Rust projects)',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: () => '🦀 1.80.0',
    content: '$symbol$version',
    settings: ({ hasNerdFont }) =>
      `
symbol   = "${hasNerdFont ? ' ' : 'rs '}"
disabled = false
`.trim(),
  },
  docker_context: {
    label: 'Docker',
    description: 'Docker context name',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: () => '🐳 default',
    content: '$symbol$context',
    settings: () =>
      `
symbol   = "🐳 "
disabled = false
`.trim(),
  },
  kubernetes: {
    label: 'Kubernetes',
    description: 'K8s cluster context and namespace',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: () => '☸ prod',
    content: '$symbol$context',
    settings: () =>
      `
symbol   = "☸ "
disabled = false
`.trim(),
  },
  aws: {
    label: 'AWS',
    description: 'AWS region and profile',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: () => '☁️ us-east-1',
    content: '$symbol$profile$region',
    settings: () =>
      `
symbol   = "☁️  "
disabled = false
`.trim(),
  },
  time: {
    label: 'Time',
    description: 'Current time',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: () => '12:34',
    content: '$time',
    settings: () =>
      `
disabled    = false
time_format = "%H:%M"
`.trim(),
  },
  battery: {
    label: 'Battery',
    description: 'Battery percentage (shown when below threshold)',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: () => '🔋 85%',
    content: '$symbol$percentage',
    stylesItself: true,
    settings: ({ styleFor }) =>
      `
disabled = false

[[battery.display]]
threshold = 30
style     = "${tomlBasic(styleFor('err'))}"

[[battery.display]]
threshold = 80
style     = "${tomlBasic(styleFor('battery'))}"
`.trim(),
  },
  cmd_duration: {
    label: 'Command Duration',
    description: 'Time taken by the last command',
    defaultLeft: false,
    defaultRight: true,

    previewSegment: () => '2s',
    content: '$duration',
    settings: () => `min_time = 2000`,
  },
  jobs: {
    label: 'Background Jobs',
    description: 'Number of background jobs',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: () => '2',
    content: '$symbol$number',
    settings: () =>
      `
symbol    = "✦"
threshold = 1
`.trim(),
  },
  // `satisfies` (not a type annotation) so each callback still gets contextual
  // typing, while the Record makes the table exhaustive over ConfigurableModuleId.
} satisfies Record<ConfigurableModuleId, Omit<ModuleDef, 'id'>>;

export const MODULES: readonly ModuleDef[] = (
  Object.keys(MODULE_DEFS) as ConfigurableModuleId[]
).map((id) => ({ id, ...MODULE_DEFS[id] }));

export function getModule(id: string): ModuleDef | undefined {
  return MODULES.find((m) => m.id === id);
}
