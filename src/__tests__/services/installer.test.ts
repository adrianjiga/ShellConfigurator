import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';

const {
  mockSpawnSync,
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
  mockSpawnSync: vi.fn(),
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
  spawnSync: mockSpawnSync,
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

function okResponse() {
  return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Defaults: commands succeed, all binaries exist, fetch succeeds
  mockSpawnSync.mockReturnValue({ status: 0 });
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
    expect(mockSpawnSync).toHaveBeenCalledWith('sudo', ['apt-get', 'install', '-y', 'starship'], {
      stdio: 'inherit',
    });
  });

  it('installs via dnf', async () => {
    await installStarship('dnf');
    expect(mockSpawnSync).toHaveBeenCalledWith('sudo', ['dnf', 'install', '-y', 'starship'], {
      stdio: 'inherit',
    });
  });

  it('installs via pacman', async () => {
    await installStarship('pacman');
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'sudo',
      ['pacman', '-S', '--noconfirm', 'starship'],
      { stdio: 'inherit' }
    );
  });

  it('installs via brew without sudo', async () => {
    await installStarship('brew');
    expect(mockSpawnSync).toHaveBeenCalledWith('brew', ['install', 'starship'], {
      stdio: 'inherit',
    });
  });

  it('downloads the install script to a file and runs it separately', async () => {
    await installStarship('script');

    // Downloading and running are separate commands so a failed download is not
    // masked by the exit status of the shell reading from the pipe.
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'curl',
      ['-fsS', '-o', expect.stringContaining('install.sh'), 'https://starship.rs/install.sh'],
      { stdio: 'inherit' }
    );
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'sh',
      [expect.stringContaining('install.sh'), '--yes'],
      { stdio: 'inherit' }
    );
  });

  it('fails when the download fails instead of reporting success', async () => {
    mockSpawnSync.mockImplementation((cmd: string) =>
      cmd === 'curl' ? { status: 22 } : { status: 0 }
    );

    await expect(installStarship('script')).rejects.toThrow('exit code 22');
    // The script must never be executed after a failed download.
    expect(mockSpawnSync).not.toHaveBeenCalledWith('sh', expect.anything(), expect.anything());
  });

  it('fails when the downloaded script is empty', async () => {
    mockStatSync.mockReturnValue({ size: 0 });

    await expect(installStarship('script')).rejects.toThrow('empty install script');
  });

  it('cleans up the temp dir even when the install fails', async () => {
    mockSpawnSync.mockReturnValue({ status: 1 });

    await expect(installStarship('script')).rejects.toThrow();
    expect(mockRmSync).toHaveBeenCalledWith(expect.any(String), {
      recursive: true,
      force: true,
    });
  });

  it('throws a clear error when curl is missing for the script path', async () => {
    mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args[1] === 'command -v curl') throw new Error('command not found');
      return '';
    });

    await expect(installStarship('script')).rejects.toThrow('"curl" is not installed');
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });

  it('throws the spawned error when the command cannot start', async () => {
    const boom = new Error('spawn ENOENT');
    mockSpawnSync.mockReturnValue({ error: boom });

    await expect(installStarship('apt')).rejects.toThrow('spawn ENOENT');
  });

  it('throws when the command exits with a non-zero status', async () => {
    mockSpawnSync.mockReturnValue({ status: 1 });

    await expect(installStarship('apt')).rejects.toThrow('exit code 1');
  });

  it('throws when the command is killed by a signal', async () => {
    mockSpawnSync.mockReturnValue({ signal: 'SIGKILL', status: null });

    await expect(installStarship('apt')).rejects.toThrow('killed by signal SIGKILL');
  });
});

describe('installShell', () => {
  it('installs zsh via apt', async () => {
    await installShell('zsh', 'apt');
    expect(mockSpawnSync).toHaveBeenCalledWith('sudo', ['apt-get', 'install', '-y', 'zsh'], {
      stdio: 'inherit',
    });
  });

  it('installs fish via brew', async () => {
    await installShell('fish', 'brew');
    expect(mockSpawnSync).toHaveBeenCalledWith('brew', ['install', 'fish'], {
      stdio: 'inherit',
    });
  });

  it('installs nushell via apt', async () => {
    await installShell('nushell', 'apt');
    expect(mockSpawnSync).toHaveBeenCalledWith('sudo', ['apt-get', 'install', '-y', 'nushell'], {
      stdio: 'inherit',
    });
  });

  it('throws a clear error on the script fallback (no package manager)', async () => {
    await expect(installShell('zsh', 'script')).rejects.toThrow('Cannot auto-install zsh');
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });

  it('throws when the shell has no package for the package manager', async () => {
    await expect(installShell('powershell', 'apt')).rejects.toThrow(
      'No package for powershell on apt'
    );
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });
});

describe('installNerdFont', () => {
  it('throws for an unknown font id', async () => {
    await expect(installNerdFont('NotAFont')).rejects.toThrow('Unknown font: NotAFont');
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('throws when the download fails and still cleans up temp files', async () => {
    vi.mocked(fetch).mockResolvedValue({ ...okResponse(), ok: false, status: 404 });

    await expect(installNerdFont('FiraCode')).rejects.toThrow('Failed to download font: HTTP 404');
    expect(mockRmSync).toHaveBeenCalledWith('/tmp/shellconf-font-test', {
      recursive: true,
      force: true,
    });
  });

  it('throws a clear error when unzip is missing and still cleans up', async () => {
    mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args[1] === 'command -v unzip') throw new Error('command not found');
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
      mockSpawnSync.mockReturnValueOnce({ status: 0 }).mockReturnValueOnce({ status: 1 });
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

    expect(mockSpawnSync).toHaveBeenCalledWith('chsh', ['-s', '/usr/bin/zsh'], {
      stdio: 'inherit',
    });
  });

  it('throws when the shell binary is not in PATH', async () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('command not found');
    });

    await expect(setDefaultShell('nushell')).rejects.toThrow('nu not found in PATH');
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });

  it('surfaces the /etc/shells hint when chsh fails', async () => {
    mockExecFileSync.mockReturnValue('/opt/homebrew/bin/zsh\n');
    mockSpawnSync.mockReturnValue({ status: 1 });

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
