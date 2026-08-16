import { vi, describe, it, expect, beforeEach } from 'vitest';

const { mockExecFile, mockReadFile } = vi.hoisted(() => {
  const mockExecFile = vi.fn();
  const mockReadFile = vi.fn();

  // promisify(execFile) uses a custom symbol to return {stdout, stderr}
  // The mock needs this so the promisified wrapper resolves correctly.
  const customPromisify = Symbol.for('nodejs.util.promisify.custom');
  (mockExecFile as unknown as Record<symbol, unknown>)[customPromisify] = (...args: unknown[]) =>
    new Promise((resolve, reject) => {
      mockExecFile(...args, (err: Error | null, stdout: string, stderr: string) => {
        if (err) reject(err);
        else resolve({ stdout, stderr });
      });
    });

  return { mockExecFile, mockReadFile };
});

vi.mock('child_process', () => ({
  execFile: mockExecFile,
}));

vi.mock('fs', () => ({
  readFile: mockReadFile,
}));

import {
  detectPackageManagerAsync,
  isStarshipInstalledAsync,
  detectInstalledShellsAsync,
} from '../../services/detector.ts';

function execFileSucceeds(stdout = '') {
  mockExecFile.mockImplementation((...args: unknown[]) => {
    const cb = args[args.length - 1] as (...cbArgs: unknown[]) => void;
    cb(null, stdout, '');
  });
}

function execFileFails() {
  mockExecFile.mockImplementation((...args: unknown[]) => {
    const cb = args[args.length - 1] as (...cbArgs: unknown[]) => void;
    cb(new Error('command not found'), '', '');
  });
}

function execFileByArg(match: (arg: string) => boolean, stdout = '/usr/bin/cmd') {
  mockExecFile.mockImplementation((...args: unknown[]) => {
    const cb = args[args.length - 1] as (...cbArgs: unknown[]) => void;
    const cmdArgs = args[1] as string[];
    if (match(cmdArgs[3]!)) {
      cb(null, stdout, '');
    } else {
      cb(new Error('not found'), '', '');
    }
  });
}

function readFileAsyncReturns(content: string) {
  mockReadFile.mockImplementation((...args: unknown[]) => {
    const cb = args[args.length - 1] as (...cbArgs: unknown[]) => void;
    cb(null, content);
  });
}

function readFileAsyncFails() {
  mockReadFile.mockImplementation((...args: unknown[]) => {
    const cb = args[args.length - 1] as (...cbArgs: unknown[]) => void;
    cb(new Error('no os-release'));
  });
}

describe('detectPackageManagerAsync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readFileAsyncFails();
  });

  it('returns brew when brew is installed', async () => {
    execFileSucceeds();
    expect(await detectPackageManagerAsync()).toBe('brew');
  });

  it('returns pacman when brew is absent and pacman is installed', async () => {
    execFileByArg((arg) => arg !== 'brew');
    expect(await detectPackageManagerAsync()).toBe('pacman');
  });

  it('returns apt for ubuntu via os-release', async () => {
    execFileFails();
    readFileAsyncReturns('ID=ubuntu\nNAME="Ubuntu"');
    expect(await detectPackageManagerAsync()).toBe('apt');
  });

  it('returns dnf for fedora via os-release', async () => {
    execFileFails();
    readFileAsyncReturns('ID=fedora\nNAME="Fedora"');
    expect(await detectPackageManagerAsync()).toBe('dnf');
  });

  it('returns pacman for arch via os-release', async () => {
    execFileFails();
    readFileAsyncReturns('ID=arch\nNAME="Arch Linux"');
    expect(await detectPackageManagerAsync()).toBe('pacman');
  });

  it('returns apt for single-quoted ubuntu ID in os-release', async () => {
    execFileFails();
    readFileAsyncReturns("ID='ubuntu'\nNAME='Ubuntu'");
    expect(await detectPackageManagerAsync()).toBe('apt');
  });

  it('returns script as fallback when nothing is detected', async () => {
    execFileFails();
    expect(await detectPackageManagerAsync()).toBe('script');
  });
});

describe('isStarshipInstalledAsync', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns installed true with version string', async () => {
    execFileSucceeds('starship 1.20.0');
    const result = await isStarshipInstalledAsync();
    expect(result.installed).toBe(true);
    expect(result.version).toBe('starship 1.20.0');
  });

  it('returns installed false when starship is not found', async () => {
    execFileFails();
    const result = await isStarshipInstalledAsync();
    expect(result.installed).toBe(false);
    expect(result.version).toBeUndefined();
  });
});

describe('detectInstalledShellsAsync', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns shells whose binaries exist', async () => {
    execFileByArg((arg) => arg === 'bash' || arg === 'zsh');
    const shells = await detectInstalledShellsAsync();
    expect(shells).toContain('bash');
    expect(shells).toContain('zsh');
    expect(shells).not.toContain('fish');
    expect(shells).not.toContain('nushell');
  });

  it('returns empty array when no shells are found', async () => {
    execFileFails();
    expect(await detectInstalledShellsAsync()).toEqual([]);
  });

  it('returns all shells when all binaries exist', async () => {
    execFileSucceeds('/usr/bin/shell');
    const shells = await detectInstalledShellsAsync();
    // Order follows the SHELLS table, which is the single source of truth.
    expect(shells).toEqual(['zsh', 'bash', 'fish', 'nushell', 'powershell']);
  });
});
