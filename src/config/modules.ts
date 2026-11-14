import { tomlBasic } from '../generators/toml.ts';
import type { DirectorySubstitution } from '../types.ts';
import type { PaletteColorName } from './palettes.ts';
import { NERD_FONT_SYMBOLS } from './promptSymbols.ts';

/**
 * What the generator hands each module's `settings` builder.
 *
 * Modules do not resolve their own colour: the generator emits the `style` key
 * from the palette entry matching the module id. Only modules that carry their
 * colour in differently-named keys need `styleFor`.
 */
/** The settings a static preview segment depends on beyond the font. */
export type PreviewSample = Pick<
  ModuleTomlContext,
  'directoryTruncationLength' | 'directorySubstitutions'
>;

export interface ModuleTomlContext {
  hasNerdFont: boolean;
  powerline: boolean;
  /** The generator writes this module's `format` itself (powerline or brackets). */
  customFormat: boolean;
  /** Starship `directory.truncation_length`; `0` shows the full path. */
  directoryTruncationLength: number;
  /** Starship `directory.substitutions`, in insertion order. */
  directorySubstitutions: readonly DirectorySubstitution[];
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
  // Modules whose preview symbol is a Nerd Font glyph branch on hasNerdFont; emoji
  // and plain Unicode render without one (battery previews its emoji either way).
  previewSegment: (hasNerdFont: boolean, sample: PreviewSample) => string;
  /** The plain-prompt preview, where starship's default format adds words
   *  or brackets the powerline content leaves out. */
  plainPreview?: (hasNerdFont: boolean) => string;
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
  | 'jobs'
  | 'status'
  | 'os'
  | 'shlvl'
  | 'sudo'
  | 'git_commit'
  | 'golang'
  | 'java'
  | 'dotnet'
  | 'ruby'
  | 'php'
  | 'c'
  | 'cpp'
  | 'zig'
  | 'lua'
  | 'swift'
  | 'elixir';

/** The prompt character is always appended last and is configured on the Style
 *  screen, so it is not a placeable module and has no MODULE_DEFS entry. */
export type ModuleId = ConfigurableModuleId | 'character';

/** The directory/git/character core that nearly every preset starts from. */
export const CORE_MODULES: readonly ModuleId[] = [
  'directory',
  'git_branch',
  'git_status',
  'character',
];

export const isConfigurableModule = (id: ModuleId): id is ConfigurableModuleId =>
  id !== 'character';

/** A module drawn as its symbol before a sample value, enabled explicitly. */
function symbolModule(
  symbol: (hasNerdFont: boolean) => string,
  sample: string
): Pick<ModuleDef, 'previewSegment' | 'settings'> {
  return {
    previewSegment: (hasNerdFont) => `${symbol(hasNerdFont)}${sample}`,
    settings: ({ hasNerdFont }) =>
      `symbol   = "${tomlBasic(symbol(hasNerdFont))}"\ndisabled = false`,
  };
}

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

    // Like starship, substitutions replace matching text anywhere in the path, and
    // truncation keeps the last folders with no marker (the default symbol is empty).
    previewSegment: (
      hasNerdFont,
      { directoryTruncationLength: length, directorySubstitutions }
    ) => {
      let full = '~/projects/myapp';
      for (const { from, to } of directorySubstitutions) full = full.split(from).join(to);
      const parts = full.split('/').filter(Boolean);
      const shown =
        length === 0 || parts.length <= length ? parts.join('/') : parts.slice(-length).join('/');
      return `${hasNerdFont ? NERD_FONT_SYMBOLS.directory : ''}${shown}`;
    },
    content: '$path$read_only',
    settings: ({
      hasNerdFont,
      customFormat,
      directoryTruncationLength,
      directorySubstitutions,
    }) => {
      const lines = [
        `truncation_length = ${directoryTruncationLength}`,
        `truncate_to_repo  = true`,
      ];
      if (hasNerdFont && !customFormat) {
        lines.push(
          `format = "[${tomlBasic(NERD_FONT_SYMBOLS.directory)}]($style)[$path]($style)[$read_only]($read_only_style) "`
        );
      }
      if (directorySubstitutions.length > 0) {
        lines.push('', '[directory.substitutions]');
        for (const { from, to } of directorySubstitutions) {
          lines.push(`"${tomlBasic(from)}" = "${tomlBasic(to)}"`);
        }
      }
      return lines.join('\n');
    },
  },
  git_branch: {
    label: 'Git Branch',
    description: 'Active git branch name',
    defaultLeft: true,
    defaultRight: false,

    previewSegment: (nf) => `${nf ? NERD_FONT_SYMBOLS.gitBranch : ''}main`,
    plainPreview: (nf) => `on ${nf ? NERD_FONT_SYMBOLS.gitBranch : ''}main`,
    content: '$symbol$branch',
    // starship's git_branch format already renders "on " before the symbol.
    settings: ({ hasNerdFont }) =>
      `symbol = "${tomlBasic(hasNerdFont ? NERD_FONT_SYMBOLS.gitBranch : '')}"`,
  },
  git_status: {
    label: 'Git Status',
    description: 'Staged, modified, and untracked file counts',
    defaultLeft: true,
    defaultRight: false,

    previewSegment: () => '+1',
    plainPreview: () => '[+1]',
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

    ...symbolModule((nf) => (nf ? NERD_FONT_SYMBOLS.nodejs : 'node '), 'v22.0.0'),
    content: '$symbol$version',
  },
  python: {
    label: 'Python',
    description: 'Python version (shown in Python projects)',
    defaultLeft: false,
    defaultRight: false,

    ...symbolModule((nf) => (nf ? NERD_FONT_SYMBOLS.python : 'py '), '3.12.0'),
    content: '$symbol$version( \\($virtualenv\\))',
  },
  rust: {
    label: 'Rust',
    description: 'Rust version (shown in Rust projects)',
    defaultLeft: false,
    defaultRight: false,

    ...symbolModule((nf) => (nf ? NERD_FONT_SYMBOLS.rust : 'rs '), '1.80.0'),
    content: '$symbol$version',
  },
  docker_context: {
    label: 'Docker',
    description: 'Docker context name',
    defaultLeft: false,
    defaultRight: false,

    ...symbolModule(() => '🐳 ', 'dev'),
    content: '$symbol$context',
  },
  kubernetes: {
    label: 'Kubernetes',
    description: 'K8s cluster context and namespace',
    defaultLeft: false,
    defaultRight: false,

    ...symbolModule(() => '☸ ', 'prod'),
    content: '$symbol$context( \\($namespace\\))',
  },
  aws: {
    label: 'AWS',
    description: 'AWS region and profile',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: () => '☁️ us-east-1',
    content: '$symbol($profile )(\\($region\\))',
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
    plainPreview: () => 'at 12:34',
    content: '$time',
    settings: () =>
      `
disabled    = false
time_format = "%H:%M"
`.trim(),
  },
  battery: {
    label: 'Battery',
    description: 'Battery level (turns red below 30%)',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: () => '🔋 85%',
    content: '$symbol$percentage',
    stylesItself: true,
    // Starship's default battery symbols are Nerd Font glyphs.
    settings: ({ styleFor, hasNerdFont }) =>
      `
disabled = false${
        hasNerdFont
          ? ''
          : `
full_symbol        = "🔋 "
charging_symbol    = "⚡️ "
discharging_symbol = "🔋 "
unknown_symbol     = "🔋 "
empty_symbol       = "🪫 "`
      }

[[battery.display]]
threshold = 30
style     = "${tomlBasic(styleFor('err'))}"

[[battery.display]]
threshold = 100
style     = "${tomlBasic(styleFor('battery'))}"
`.trim(),
  },
  cmd_duration: {
    label: 'Command Duration',
    description: 'Time taken by the last command (when it ran 2s or longer)',
    defaultLeft: false,
    defaultRight: true,

    previewSegment: () => '2s',
    plainPreview: () => 'took 2s',
    content: '$duration',
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
symbol           = "✦"
number_threshold = 1
`.trim(),
  },
  status: {
    label: 'Exit Status',
    description: 'Exit code of the previous command (shown on failure)',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: () => '❌ 127',
    content: '$symbol$status',
    settings: () => `disabled = false`,
  },
  os: {
    label: 'Operating System',
    description: 'Icon for the current operating system',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: () => '🐧',
    content: '$symbol',
    settings: () => `disabled = false`,
  },
  shlvl: {
    label: 'Shell Level',
    description: 'Nested shell depth',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: () => '↕️ 2',
    content: '$symbol$shlvl',
    settings: () =>
      `
disabled  = false
threshold = 2
`.trim(),
  },
  sudo: {
    label: 'Sudo',
    description: 'Shown while sudo credentials are cached',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: () => '🧙',
    content: '$symbol',
    settings: () => `disabled = false`,
  },
  git_commit: {
    label: 'Git Commit',
    description: 'Current commit hash (shown when HEAD is detached)',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: () => '(a1b2c3d)',
    content: '\\($hash$tag\\)',
  },
  golang: {
    label: 'Go',
    description: 'Go version (shown in Go projects)',
    defaultLeft: false,
    defaultRight: false,

    ...symbolModule(() => '🐹 ', 'v1.22'),
    content: '$symbol$version',
  },
  java: {
    label: 'Java',
    description: 'Java version (shown in Java projects)',
    defaultLeft: false,
    defaultRight: false,

    ...symbolModule(() => '☕ ', 'v21'),
    content: '$symbol$version',
  },
  dotnet: {
    label: '.NET',
    description: '.NET SDK version (shown in .NET projects)',
    defaultLeft: false,
    defaultRight: false,

    ...symbolModule(() => '.NET ', '8.0'),
    content: '$symbol$version',
  },
  ruby: {
    label: 'Ruby',
    description: 'Ruby version (shown in Ruby projects)',
    defaultLeft: false,
    defaultRight: false,

    ...symbolModule(() => '💎 ', '3.3'),
    content: '$symbol$version',
  },
  php: {
    label: 'PHP',
    description: 'PHP version (shown in PHP projects)',
    defaultLeft: false,
    defaultRight: false,

    ...symbolModule(() => '🐘 ', '8.3'),
    content: '$symbol$version',
  },
  c: {
    label: 'C',
    description: 'C compiler version (shown in C projects)',
    defaultLeft: false,
    defaultRight: false,

    ...symbolModule(() => 'C ', '13.2'),
    content: '$symbol$version',
  },
  cpp: {
    label: 'C++',
    description: 'C++ compiler version (shown in C++ projects)',
    defaultLeft: false,
    defaultRight: false,

    ...symbolModule(() => 'C++ ', '13.2'),
    content: '$symbol$version',
  },
  zig: {
    label: 'Zig',
    description: 'Zig version (shown in Zig projects)',
    defaultLeft: false,
    defaultRight: false,

    ...symbolModule(() => '↯ ', '0.13'),
    content: '$symbol$version',
  },
  lua: {
    label: 'Lua',
    description: 'Lua version (shown in Lua projects)',
    defaultLeft: false,
    defaultRight: false,

    ...symbolModule(() => '🌙 ', '5.4'),
    content: '$symbol$version',
  },
  swift: {
    label: 'Swift',
    description: 'Swift version (shown in Swift projects)',
    defaultLeft: false,
    defaultRight: false,

    ...symbolModule(() => '🐦 ', '5.10'),
    content: '$symbol$version',
  },
  elixir: {
    label: 'Elixir',
    description: 'Elixir version (shown in Elixir projects)',
    defaultLeft: false,
    defaultRight: false,

    ...symbolModule(() => '💧 ', '1.16'),
    content: '$symbol$version',
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

/** The modules as the prompt places them: each once, and one chosen for both sides only on the left. */
export function placedModules(
  left: readonly ModuleId[],
  right: readonly ModuleId[]
): { left: ModuleId[]; right: ModuleId[] } {
  const placedLeft = [...new Set(left)];
  return { left: placedLeft, right: [...new Set(right)].filter((id) => !placedLeft.includes(id)) };
}
