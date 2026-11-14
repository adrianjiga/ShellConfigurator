import { spawnSync } from 'node:child_process';

export const hasBinary = (binary: string): boolean =>
  spawnSync('sh', ['-c', 'command -v "$1"', 'sh', binary]).status === 0;
