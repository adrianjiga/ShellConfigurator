export type ModuleId =
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
  | 'character';

/** Every module the user can place in a prompt side. The prompt character is
 *  not one of these: it is always rendered last and is configured on the Style
 *  screen, so it has no entry here. */
export type ConfigurableModuleId = Exclude<ModuleId, 'character'>;

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
}

const MODULE_DEFS: Record<ConfigurableModuleId, Omit<ModuleDef, 'id'>> = {
  username: {
    label: 'Username',
    description: 'Current user (shown when SSH or root)',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: () => 'user',
  },
  hostname: {
    label: 'Hostname',
    description: 'Machine hostname (shown when SSH)',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: () => 'host',
  },
  directory: {
    label: 'Directory',
    description: 'Current directory path',
    defaultLeft: true,
    defaultRight: false,

    previewSegment: () => '~/projects/myapp',
  },
  git_branch: {
    label: 'Git Branch',
    description: 'Active git branch name',
    defaultLeft: true,
    defaultRight: false,

    previewSegment: (nf) => `${nf ? ' ' : 'on '}main`,
  },
  git_status: {
    label: 'Git Status',
    description: 'Staged, modified, and untracked file counts',
    defaultLeft: true,
    defaultRight: false,

    previewSegment: () => '+1',
  },
  nodejs: {
    label: 'Node.js',
    description: 'Node version (shown in JS/TS projects)',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: (nf) => `${nf ? ' ' : 'node '}v22.0.0`,
  },
  python: {
    label: 'Python',
    description: 'Python version (shown in Python projects)',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: (nf) => `${nf ? ' ' : 'py '}3.12.0`,
  },
  rust: {
    label: 'Rust',
    description: 'Rust version (shown in Rust projects)',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: () => '🦀 1.80.0',
  },
  docker_context: {
    label: 'Docker',
    description: 'Docker context name',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: () => '🐳 default',
  },
  kubernetes: {
    label: 'Kubernetes',
    description: 'K8s cluster context and namespace',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: () => '☸ prod',
  },
  aws: {
    label: 'AWS',
    description: 'AWS region and profile',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: () => '☁️ us-east-1',
  },
  time: {
    label: 'Time',
    description: 'Current time',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: () => '12:34',
  },
  battery: {
    label: 'Battery',
    description: 'Battery percentage (shown when below threshold)',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: () => '🔋 85%',
  },
  cmd_duration: {
    label: 'Command Duration',
    description: 'Time taken by the last command',
    defaultLeft: false,
    defaultRight: true,

    previewSegment: () => '2s',
  },
  jobs: {
    label: 'Background Jobs',
    description: 'Number of background jobs',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: () => '2',
  },
};

/**
 * Derived from MODULE_DEFS so the compiler enforces one entry per module id —
 * a new ModuleId with no definition is a build error, not a runtime undefined.
 */
export const MODULES: readonly ModuleDef[] = (
  Object.keys(MODULE_DEFS) as ConfigurableModuleId[]
).map((id) => ({ id, ...MODULE_DEFS[id] }));

export function getModule(id: string): ModuleDef | undefined {
  return MODULES.find((m) => m.id === id);
}
