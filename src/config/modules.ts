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

export interface ModuleDef {
  id: string;
  label: string;
  description: string;
  defaultLeft: boolean;
  defaultRight: boolean;
  // Returns a short colored preview string for the prompt preview
  previewSegment: (hasNerdFont: boolean) => string;
}

export const MODULES: ModuleDef[] = [
  {
    id: 'username',
    label: 'Username',
    description: 'Current user (shown when SSH or root)',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: () => 'user',
  },
  {
    id: 'hostname',
    label: 'Hostname',
    description: 'Machine hostname (shown when SSH)',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: () => 'host',
  },
  {
    id: 'directory',
    label: 'Directory',
    description: 'Current directory path',
    defaultLeft: true,
    defaultRight: false,

    previewSegment: () => '~/projects/myapp',
  },
  {
    id: 'git_branch',
    label: 'Git Branch',
    description: 'Active git branch name',
    defaultLeft: true,
    defaultRight: false,

    previewSegment: (nf) => `${nf ? ' ' : 'on '}main`,
  },
  {
    id: 'git_status',
    label: 'Git Status',
    description: 'Staged, modified, and untracked file counts',
    defaultLeft: true,
    defaultRight: false,

    previewSegment: () => '+1',
  },
  {
    id: 'nodejs',
    label: 'Node.js',
    description: 'Node version (shown in JS/TS projects)',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: (nf) => `${nf ? ' ' : 'node '}v22.0.0`,
  },
  {
    id: 'python',
    label: 'Python',
    description: 'Python version (shown in Python projects)',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: (nf) => `${nf ? ' ' : 'py '}3.12.0`,
  },
  {
    id: 'rust',
    label: 'Rust',
    description: 'Rust version (shown in Rust projects)',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: (nf) => `${nf ? '🦀 ' : 'rs '}1.80.0`,
  },
  {
    id: 'docker_context',
    label: 'Docker',
    description: 'Docker context name',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: (nf) => `${nf ? '🐳 ' : 'docker:'}default`,
  },
  {
    id: 'kubernetes',
    label: 'Kubernetes',
    description: 'K8s cluster context and namespace',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: (nf) => `${nf ? '☸ ' : 'k8s:'}prod`,
  },
  {
    id: 'aws',
    label: 'AWS',
    description: 'AWS region and profile',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: (nf) => `${nf ? '☁️ ' : 'aws:'}us-east-1`,
  },
  {
    id: 'time',
    label: 'Time',
    description: 'Current time',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: () => '12:34',
  },
  {
    id: 'battery',
    label: 'Battery',
    description: 'Battery percentage (shown when below threshold)',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: (nf) => `${nf ? '🔋' : ''}85%`,
  },
  {
    id: 'cmd_duration',
    label: 'Command Duration',
    description: 'Time taken by the last command',
    defaultLeft: false,
    defaultRight: true,

    previewSegment: () => '2s',
  },
  {
    id: 'jobs',
    label: 'Background Jobs',
    description: 'Number of background jobs',
    defaultLeft: false,
    defaultRight: false,

    previewSegment: () => '2',
  },
];

export function getModule(id: string): ModuleDef | undefined {
  return MODULES.find((m) => m.id === id);
}
