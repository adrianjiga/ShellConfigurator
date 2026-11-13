import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import * as os from 'node:os';
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
  mockReadFileSync,
  mockRunCapture,
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
  mockReadFileSync: vi.fn(),
  mockRunCapture: vi.fn(),
}));

vi.mock('child_process', () => ({
  execFileSync: mockExecFileSync,
  spawn: mockSpawn,
  // exec.ts promisifies execFile, which backs runCapture.
  execFile: Object.assign(vi.fn(), {
    [Symbol.for('nodejs.util.promisify.custom')]: mockRunCapture,
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
  readFileSync: mockReadFileSync,
}));

import {
  getMissingStarshipPathDir,
  getNerdFontsDir,
  installNerdFont,
  installShell,
  installStarship,
  NERD_FONTS,
  scriptInstallBinDir,
  setDefaultShell,
  shellInstallSupported,
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
  const arrayBuffer = overrides.arrayBuffer ?? (async () => new ArrayBuffer(0));
  const response: Record<string, unknown> = {
    ok: true,
    status: 200,
    headers: { get: () => null } as unknown as Headers,
    ...overrides,
    arrayBuffer,
  };
  if (response.body == null) {
    response.body = {
      getReader: () => {
        let done = false;
        return {
          read: async () => {
            if (done) return { done: true, value: undefined };
            done = true;
            return { done: false, value: new Uint8Array(await arrayBuffer()) };
          },
          cancel: async () => undefined,
        };
      },
    };
  }
  return response as unknown as Response;
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
  const assets = digestHex
    ? [
        {
          name: 'FiraCode.zip',
          digest: `sha256:${digestHex}`,
          browser_download_url: RELEASE_ASSET_URL,
        },
      ]
    : [];
  return okResponse({ json: async () => ({ assets }) }) as Response;
}

const RELEASE_ASSET_URL =
  'https://github.com/ryanoasis/nerd-fonts/releases/download/v3.2.1/FiraCode.zip';

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
  // Defaults: commands succeed, all binaries exist on PATH, fetch succeeds
  spawnOutcome({ status: 0 });
  // `command -v` prints the path on success, and exec.ts treats empty output as "missing".
  mockExecFileSync.mockReturnValue('/usr/bin/curl\n');
  mockMkdirSync.mockImplementation(() => undefined);
  mockRunCapture.mockResolvedValue({ stdout: '', stderr: '' });
  mockMkdtempSync.mockReturnValue('/tmp/shellconf-font-test');
  mockWriteFileSync.mockImplementation(() => undefined);
  mockCopyFileSync.mockImplementation(() => undefined);
  mockRmSync.mockImplementation(() => undefined);
  mockExistsSync.mockReturnValue(true);
  mockStatSync.mockReturnValue({ size: 1024 });
  // No font cache by default: the pin file is "missing" so cachedFont() is null.
  mockReadFileSync.mockImplementation(() => {
    const err = new Error('ENOENT') as Error & { code?: string };
    err.code = 'ENOENT';
    throw err;
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse()));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('NERD_FONTS', () => {
  it('uses the patched family names upstream actually installs', () => {
    const families = Object.fromEntries(NERD_FONTS.map((font) => [font.id, font.family]));

    expect(families.CascadiaCode).toBe('CaskaydiaCove Nerd Font');
    expect(families.JetBrainsMono).toBe('JetBrainsMono Nerd Font');
    expect(families.FiraCode).toBe('FiraCode Nerd Font');
    expect(families.Hack).toBe('Hack Nerd Font');
    expect(families.Meslo).toBe('MesloLGL Nerd Font');
    expect(families.SourceCodePro).toBe('SauceCodePro Nerd Font');
  });
});

describe('installStarship', () => {
  it('installs via the official script because apt carries no starship package', async () => {
    await installStarship('apt');
    expect(mockSpawn).toHaveBeenCalledWith(
      'env',
      [
        'POSIXLY_CORRECT=1',
        'sh',
        expect.stringContaining('install.sh'),
        '--yes',
        '--bin-dir',
        scriptInstallBinDir(),
      ],
      { stdio: 'inherit' }
    );
  });

  it('installs via the official script because dnf carries no starship package', async () => {
    await installStarship('dnf');
    expect(mockSpawn).toHaveBeenCalledWith(
      'env',
      [
        'POSIXLY_CORRECT=1',
        'sh',
        expect.stringContaining('install.sh'),
        '--yes',
        '--bin-dir',
        scriptInstallBinDir(),
      ],
      { stdio: 'inherit' }
    );
  });

  it('installs via pacman', async () => {
    await installStarship('pacman');
    expect(mockSpawn).toHaveBeenCalledWith(
      'sudo',
      ['pacman', '-Sy', '--noconfirm', '--needed', 'starship'],
      { stdio: 'inherit' }
    );
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
        scriptInstallBinDir(),
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
      return '/bin/sh\n';
    });

    await expect(installStarship('script')).rejects.toThrow('"curl" is not installed');
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('throws the spawned error when the command cannot start', async () => {
    const boom = new Error('spawn ENOENT');
    spawnOutcome({ error: boom });

    await expect(installStarship('pacman')).rejects.toThrow('spawn ENOENT');
  });

  it('throws when the command exits with a non-zero status', async () => {
    spawnOutcome({ status: 1 });

    await expect(installStarship('pacman')).rejects.toThrow('exit code 1');
  });

  it('throws when the command is killed by a signal', async () => {
    spawnOutcome({ signal: 'SIGKILL', status: null });

    await expect(installStarship('pacman')).rejects.toThrow('killed by signal SIGKILL');
  });
});

describe('installShell', () => {
  it('refuses to start when the run is already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(installShell('zsh', 'apt', controller.signal)).rejects.toThrow('Cancelled');
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('refreshes the apt index once before installing', async () => {
    await installShell('zsh', 'apt');
    expect(mockSpawn).toHaveBeenCalledWith('sudo', ['apt-get', 'update', '-qq'], {
      stdio: 'inherit',
    });
    expect(mockSpawn).toHaveBeenCalledWith('sudo', ['apt-get', 'install', '-y', 'zsh'], {
      stdio: 'inherit',
    });
  });

  it('drops sudo when already running as root', async () => {
    const getuid = vi.spyOn(process, 'getuid').mockReturnValue(0);
    try {
      await installShell('zsh', 'apt');
    } finally {
      getuid.mockRestore();
    }
    expect(mockSpawn).toHaveBeenCalledWith('apt-get', ['install', '-y', 'zsh'], {
      stdio: 'inherit',
    });
    expect(mockSpawn).not.toHaveBeenCalledWith('sudo', expect.anything(), expect.anything());
  });

  it('installs fish via brew', async () => {
    await installShell('fish', 'brew');
    expect(mockSpawn).toHaveBeenCalledWith('brew', ['install', 'fish'], {
      stdio: 'inherit',
    });
  });

  it('refuses to install nushell via apt because Debian/Ubuntu carry no package', async () => {
    await expect(installShell('nushell', 'apt')).rejects.toThrow('No package for nushell on apt');
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

  it('cancels the download when the run is aborted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.signal?.aborted) {
          throw new DOMException('The operation was aborted.', 'AbortError');
        }
        return okResponse();
      })
    );
    const controller = new AbortController();
    controller.abort();

    await expect(installNerdFont('FiraCode', controller.signal)).rejects.toThrow('Cancelled');
    expect(mockWriteFileSync).not.toHaveBeenCalled();
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
    expect(written).toContain(path.join(getNerdFontsDir(), 'Pwned.ttf'));
    for (const file of written) {
      expect(path.normalize(file)).not.toContain(`..`);
    }
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
      mockRunCapture.mockRejectedValue(new Error('fc-cache missing'));

      await expect(installNerdFont('FiraCode')).resolves.toBeUndefined();
      expect(mockRunCapture).toHaveBeenCalledWith('fc-cache', ['-f'], expect.anything());
      expect(mockSpawn).not.toHaveBeenCalledWith('fc-cache', expect.anything(), expect.anything());
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });

  it('still succeeds when the cache cannot be written', async () => {
    respondWithZip({ 'FiraCodeNerdFont-Regular.ttf': 'font' });
    mockWriteFileSync.mockImplementation((file: unknown) => {
      if (String(file).endsWith('.sha256')) throw new Error('ENOSPC');
    });

    await expect(installNerdFont('FiraCode')).resolves.toBeUndefined();
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('FiraCodeNerdFont-Regular.ttf'),
      expect.anything()
    );
  });

  it('pins a freshly verified archive into the font cache', async () => {
    const zip = zipWith({ 'FiraCodeNerdFont-Regular.ttf': 'font' });
    stubFontFetch(() => okResponse({ arrayBuffer: async () => zip }), hexDigest(zip));

    await installNerdFont('FiraCode');

    const written = mockWriteFileSync.mock.calls.map((c) => c[0] as string);
    expect(written.some((f) => f.includes('FiraCode.zip'))).toBe(true);
    const pinCall = mockWriteFileSync.mock.calls.find((c) =>
      String(c[0]).endsWith('FiraCode.sha256')
    );
    expect(pinCall?.[1]).toBe(`${hexDigest(zip)}\n`);
  });

  it('reuses a verified cache entry instead of downloading', async () => {
    const zip = zipWith({ 'FiraCodeNerdFont-Regular.ttf': 'from-cache' });
    const digest = hexDigest(zip);
    // The pin says we have this exact archive; cachedFont() trusts it offline.
    mockReadFileSync.mockImplementation((file: string) => {
      if (String(file).endsWith('FiraCode.sha256')) return `${digest}\n`;
      if (String(file).endsWith('FiraCode.zip')) return Buffer.from(zip);
      const err = new Error('ENOENT') as Error & { code?: string };
      err.code = 'ENOENT';
      throw err;
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const note = await installNerdFont('FiraCode');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(note).toBe('installed Fira Code from cache');
    const written = mockWriteFileSync.mock.calls.map((c) => c[0] as string);
    expect(written).toContain(path.join(getNerdFontsDir(), 'FiraCodeNerdFont-Regular.ttf'));
  });

  it('re-downloads when the cached archive fails its pinned digest', async () => {
    // A pin exists but the archive bytes do not match it — treated as absent.
    mockReadFileSync.mockImplementation((file: string) =>
      String(file).endsWith('FiraCode.sha256') ? 'tampered\n' : 'tampered'
    );
    const fetchMock = respondWithZip({ 'FiraCodeNerdFont-Regular.ttf': 'fresh' });

    await installNerdFont('FiraCode');

    expect(fetchMock).toHaveBeenCalled();
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

  it('downloads the exact asset whose digest the release lookup returned', async () => {
    const fetchMock = respondWithZip({ 'FiraCodeNerdFont-Regular.ttf': 'font' });

    await installNerdFont('FiraCode');

    expect(fetchMock).toHaveBeenCalledWith(RELEASE_ASSET_URL, expect.anything());
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('releases/latest/download'),
      expect.anything()
    );
  });

  it('stops reading a chunked archive that exceeds the size cap', async () => {
    const cancel = vi.fn(async () => undefined);
    const oversize = new Uint8Array(200 * 1024 * 1024 + 1);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('api.github.com/repos/ryanoasis/nerd-fonts/releases/latest')) {
          return releaseResponse('a'.repeat(64));
        }
        return okResponse({
          body: {
            getReader: () => ({
              read: async () => ({ done: false, value: oversize }),
              cancel,
            }),
          } as unknown as ReadableStream,
        });
      })
    );

    await expect(installNerdFont('FiraCode')).rejects.toThrow('larger than');
    expect(cancel).toHaveBeenCalled();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
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

  it('prefers the /etc/shells entry over an unlisted binary earlier on PATH', async () => {
    mockExecFileSync.mockReturnValue('/opt/homebrew/bin/zsh\n');
    mockReadFileSync.mockReturnValue('# comment\n/bin/sh\n/bin/zsh\n');
    mockExistsSync.mockReturnValue(true);

    await setDefaultShell('zsh');

    expect(mockSpawn).toHaveBeenCalledWith('chsh', ['-s', '/bin/zsh'], { stdio: 'inherit' });
  });

  it('keeps the PATH binary when it is itself listed in /etc/shells', async () => {
    mockExecFileSync.mockReturnValue('/opt/homebrew/bin/zsh\n');
    mockReadFileSync.mockReturnValue('/bin/zsh\n/opt/homebrew/bin/zsh\n');
    mockExistsSync.mockReturnValue(true);

    await setDefaultShell('zsh');

    expect(mockSpawn).toHaveBeenCalledWith('chsh', ['-s', '/opt/homebrew/bin/zsh'], {
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

describe('getNerdFontsDir', () => {
  it('honours XDG_DATA_HOME on linux', () => {
    if (process.platform === 'darwin') return;
    vi.stubEnv('XDG_DATA_HOME', '/custom/share');
    try {
      expect(getNerdFontsDir()).toBe(path.join('/custom/share', 'fonts'));
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('falls back to ~/.local/share/fonts when XDG_DATA_HOME is empty', () => {
    if (process.platform === 'darwin') return;
    vi.stubEnv('XDG_DATA_HOME', '');
    try {
      expect(getNerdFontsDir()).toBe(path.join(os.homedir(), '.local', 'share', 'fonts'));
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('getMissingStarshipPathDir', () => {
  it('returns null when starship is already on PATH', () => {
    mockExecFileSync.mockReturnValue('/usr/local/bin/starship\n');
    expect(getMissingStarshipPathDir()).toBeNull();
  });

  it('returns the script install dir when the binary is there but unreachable', () => {
    // command -v starship fails, but ~/.local/bin/starship exists
    mockExecFileSync.mockImplementation(() => {
      throw new Error('not found');
    });
    mockExistsSync.mockReturnValue(true);

    expect(getMissingStarshipPathDir()).toBe(scriptInstallBinDir());
  });

  it('returns null when starship is neither on PATH nor in the script install dir', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('not found');
    });
    mockExistsSync.mockReturnValue(false);

    expect(getMissingStarshipPathDir()).toBeNull();
  });
});

describe('shellInstallSupported', () => {
  it.each(['bash', 'zsh', 'fish'] as const)(
    'can install %s via a real package manager',
    (shellId) => {
      expect(shellInstallSupported(shellId, 'apt')).toBe(true);
    }
  );

  it('cannot install nushell via apt', () => {
    expect(shellInstallSupported('nushell', 'apt')).toBe(false);
  });

  it('cannot install powershell via managers with no package for it', () => {
    expect(shellInstallSupported('powershell', 'apt')).toBe(false);
    expect(shellInstallSupported('powershell', 'dnf')).toBe(false);
    expect(shellInstallSupported('powershell', 'apk')).toBe(false);
    expect(shellInstallSupported('powershell', 'pacman')).toBe(false);
    expect(shellInstallSupported('powershell', 'brew')).toBe(true);
  });

  it('cannot auto-install any shell under the script fallback', () => {
    expect(shellInstallSupported('zsh', 'script')).toBe(false);
    expect(shellInstallSupported('bash', 'script')).toBe(false);
  });
});
