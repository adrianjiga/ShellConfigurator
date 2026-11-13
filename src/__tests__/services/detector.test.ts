import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  detectContainerAsync,
  detectCurrentShellAsync,
  detectInstalledShellsAsync,
  detectPackageManagerAsync,
  detectTerminalAsync,
  isStarshipInstalledAsync,
} from '../../services/detector.ts';

// `command -v` always prints a path on success, so a found command must have non-empty stdout.
function execFileSucceeds(stdout = '/usr/bin/cmd') {
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
    execFileByArg((arg) => arg === 'apt-get');
    readFileAsyncReturns('ID=ubuntu\nNAME="Ubuntu"');
    expect(await detectPackageManagerAsync()).toBe('apt');
  });

  it('returns dnf for fedora via os-release', async () => {
    execFileByArg((arg) => arg === 'dnf');
    readFileAsyncReturns('ID=fedora\nNAME="Fedora"');
    expect(await detectPackageManagerAsync()).toBe('dnf');
  });

  it('maps AlmaLinux, whose os-release id is almalinux, to dnf', async () => {
    execFileByArg((arg) => arg === 'apt-get' || arg === 'dnf');
    readFileAsyncReturns('ID="almalinux"\nID_LIKE="rhel centos fedora"');
    expect(await detectPackageManagerAsync()).toBe('dnf');
  });

  it('maps a derivative through ID_LIKE', async () => {
    execFileByArg((arg) => arg === 'apt-get' || arg === 'dnf');
    readFileAsyncReturns('ID=kali\nID_LIKE=debian');
    expect(await detectPackageManagerAsync()).toBe('apt');
  });

  it('falls back to /usr/lib/os-release when /etc/os-release is missing', async () => {
    execFileByArg((arg) => arg === 'apt-get' || arg === 'dnf');
    mockReadFile.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (...cbArgs: unknown[]) => void;
      if (args[0] === '/usr/lib/os-release') cb(null, 'ID=fedora');
      else cb(new Error('ENOENT'));
    });
    expect(await detectPackageManagerAsync()).toBe('dnf');
  });

  it('lets the distro id choose between several package managers', async () => {
    execFileByArg((arg) => arg === 'apt-get' || arg === 'dnf');
    readFileAsyncReturns('ID=fedora\nNAME="Fedora"');
    expect(await detectPackageManagerAsync()).toBe('dnf');
  });

  it('ignores a distro id whose package manager binary is missing', async () => {
    execFileFails();
    readFileAsyncReturns('ID=centos\nVERSION_ID="7"');
    expect(await detectPackageManagerAsync()).toBe('script');
  });

  it('does not return pacman for an arch id when pacman is missing', async () => {
    execFileFails();
    readFileAsyncReturns('ID=arch\nNAME="Arch Linux"');
    expect(await detectPackageManagerAsync()).toBe('script');
  });

  it('returns apt for single-quoted ubuntu ID in os-release', async () => {
    execFileByArg((arg) => arg === 'apt-get');
    readFileAsyncReturns("ID='ubuntu'\nNAME='Ubuntu'");
    expect(await detectPackageManagerAsync()).toBe('apt');
  });

  it('returns apk for alpine via os-release', async () => {
    execFileByArg((arg) => arg === 'apk');
    readFileAsyncReturns('ID=alpine\nNAME="Alpine Linux"');
    expect(await detectPackageManagerAsync()).toBe('apk');
  });

  it('returns apk when only the apk binary is present', async () => {
    execFileByArg((arg) => arg === 'apk');
    expect(await detectPackageManagerAsync()).toBe('apk');
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

describe('detectCurrentShellAsync', () => {
  const originalShell = process.env.SHELL;

  afterEach(() => {
    if (originalShell === undefined) delete process.env.SHELL;
    else process.env.SHELL = originalShell;
    vi.clearAllMocks();
  });

  it('detects a shell from $SHELL path', async () => {
    process.env.SHELL = '/usr/bin/zsh';
    expect(await detectCurrentShellAsync()).toBe('zsh');
  });

  it('detects bash from a bare $SHELL name', async () => {
    process.env.SHELL = 'bash';
    expect(await detectCurrentShellAsync()).toBe('bash');
  });

  /** Answers `ps -p <ppid> -o comm=` with `comm`, and nothing else. */
  function psReports(comm: string) {
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (...cbArgs: unknown[]) => void;
      const [cmd, cmdArgs] = args as [string, string[]];
      if (cmd === 'ps' && cmdArgs[1] === String(process.ppid)) cb(null, comm, '');
      else cb(new Error('not found'), '', '');
    });
  }

  it("falls back to the parent process's ps comm when $SHELL is unknown", async () => {
    process.env.SHELL = '/usr/bin/weird-shell';
    psReports('fish');
    expect(await detectCurrentShellAsync()).toBe('fish');
  });

  it('recognises a login shell reported with a leading dash', async () => {
    process.env.SHELL = '/usr/bin/weird-shell';
    psReports('-zsh');
    expect(await detectCurrentShellAsync()).toBe('zsh');
  });

  it('returns null when neither $SHELL nor ps identifies a shell', async () => {
    process.env.SHELL = '/usr/bin/weird-shell';
    execFileFails();
    expect(await detectCurrentShellAsync()).toBeNull();
  });

  it('returns null when $SHELL is not set', async () => {
    delete process.env.SHELL;
    execFileFails();
    expect(await detectCurrentShellAsync()).toBeNull();
  });
});

describe('detectTerminalAsync', () => {
  const TERMINAL_ENV = [
    'KITTY_WINDOW_ID',
    'TERM',
    'TERM_PROGRAM',
    'GHOSTTY_RESOURCES_DIR',
    'WEZTERM_PANE',
    'ALACRITTY_WINDOW_ID',
    'ALACRITTY_SOCKET',
  ];

  beforeEach(() => {
    for (const name of TERMINAL_ENV) vi.stubEnv(name, '');
  });

  afterEach(() => vi.unstubAllEnvs());

  it('detects kitty from its window id', async () => {
    vi.stubEnv('KITTY_WINDOW_ID', '1');
    expect(await detectTerminalAsync()).toBe('kitty');
  });

  it('detects kitty from TERM', async () => {
    vi.stubEnv('TERM', 'xterm-kitty');
    expect(await detectTerminalAsync()).toBe('kitty');
  });

  it('detects ghostty from its resources dir', async () => {
    vi.stubEnv('GHOSTTY_RESOURCES_DIR', '/usr/share/ghostty');
    expect(await detectTerminalAsync()).toBe('ghostty');
  });

  it('detects wezterm from its pane id', async () => {
    vi.stubEnv('WEZTERM_PANE', '0');
    expect(await detectTerminalAsync()).toBe('wezterm');
  });

  it('detects alacritty from its window id', async () => {
    vi.stubEnv('ALACRITTY_WINDOW_ID', '123');
    expect(await detectTerminalAsync()).toBe('alacritty');
  });

  it('detects foot from TERM', async () => {
    vi.stubEnv('TERM', 'foot');
    expect(await detectTerminalAsync()).toBe('foot');
  });

  it('returns null for an unrecognised terminal', async () => {
    vi.stubEnv('TERM', 'xterm-256color');
    expect(await detectTerminalAsync()).toBeNull();
  });
});

describe('detectContainerAsync', () => {
  const CONTAINER_ENV = [
    'CODESPACES',
    'REMOTE_CONTAINERS',
    'DEVCONTAINER',
    'CI',
    'KUBERNETES_SERVICE_HOST',
    'container',
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    for (const name of CONTAINER_ENV) vi.stubEnv(name, '');
    readFileAsyncFails();
  });

  afterEach(() => vi.unstubAllEnvs());

  it.each(CONTAINER_ENV)('returns true when %s is set', async (name) => {
    vi.stubEnv(name, '1');
    expect(await detectContainerAsync()).toBe(true);
  });

  it.each(['false', '0', 'no', 'FALSE'])('ignores CI=%s', async (value) => {
    vi.stubEnv('CI', value);
    expect(await detectContainerAsync()).toBe(false);
  });

  it('returns true for /run/.containerenv', async () => {
    mockReadFile.mockImplementation((filePath: string, ...args: unknown[]) => {
      const cb = args[args.length - 1] as (...cbArgs: unknown[]) => void;
      if (filePath === '/run/.containerenv') cb(null, '');
      else cb(new Error('ENOENT'));
    });
    expect(await detectContainerAsync()).toBe(true);
  });

  it('returns true for the Docker marker file', async () => {
    mockReadFile.mockImplementation((filePath: string, ...args: unknown[]) => {
      const cb = args[args.length - 1] as (...cbArgs: unknown[]) => void;
      if (filePath === '/.dockerenv') cb(null, '');
      else cb(new Error('ENOENT'));
    });
    expect(await detectContainerAsync()).toBe(true);
  });

  it('returns true for the systemd container marker (nspawn, LXC)', async () => {
    mockReadFile.mockImplementation((filePath: string, ...args: unknown[]) => {
      const cb = args[args.length - 1] as (...cbArgs: unknown[]) => void;
      if (filePath === '/run/systemd/container') cb(null, 'lxc\n');
      else cb(new Error('ENOENT'));
    });
    expect(await detectContainerAsync()).toBe(true);
  });

  it('returns false when no marker is present', async () => {
    readFileAsyncFails();
    expect(await detectContainerAsync()).toBe(false);
  });
});
