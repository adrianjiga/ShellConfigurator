import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import * as path from 'node:path';
import { zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  getMissingStarshipPathDir,
  getNerdFontsDir,
  installNerdFont,
  installShell,
  installStarship,
  SCRIPT_INSTALL_BIN_DIR,
  setDefaultShell,
} from '../../services/installer.ts';

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
    // runCommand settles on 'exit' (not 'close' — see exec.ts), so the mock must emit it.
    if (outcome.error) child.emit('error', outcome.error);
    else child.emit('exit', outcome.status ?? 0, outcome.signal ?? null);
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
    headers: { get: () => null } as unknown as Headers,
    arrayBuffer: async () => new ArrayBuffer(0),
    ...overrides,
  } as unknown as Response;
}

/** sha256 hex of a byte array, matching the digest GitHub publishes for an asset. */
function hexDigest(bytes: ArrayBuffer): string {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

/** Builds a real zip so the extraction path is exercised, not mocked. */
function zipWith(files: Record<string, string>): ArrayBuffer {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, content] of Object.entries(files)) {
    entries[name] = new TextEncoder().encode(content);
  }
  const zipped = zipSync(entries);
  return zipped.buffer.slice(
    zipped.byteOffset,
    zipped.byteOffset + zipped.byteLength
  ) as ArrayBuffer;
}

/** A GitHub /releases/latest body, optionally carrying a digest for FiraCode.zip. */
function releaseResponse(digestHex?: string): Response {
  const assets = digestHex ? [{ name: 'FiraCode.zip', digest: `sha256:${digestHex}` }] : [];
  return okResponse({ json: async () => ({ assets }) }) as Response;
}

/**
 * Routes fetch by URL so installNerdFont sees the checksum API first and the
 * download second. The API host is the discriminator: the download base URL
 * (github.com/.../releases/latest/download) contains the same /releases/latest
 * path, so matching the path alone would misroute the archive.
 */
function stubFontFetch(
  download: () => Response,
  digestHex = 'a'.repeat(64)
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('api.github.com/repos/ryanoasis/nerd-fonts/releases/latest')) {
      return releaseResponse(digestHex);
    }
    return download();
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Routes fetch so the download is a real zip whose digest matches its bytes. */
function respondWithZip(files: Record<string, string>): ReturnType<typeof vi.fn> {
  const zip = zipWith(files);
  return stubFontFetch(() => okResponse({ arrayBuffer: async () => zip }), hexDigest(zip));
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

  it('installs via apk', async () => {
    await installStarship('apk');
    expect(mockSpawn).toHaveBeenCalledWith('sudo', ['apk', 'add', '--no-cache', 'starship'], {
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
    expect(mockSpawn).toHaveBeenCalledWith(
      'env',
      [
        'POSIXLY_CORRECT=1',
        'sh',
        expect.stringContaining('install.sh'),
        '--yes',
        '--bin-dir',
        SCRIPT_INSTALL_BIN_DIR,
      ],
      { stdio: 'inherit' }
    );
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

  it('installs zsh via apk', async () => {
    await installShell('zsh', 'apk');
    expect(mockSpawn).toHaveBeenCalledWith('sudo', ['apk', 'add', '--no-cache', 'zsh'], {
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

  it('throws when the download fails', async () => {
    stubFontFetch(() => okResponse({ ok: false, status: 404 }));

    await expect(installNerdFont('FiraCode')).rejects.toThrow('Failed to download font: HTTP 404');
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('throws when the archive contains no font files', async () => {
    respondWithZip({ 'README.md': 'nothing to see' });

    await expect(installNerdFont('FiraCode')).rejects.toThrow('No font files found');
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('throws a clear error when the archive is not a valid zip', async () => {
    const bytes = new TextEncoder().encode('not a zip').buffer;
    stubFontFetch(() => okResponse({ arrayBuffer: async () => bytes }), hexDigest(bytes));

    await expect(installNerdFont('FiraCode')).rejects.toThrow('Could not extract');
  });

  it('writes only font files into the fonts dir', async () => {
    respondWithZip({
      'FiraCodeNerdFont-Regular.ttf': 'font-a',
      'FiraCodeNerdFont-Bold.otf': 'font-b',
      'LICENSE.md': 'license',
      'readme.md': 'readme',
    });

    await installNerdFont('FiraCode');

    const written = mockWriteFileSync.mock.calls.map((c) => c[0] as string);
    const fontsDir = getNerdFontsDir();
    expect(written).toContain(path.join(fontsDir, 'FiraCodeNerdFont-Regular.ttf'));
    expect(written).toContain(path.join(fontsDir, 'FiraCodeNerdFont-Bold.otf'));
    expect(written.some((f) => f.includes('LICENSE'))).toBe(false);
    expect(written.some((f) => f.toLowerCase().includes('readme'))).toBe(false);
  });

  it('flattens nested entries so a crafted archive cannot escape the fonts dir', async () => {
    respondWithZip({ '../../evil/Pwned.ttf': 'font' });

    await installNerdFont('FiraCode');

    const written = mockWriteFileSync.mock.calls.map((c) => c[0] as string);
    expect(written).toEqual([path.join(getNerdFontsDir(), 'Pwned.ttf')]);
    expect(written[0]).not.toContain('..');
  });

  it('never shells out to unzip', async () => {
    respondWithZip({ 'FiraCodeNerdFont-Regular.ttf': 'font' });

    await installNerdFont('FiraCode');

    expect(mockSpawn).not.toHaveBeenCalledWith('unzip', expect.anything(), expect.anything());
  });

  it('ignores fc-cache failures on linux (non-fatal)', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    try {
      respondWithZip({ 'FiraCodeNerdFont-Regular.ttf': 'font' });
      spawnOutcome({ status: 1 });

      await expect(installNerdFont('FiraCode')).resolves.toBeUndefined();
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });
});

describe('installNerdFont download guards', () => {
  it('gives every fetch an abort signal so a hang cannot wedge the install', async () => {
    const fetchMock = respondWithZip({ 'a.ttf': 'font' });

    await installNerdFont('FiraCode').catch(() => {});

    expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
    for (const call of fetchMock.mock.calls) {
      const init = call[1] as RequestInit | undefined;
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('refuses an archive whose declared size is implausible', async () => {
    stubFontFetch(() =>
      okResponse({
        headers: { get: () => String(500 * 1024 * 1024) },
      } as unknown as Partial<Response>)
    );

    await expect(installNerdFont('FiraCode')).rejects.toThrow('exceeds the');
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });
});

describe('installNerdFont checksum verification', () => {
  it('accepts an archive whose sha256 matches the published digest', async () => {
    const fetchMock = respondWithZip({ 'FiraCodeNerdFont-Regular.ttf': 'font' });

    await expect(installNerdFont('FiraCode')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalled();
  });

  it('refuses an archive whose checksum does not match the publication', async () => {
    stubFontFetch(() =>
      okResponse({ arrayBuffer: async () => zipWith({ 'FiraCodeNerdFont-Regular.ttf': 'font' }) })
    );

    await expect(installNerdFont('FiraCode')).rejects.toThrow('Checksum mismatch');
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('refuses an archive when the release publishes no digest for it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('api.github.com/repos/ryanoasis/nerd-fonts/releases/latest')) {
          return releaseResponse(undefined); // no digest
        }
        return okResponse({ arrayBuffer: async () => zipWith({ 'a.ttf': 'font' }) });
      })
    );

    await expect(installNerdFont('FiraCode')).rejects.toThrow('No sha256 digest');
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('fails when the checksum lookup itself cannot be fetched', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('api.github.com/repos/ryanoasis/nerd-fonts/releases/latest')) {
          return okResponse({ ok: false, status: 403 });
        }
        return okResponse({ arrayBuffer: async () => zipWith({ 'a.ttf': 'font' }) });
      })
    );

    await expect(installNerdFont('FiraCode')).rejects.toThrow(
      'Failed to look up font checksum: HTTP 403'
    );
    expect(mockWriteFileSync).not.toHaveBeenCalled();
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
