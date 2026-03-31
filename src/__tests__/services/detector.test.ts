import { vi, describe, it, expect, beforeEach } from 'vitest';

const { mockExecFileSync, mockExecSync, mockReadFileSync } = vi.hoisted(() => ({
  mockExecFileSync: vi.fn(),
  mockExecSync: vi.fn(),
  mockReadFileSync: vi.fn(),
}));

vi.mock('child_process', () => ({
  execFileSync: mockExecFileSync,
  execSync: mockExecSync,
}));

vi.mock('fs', () => ({
  readFileSync: mockReadFileSync,
}));

import {
  detectPackageManager,
  isStarshipInstalled,
  detectInstalledShells,
} from '../../services/detector.js';

describe('detectPackageManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFileSync.mockImplementation(() => {
      throw new Error('no os-release');
    });
  });

  it('returns brew when brew is installed', () => {
    mockExecFileSync.mockImplementation(() => '');

    expect(detectPackageManager()).toBe('brew');
  });

  it('returns pacman when brew is absent and pacman is installed', () => {
    mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === 'brew') throw new Error();
      return '';
    });

    expect(detectPackageManager()).toBe('pacman');
  });

  it('returns apt for ubuntu via os-release', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error();
    });
    mockReadFileSync.mockImplementation(() => 'ID=ubuntu\nNAME="Ubuntu"');

    expect(detectPackageManager()).toBe('apt');
  });

  it('returns dnf for fedora via os-release', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error();
    });
    mockReadFileSync.mockImplementation(() => 'ID=fedora\nNAME="Fedora"');

    expect(detectPackageManager()).toBe('dnf');
  });

  it('returns pacman for arch via os-release', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error();
    });
    mockReadFileSync.mockImplementation(() => 'ID=arch\nNAME="Arch Linux"');

    expect(detectPackageManager()).toBe('pacman');
  });

  it('returns apt for single-quoted ubuntu ID in os-release', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error();
    });
    mockReadFileSync.mockImplementation(() => "ID='ubuntu'\nNAME='Ubuntu'");

    expect(detectPackageManager()).toBe('apt');
  });

  it('returns script as fallback when nothing is detected', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error();
    });

    expect(detectPackageManager()).toBe('script');
  });
});

describe('isStarshipInstalled', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns installed true with version string', () => {
    mockExecSync.mockReturnValue('starship 1.20.0');

    const result = isStarshipInstalled();

    expect(result.installed).toBe(true);
    expect(result.version).toBe('starship 1.20.0');
  });

  it('returns installed false when starship is not found', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('command not found');
    });

    const result = isStarshipInstalled();

    expect(result.installed).toBe(false);
    expect(result.version).toBeUndefined();
  });
});

describe('detectInstalledShells', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns shells whose binaries exist', () => {
    mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === 'bash' || args[0] === 'zsh') return '/usr/bin/bash';
      throw new Error();
    });

    const shells = detectInstalledShells();

    expect(shells).toContain('bash');
    expect(shells).toContain('zsh');
    expect(shells).not.toContain('fish');
    expect(shells).not.toContain('nushell');
  });

  it('returns empty array when no shells are found', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error();
    });

    expect(detectInstalledShells()).toEqual([]);
  });

  it('returns all shells when all binaries exist', () => {
    mockExecFileSync.mockImplementation(() => '/usr/bin/shell');

    const shells = detectInstalledShells();

    expect(shells).toEqual(['bash', 'zsh', 'fish', 'nushell', 'powershell']);
  });
});
