import { vi } from 'vitest';
import type { InstallTaskDeps } from '../../services/installTasks.ts';

/** A runInstallTasks deps object that succeeds everywhere; override per test. */
export function fakeDeps(overrides: Partial<InstallTaskDeps> = {}): InstallTaskDeps {
  return {
    isStarshipInstalled: vi.fn().mockResolvedValue({ installed: false }),
    installStarship: vi.fn().mockResolvedValue(undefined),
    installNerdFont: vi.fn().mockResolvedValue(undefined),
    installShell: vi.fn().mockResolvedValue(undefined),
    setDefaultShell: vi.fn().mockResolvedValue(undefined),
    generateToml: vi.fn(() => 'format = "$character"'),
    writeShellConfig: vi.fn(() => ({ path: '/home/u/.config/starship/zsh.toml' })),
    backupSharedConfig: vi.fn(() => null),
    applyShellConfig: vi.fn(() => ({ applied: true })),
    resetSharedShellConfig: vi.fn(() => ({ applied: false })),
    getShellsUsingStarship: vi.fn().mockResolvedValue([]),
    getMissingStarshipPathDir: vi.fn(() => null),
    ...overrides,
  };
}
