import { vi, describe, it, expect, beforeEach } from 'vitest';

const { mockExecSync, mockReadFileSync } = vi.hoisted(() => ({
  mockExecSync: vi.fn(),
  mockReadFileSync: vi.fn(),
}));

vi.mock('child_process', () => ({
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
    mockExecSync.mockImplementation(() => '');

    expect(detectPackageManager()).toBe('brew');
  });

  it('returns pacman when brew is absent and pacman is installed', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'which brew') throw new Error();
      return '';
    });

    expect(detectPackageManager()).toBe('pacman');
  });

  it('returns apt for ubuntu via os-release', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error();
    });
    mockReadFileSync.mockImplementation(() => 'ID=ubuntu\nNAME="Ubuntu"');

    expect(detectPackageManager()).toBe('apt');
  });

  it('returns dnf for fedora via os-release', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error();
    });
    mockReadFileSync.mockImplementation(() => 'ID=fedora\nNAME="Fedora"');

    expect(detectPackageManager()).toBe('dnf');
  });

  it('returns pacman for arch via os-release', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error();
    });
    mockReadFileSync.mockImplementation(() => 'ID=arch\nNAME="Arch Linux"');

    expect(detectPackageManager()).toBe('pacman');
  });

  it('returns curl as fallback when nothing is detected', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error();
    });

    expect(detectPackageManager()).toBe('curl');
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
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'which bash' || cmd === 'which zsh') return '/usr/bin/bash';
      throw new Error();
    });

    const shells = detectInstalledShells();

    expect(shells).toContain('bash');
    expect(shells).toContain('zsh');
    expect(shells).not.toContain('fish');
    expect(shells).not.toContain('nushell');
  });

  it('returns empty array when no shells are found', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error();
    });

    expect(detectInstalledShells()).toEqual([]);
  });

  it('returns all shells when all binaries exist', () => {
    mockExecSync.mockImplementation(() => '/usr/bin/shell');

    const shells = detectInstalledShells();

    expect(shells).toEqual(['bash', 'zsh', 'fish', 'nushell', 'powershell']);
  });
});
