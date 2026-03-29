export interface ModuleDef {
  id: string;
  label: string;
  description: string;
  defaultLeft: boolean;
  defaultRight: boolean;
  // Returns a short colored preview string for the prompt preview
  previewSegment: (hasNerdFont: boolean) => string;
  // Segment key in format string (usually same as id)
  formatKey: string;
}

export const MODULES: ModuleDef[] = [
  {
    id: 'username',
    label: 'Username',
    description: 'Current user (shown when SSH or root)',
    defaultLeft: false,
    defaultRight: false,
    formatKey: 'username',
    previewSegment: () => 'user',
  },
  {
    id: 'hostname',
    label: 'Hostname',
    description: 'Machine hostname (shown when SSH)',
    defaultLeft: false,
    defaultRight: false,
    formatKey: 'hostname',
    previewSegment: () => 'host',
  },
  {
    id: 'directory',
    label: 'Directory',
    description: 'Current directory path',
    defaultLeft: true,
    defaultRight: false,
    formatKey: 'directory',
    previewSegment: () => '~/projects/myapp',
  },
  {
    id: 'git_branch',
    label: 'Git Branch',
    description: 'Active git branch name',
    defaultLeft: true,
    defaultRight: false,
    formatKey: 'git_branch',
    previewSegment: (nf) => `${nf ? ' ' : 'on '}main`,
  },
  {
    id: 'git_status',
    label: 'Git Status',
    description: 'Staged, modified, and untracked file counts',
    defaultLeft: true,
    defaultRight: false,
    formatKey: 'git_status',
    previewSegment: () => '+1',
  },
  {
    id: 'nodejs',
    label: 'Node.js',
    description: 'Node version (shown in JS/TS projects)',
    defaultLeft: false,
    defaultRight: false,
    formatKey: 'nodejs',
    previewSegment: (nf) => `${nf ? ' ' : 'node '}v22.0.0`,
  },
  {
    id: 'python',
    label: 'Python',
    description: 'Python version (shown in Python projects)',
    defaultLeft: false,
    defaultRight: false,
    formatKey: 'python',
    previewSegment: (nf) => `${nf ? ' ' : 'py '}3.12.0`,
  },
  {
    id: 'rust',
    label: 'Rust',
    description: 'Rust version (shown in Rust projects)',
    defaultLeft: false,
    defaultRight: false,
    formatKey: 'rust',
    previewSegment: (nf) => `${nf ? '🦀 ' : 'rs '}1.80.0`,
  },
  {
    id: 'docker_context',
    label: 'Docker',
    description: 'Docker context name',
    defaultLeft: false,
    defaultRight: false,
    formatKey: 'docker_context',
    previewSegment: (nf) => `${nf ? '🐳 ' : 'docker:'}default`,
  },
  {
    id: 'kubernetes',
    label: 'Kubernetes',
    description: 'K8s cluster context and namespace',
    defaultLeft: false,
    defaultRight: false,
    formatKey: 'kubernetes',
    previewSegment: (nf) => `${nf ? '☸ ' : 'k8s:'}prod`,
  },
  {
    id: 'aws',
    label: 'AWS',
    description: 'AWS region and profile',
    defaultLeft: false,
    defaultRight: false,
    formatKey: 'aws',
    previewSegment: (nf) => `${nf ? '☁️ ' : 'aws:'}us-east-1`,
  },
  {
    id: 'time',
    label: 'Time',
    description: 'Current time',
    defaultLeft: false,
    defaultRight: false,
    formatKey: 'time',
    previewSegment: () => '12:34',
  },
  {
    id: 'battery',
    label: 'Battery',
    description: 'Battery percentage (shown when below threshold)',
    defaultLeft: false,
    defaultRight: false,
    formatKey: 'battery',
    previewSegment: (nf) => `${nf ? '🔋' : ''}85%`,
  },
  {
    id: 'cmd_duration',
    label: 'Command Duration',
    description: 'Time taken by the last command',
    defaultLeft: false,
    defaultRight: true,
    formatKey: 'cmd_duration',
    previewSegment: () => '2s',
  },
  {
    id: 'jobs',
    label: 'Background Jobs',
    description: 'Number of background jobs',
    defaultLeft: false,
    defaultRight: false,
    formatKey: 'jobs',
    previewSegment: () => '2',
  },
];

export function getModule(id: string): ModuleDef | undefined {
  return MODULES.find((m) => m.id === id);
}
