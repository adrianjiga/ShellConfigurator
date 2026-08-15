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
} = vi.hoisted(() => ({
  mockSpawnSync: vi.fn(),
  mockExecFileSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockMkdtempSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockCopyFileSync: vi.fn(),
  mockReaddirSync: vi.fn(),
  mockRmSync: vi.fn(),
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
}));

import {
  installStarship,
  installShell,
  installNerdFont,
  setDefaultShell,
  getNerdFontsDir,
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

  it('uses the official install script when no package manager is detected', async () => {
    await installStarship('script');
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'sh',
      ['-c', expect.stringContaining('https://starship.rs/install.sh')],
      { stdio: 'inherit' }
    );
  });

  it('throws a clear error when curl is missing for the script path', async () => {
    mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === 'curl') throw new Error('command not found');
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
      if (args[0] === 'unzip') throw new Error('command not found');
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
