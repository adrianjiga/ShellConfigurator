/**
 * Style values the generator resolves from the chosen colour scheme and hands to
 * each module's `toml` builder. Kept structural so config does not depend on the
 * generator module.
 */
export interface ModuleTomlContext {
  hasNerdFont: boolean;
  style: { dir: string; branch: string; status: string };
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
  // Returns this module's starship.toml block.
  toml: (ctx: ModuleTomlContext) => string;
}

const MODULE_DEFS = {
  username: {
    label: 'Username',
    description: 'Current user (shown when SSH or root)',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: () => 'user',
    toml: () =>
      `
[username]
show_always = false
style_user  = "bold yellow"
style_root  = "bold red"
`.trim(),
  },
  hostname: {
    label: 'Hostname',
    description: 'Machine hostname (shown when SSH)',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: () => 'host',
    toml: () =>
      `
[hostname]
ssh_only = true
style    = "bold green"
`.trim(),
  },
  directory: {
    label: 'Directory',
    description: 'Current directory path',
    defaultLeft: true,
    defaultRight: false,

    previewSegment: () => '~/projects/myapp',
    toml: ({ style }) =>
      `
[directory]
style             = "${style.dir}"
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
    toml: ({ hasNerdFont, style }) =>
      `
[git_branch]
symbol = "${hasNerdFont ? ' ' : 'on '}"
style  = "${style.branch}"
`.trim(),
  },
  git_status: {
    label: 'Git Status',
    description: 'Staged, modified, and untracked file counts',
    defaultLeft: true,
    defaultRight: false,

    previewSegment: () => '+1',
    toml: ({ style }) =>
      `
[git_status]
style     = "${style.status}"
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
    toml: ({ hasNerdFont }) =>
      `
[nodejs]
symbol   = "${hasNerdFont ? ' ' : 'node '}"
style    = "bold green"
disabled = false
`.trim(),
  },
  python: {
    label: 'Python',
    description: 'Python version (shown in Python projects)',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: (nf) => `${nf ? ' ' : 'py '}3.12.0`,
    toml: ({ hasNerdFont }) =>
      `
[python]
symbol   = "${hasNerdFont ? ' ' : 'py '}"
style    = "bold yellow"
disabled = false
`.trim(),
  },
  rust: {
    label: 'Rust',
    description: 'Rust version (shown in Rust projects)',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: () => '🦀 1.80.0',
    toml: ({ hasNerdFont }) =>
      `
[rust]
symbol   = "${hasNerdFont ? ' ' : 'rs '}"
style    = "bold red"
disabled = false
`.trim(),
  },
  docker_context: {
    label: 'Docker',
    description: 'Docker context name',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: () => '🐳 default',
    toml: () =>
      `
[docker_context]
symbol   = "🐳 "
style    = "bold blue"
disabled = false
`.trim(),
  },
  kubernetes: {
    label: 'Kubernetes',
    description: 'K8s cluster context and namespace',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: () => '☸ prod',
    toml: () =>
      `
[kubernetes]
symbol   = "☸ "
style    = "bold cyan"
disabled = false
`.trim(),
  },
  aws: {
    label: 'AWS',
    description: 'AWS region and profile',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: () => '☁️ us-east-1',
    toml: () =>
      `
[aws]
symbol   = "☁️  "
style    = "bold yellow"
disabled = false
`.trim(),
  },
  time: {
    label: 'Time',
    description: 'Current time',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: () => '12:34',
    toml: () =>
      `
[time]
disabled    = false
time_format = "%H:%M"
style       = "bold white"
`.trim(),
  },
  battery: {
    label: 'Battery',
    description: 'Battery percentage (shown when below threshold)',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: () => '🔋 85%',
    toml: () =>
      `
[battery]
disabled = false

[[battery.display]]
threshold = 30
style     = "bold red"

[[battery.display]]
threshold = 80
style     = "bold yellow"
`.trim(),
  },
  cmd_duration: {
    label: 'Command Duration',
    description: 'Time taken by the last command',
    defaultLeft: false,
    defaultRight: true,

    previewSegment: () => '2s',
    toml: () =>
      `
[cmd_duration]
min_time = 2000
style    = "bold yellow"
`.trim(),
  },
  jobs: {
    label: 'Background Jobs',
    description: 'Number of background jobs',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: () => '2',
    toml: () =>
      `
[jobs]
symbol    = "✦"
style     = "bold blue"
threshold = 1
`.trim(),
  },
  // `satisfies` (not a type annotation) so the literal keys survive for
  // ConfigurableModuleId while each callback still gets contextual typing.
} satisfies Record<string, Omit<ModuleDef, 'id'>>;

/**
 * MODULE_DEFS is the single source of truth: the id union, the module list, and
 * each module's TOML all derive from it, so adding a module is a one-place change
 * and cannot leave the type and the data disagreeing.
 */
export type ConfigurableModuleId = keyof typeof MODULE_DEFS;

/** The prompt character is always appended last and is configured on the Style
 *  screen, so it is not a placeable module and has no MODULE_DEFS entry. */
export type ModuleId = ConfigurableModuleId | 'character';

export const MODULES: readonly ModuleDef[] = (
  Object.keys(MODULE_DEFS) as ConfigurableModuleId[]
).map((id) => ({ id, ...MODULE_DEFS[id] }));

export function getModule(id: string): ModuleDef | undefined {
  return MODULES.find((m) => m.id === id);
}
