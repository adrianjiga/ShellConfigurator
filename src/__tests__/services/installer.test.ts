import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import { EventEmitter } from 'events';

const {
  mockSpawn,
  mockExecFileSync,
  mockMkdirSync,
  mockMkdtempSync,
  mockWriteFileSync,
  mockCopyFileSync,
  mockReaddirSync,
  mockRmSync,
  mockExistsSync,
  mockStatSync,
} = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockExecFileSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockMkdtempSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockCopyFileSync: vi.fn(),
  mockReaddirSync: vi.fn(),
  mockRmSync: vi.fn(),
  mockExistsSync: vi.fn(),
  mockStatSync: vi.fn(),
}));

vi.mock('child_process', () => ({
  execFileSync: mockExecFileSync,
  spawn: mockSpawn,
  // exec.ts promisifies execFile; unused here but must exist on the mock.
  execFile: Object.assign(vi.fn(), {
    [Symbol.for('nodejs.util.promisify.custom')]: vi.fn(),
  }),
}));

vi.mock('fs', () => ({
  mkdirSync: mockMkdirSync,
  mkdtempSync: mockMkdtempSync,
  writeFileSync: mockWriteFileSync,
  copyFileSync: mockCopyFileSync,
  readdirSync: mockReaddirSync,
  rmSync: mockRmSync,
  existsSync: mockExistsSync,
  statSync: mockStatSync,
}));

import {
  installStarship,
  installShell,
  installNerdFont,
  setDefaultShell,
  getNerdFontsDir,
  getMissingStarshipPathDir,
  SCRIPT_INSTALL_BIN_DIR,
} from '../../services/installer.js';

function dirent(name: string, isDirectory = false) {
  return { name, isDirectory: () => isDirectory };
}

interface SpawnOutcome {
  status?: number | null;
  signal?: string | null;
  error?: Error;
}

/** A stand-in for the async child returned by spawn(), settling on the next tick. */
function childFor(outcome: SpawnOutcome) {
  const child = new EventEmitter() as EventEmitter & { kill: ReturnType<typeof vi.fn> };
  child.kill = vi.fn();
  setImmediate(() => {
    if (outcome.error) child.emit('error', outcome.error);
    else child.emit('close', outcome.status ?? 0, outcome.signal ?? null);
  });
  return child;
}

function spawnOutcome(outcome: SpawnOutcome) {
  mockSpawn.mockImplementation(() => childFor(outcome));
}

/** Minimal stand-in for the parts of Response that installNerdFont actually uses. */
function okResponse(overrides: Partial<Response> = {}): Response {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => new ArrayBuffer(0),
    ...overrides,
  } as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Defaults: commands succeed, all binaries exist, fetch succeeds
  spawnOutcome({ status: 0 });
  mockExecFileSync.mockReturnValue('');
  mockMkdirSync.mockImplementation(() => undefined);
  mockMkdtempSync.mockReturnValue('/tmp/shellconf-font-test');
  mockWriteFileSync.mockImplementation(() => undefined);
  mockCopyFileSync.mockImplementation(() => undefined);
  mockRmSync.mockImplementation(() => undefined);
  mockExistsSync.mockReturnValue(true);
  mockStatSync.mockReturnValue({ size: 1024 });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse()));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('installStarship', () => {
  it('installs via apt', async () => {
    await installStarship('apt');
    expect(mockSpawn).toHaveBeenCalledWith('sudo', ['apt-get', 'install', '-y', 'starship'], {
      stdio: 'inherit',
    });
  });

  it('installs via dnf', async () => {
    await installStarship('dnf');
    expect(mockSpawn).toHaveBeenCalledWith('sudo', ['dnf', 'install', '-y', 'starship'], {
      stdio: 'inherit',
    });
  });

  it('installs via pacman', async () => {
    await installStarship('pacman');
    expect(mockSpawn).toHaveBeenCalledWith('sudo', ['pacman', '-S', '--noconfirm', 'starship'], {
      stdio: 'inherit',
    });
  });

  it('installs via brew without sudo', async () => {
    await installStarship('brew');
    expect(mockSpawn).toHaveBeenCalledWith('brew', ['install', 'starship'], {
      stdio: 'inherit',
    });
  });

  it('downloads the install script to a file and runs it separately', async () => {
    await installStarship('script');

    // Downloading and running are separate commands so a failed download is not
    // masked by the exit status of the shell reading from the pipe.
    expect(mockSpawn).toHaveBeenCalledWith(
      'curl',
      ['-fsS', '-o', expect.stringContaining('install.sh'), 'https://starship.rs/install.sh'],
      { stdio: 'inherit' }
    );
    expect(mockSpawn).toHaveBeenCalledWith('sh', [expect.stringContaining('install.sh'), '--yes'], {
      stdio: 'inherit',
    });
  });

  it('fails when the download fails instead of reporting success', async () => {
    mockSpawn.mockImplementation((cmd: string) =>
      childFor(cmd === 'curl' ? { status: 22 } : { status: 0 })
    );

    await expect(installStarship('script')).rejects.toThrow('exit code 22');
    // The script must never be executed after a failed download.
    expect(mockSpawn).not.toHaveBeenCalledWith('sh', expect.anything(), expect.anything());
  });

  it('fails when the downloaded script is empty', async () => {
    mockStatSync.mockReturnValue({ size: 0 });

    await expect(installStarship('script')).rejects.toThrow('empty install script');
  });

  it('cleans up the temp dir even when the install fails', async () => {
    spawnOutcome({ status: 1 });

    await expect(installStarship('script')).rejects.toThrow();
    expect(mockRmSync).toHaveBeenCalledWith(expect.any(String), {
      recursive: true,
      force: true,
    });
  });

  it('throws a clear error when curl is missing for the script path', async () => {
    mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args[3] === 'curl') throw new Error('command not found');
      return '';
    });

    await expect(installStarship('script')).rejects.toThrow('"curl" is not installed');
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('throws the spawned error when the command cannot start', async () => {
    const boom = new Error('spawn ENOENT');
    spawnOutcome({ error: boom });

    await expect(installStarship('apt')).rejects.toThrow('spawn ENOENT');
  });

  it('throws when the command exits with a non-zero status', async () => {
    spawnOutcome({ status: 1 });

    await expect(installStarship('apt')).rejects.toThrow('exit code 1');
  });

  it('throws when the command is killed by a signal', async () => {
    spawnOutcome({ signal: 'SIGKILL', status: null });

    await expect(installStarship('apt')).rejects.toThrow('killed by signal SIGKILL');
  });
});

describe('installShell', () => {
  it('installs zsh via apt', async () => {
    await installShell('zsh', 'apt');
    expect(mockSpawn).toHaveBeenCalledWith('sudo', ['apt-get', 'install', '-y', 'zsh'], {
      stdio: 'inherit',
    });
  });

  it('installs fish via brew', async () => {
    await installShell('fish', 'brew');
    expect(mockSpawn).toHaveBeenCalledWith('brew', ['install', 'fish'], {
      stdio: 'inherit',
    });
  });

  it('installs nushell via apt', async () => {
    await installShell('nushell', 'apt');
    expect(mockSpawn).toHaveBeenCalledWith('sudo', ['apt-get', 'install', '-y', 'nushell'], {
      stdio: 'inherit',
    });
  });

  it('throws a clear error on the script fallback (no package manager)', async () => {
    await expect(installShell('zsh', 'script')).rejects.toThrow('Cannot auto-install zsh');
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('throws when the shell has no package for the package manager', async () => {
    await expect(installShell('powershell', 'apt')).rejects.toThrow(
      'No package for powershell on apt'
    );
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});

describe('installNerdFont', () => {
  it('throws for an unknown font id', async () => {
    await expect(installNerdFont('NotAFont')).rejects.toThrow('Unknown font: NotAFont');
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('throws when the download fails and still cleans up temp files', async () => {
    vi.mocked(fetch).mockResolvedValue(okResponse({ ok: false, status: 404 }));

    await expect(installNerdFont('FiraCode')).rejects.toThrow('Failed to download font: HTTP 404');
    expect(mockRmSync).toHaveBeenCalledWith('/tmp/shellconf-font-test', {
      recursive: true,
      force: true,
    });
  });

  it('throws a clear error when unzip is missing and still cleans up', async () => {
    mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args[3] === 'unzip') throw new Error('command not found');
      return '';
    });

    await expect(installNerdFont('FiraCode')).rejects.toThrow('"unzip" is not installed');
    expect(mockRmSync).toHaveBeenCalled();
  });

  it('throws when the zip contains no font files', async () => {
    mockReaddirSync.mockReturnValue([dirent('LICENSE.md'), dirent('readme.md')]);

    await expect(installNerdFont('FiraCode')).rejects.toThrow(
      'No font files found in FiraCode.zip'
    );
    expect(mockCopyFileSync).not.toHaveBeenCalled();
  });

  it('copies only font files into the fonts dir', async () => {
    mockReaddirSync.mockReturnValue([
      dirent('FiraCodeNerdFont.ttf'),
      dirent('FiraCodeNerdFont-Italic.otf'),
      dirent('LICENSE.md'),
    ]);

    await installNerdFont('FiraCode');

    const fontsDir = getNerdFontsDir();
    expect(mockCopyFileSync).toHaveBeenCalledTimes(2);
    expect(mockCopyFileSync).toHaveBeenCalledWith(
      path.join('/tmp/shellconf-font-test', 'FiraCodeNerdFont.ttf'),
      path.join(fontsDir, 'FiraCodeNerdFont.ttf')
    );
    expect(mockCopyFileSync).not.toHaveBeenCalledWith(
      expect.anything(),
      path.join(fontsDir, 'LICENSE.md')
    );
  });

  it('ignores fc-cache failures on linux (non-fatal)', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    try {
      mockSpawn
        .mockImplementationOnce(() => childFor({ status: 0 }))
        .mockImplementationOnce(() => childFor({ status: 1 }));
      mockReaddirSync.mockReturnValue([dirent('FiraCodeNerdFont.ttf')]);

      await expect(installNerdFont('FiraCode')).resolves.toBeUndefined();
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });
});

describe('setDefaultShell', () => {
  it('sets the default shell via chsh', async () => {
    mockExecFileSync.mockReturnValue('/usr/bin/zsh\n');

    await setDefaultShell('zsh');

    expect(mockSpawn).toHaveBeenCalledWith('chsh', ['-s', '/usr/bin/zsh'], {
      stdio: 'inherit',
    });
  });

  it('throws when the shell binary is not in PATH', async () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('command not found');
    });

    await expect(setDefaultShell('nushell')).rejects.toThrow('nu not found in PATH');
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('surfaces the /etc/shells hint when chsh fails', async () => {
    mockExecFileSync.mockReturnValue('/opt/homebrew/bin/zsh\n');
    spawnOutcome({ status: 1 });

    await expect(setDefaultShell('zsh')).rejects.toThrow('/etc/shells');
    await expect(setDefaultShell('zsh')).rejects.toThrow('sudo tee -a /etc/shells');
  });
});

describe('getMissingStarshipPathDir', () => {
  it('returns null when starship is already on PATH', () => {
    mockExecFileSync.mockReturnValue('');
    expect(getMissingStarshipPathDir()).toBeNull();
  });

  it('returns the script install dir when the binary is there but unreachable', () => {
    // command -v starship fails, but ~/.local/bin/starship exists
    mockExecFileSync.mockImplementation(() => {
      throw new Error('not found');
    });
    mockExistsSync.mockReturnValue(true);

    expect(getMissingStarshipPathDir()).toBe(SCRIPT_INSTALL_BIN_DIR);
  });

  it('returns null when starship is neither on PATH nor in the script install dir', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('not found');
    });
    mockExistsSync.mockReturnValue(false);

    expect(getMissingStarshipPathDir()).toBeNull();
  });
});

describe('installNerdFont download guards', () => {
  it('aborts the download if it hangs', async () => {
    await installNerdFont('FiraCode');
    const init = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('refuses an archive whose declared size is implausible', async () => {
    vi.mocked(fetch).mockResolvedValue(
      okResponse({
        headers: { get: () => String(500 * 1024 * 1024) },
      } as unknown as Partial<Response>)
    );

    await expect(installNerdFont('FiraCode')).rejects.toThrow('exceeds the');
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });
});
