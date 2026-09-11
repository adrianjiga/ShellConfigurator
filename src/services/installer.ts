import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getShellBinary } from '../config/shells.ts';
import type { PackageManager, ShellId } from '../types.ts';
import { sha256Digest } from './cache.ts';
import { commandExists, commandPath, runCommand } from './exec.ts';
import { type ExtractedFontFile, extractFontFiles } from './fontExtractor.ts';

// Package names per shell per package manager. Missing combos are intentional
// (powershell is brew/pacman-only), so `undefined` is a valid lookup.
const SHELL_PACKAGES: Record<ShellId, Partial<Record<PackageManager, string>>> = {
  bash: { pacman: 'bash', apt: 'bash', dnf: 'bash', brew: 'bash', apk: 'bash' },
  zsh: { pacman: 'zsh', apt: 'zsh', dnf: 'zsh', brew: 'zsh', apk: 'zsh' },
  fish: { pacman: 'fish', apt: 'fish', dnf: 'fish', brew: 'fish', apk: 'fish' },
  nushell: { pacman: 'nushell', apt: 'nushell', dnf: 'nushell', brew: 'nushell', apk: 'nushell' },
  powershell: { pacman: 'powershell', brew: 'powershell' },
};

/** The scripted path is a separate code branch; omitting it here makes a stray lookup a type error. */
const INSTALL_CMDS: Record<Exclude<PackageManager, 'script'>, (pkg: string) => string[]> = {
  pacman: (pkg) => ['sudo', 'pacman', '-S', '--noconfirm', pkg],
  apt: (pkg) => ['sudo', 'apt-get', 'install', '-y', pkg],
  dnf: (pkg) => ['sudo', 'dnf', 'install', '-y', pkg],
  brew: (pkg) => ['brew', 'install', pkg],
  apk: (pkg) => ['sudo', 'apk', 'add', '--no-cache', pkg],
};

// Nerd Font definitions: id → GitHub release zip name
export const NERD_FONTS: Array<{ id: string; label: string; zipName: string }> = [
  { id: 'JetBrainsMono', label: 'JetBrains Mono', zipName: 'JetBrainsMono.zip' },
  { id: 'FiraCode', label: 'Fira Code', zipName: 'FiraCode.zip' },
  { id: 'Hack', label: 'Hack', zipName: 'Hack.zip' },
  { id: 'CascadiaCode', label: 'Cascadia Code', zipName: 'CascadiaCode.zip' },
  { id: 'Meslo', label: 'Meslo LG', zipName: 'Meslo.zip' },
  { id: 'SourceCodePro', label: 'Source Code Pro', zipName: 'SourceCodePro.zip' },
];

/** The human-readable name for a font id, falling back to the raw id itself. */
export function fontLabel(fontId: string): string {
  return NERD_FONTS.find((f) => f.id === fontId)?.label ?? fontId;
}

const NERD_FONTS_BASE_URL = 'https://github.com/ryanoasis/nerd-fonts/releases/latest/download';

/** GitHub REST endpoint whose asset digests are the checksums we verify against. */
const NERD_FONTS_API_URL = 'https://api.github.com/repos/ryanoasis/nerd-fonts/releases/latest';

/** Cap on how long the font download may hang before it is aborted. */
const FONT_DOWNLOAD_TIMEOUT_MS = 60_000;

/**
 * The same idea for the checksum lookup: a stuck metadata fetch must not wedge the install.
 */
const FONT_CHECKSUM_TIMEOUT_MS = 30_000;

/** Nerd Font archives run to tens of MB; anything far past that is not a font archive. */
const MAX_FONT_ARCHIVE_BYTES = 200 * 1024 * 1024;

/** Where the official install script puts the binary when run without sudo. */
export const SCRIPT_INSTALL_BIN_DIR = path.join(os.homedir(), '.local', 'bin');

const STARSHIP_INSTALL_URL = 'https://starship.rs/install.sh';

export async function installStarship(pm: PackageManager): Promise<void> {
  if (pm === 'script') {
    if (!commandExists('curl')) {
      throw new Error(
        'Cannot download Starship: "curl" is not installed. Install curl and try again, ' +
          'or install Starship manually (see https://starship.rs/install).'
      );
    }

    // Downloaded to a file rather than piped into sh: a pipeline reports only the
    // last command's exit status, so a failed curl would look like a clean install.
    // -f also turns an HTTP error into a curl failure instead of an HTML error page.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shellconf-starship-'));
    const scriptPath = path.join(tmpDir, 'install.sh');
    try {
      await runCommand(['curl', '-fsS', '-o', scriptPath, STARSHIP_INSTALL_URL]);
      if (!fs.existsSync(scriptPath) || fs.statSync(scriptPath).size === 0) {
        throw new Error(`Downloaded an empty install script from ${STARSHIP_INSTALL_URL}`);
      }
      // --bin-dir pins the drop location: without it the script defaults to
      // /usr/local/bin, which is root-owned and would trigger a sudo prompt.
      // POSIXLY_CORRECT keeps the script happy on distros where /bin/sh is bash.
      fs.mkdirSync(SCRIPT_INSTALL_BIN_DIR, { recursive: true });
      await runCommand([
        'env',
        'POSIXLY_CORRECT=1',
        'sh',
        scriptPath,
        '--yes',
        '--bin-dir',
        SCRIPT_INSTALL_BIN_DIR,
      ]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    return;
  }

  await runCommand(INSTALL_CMDS[pm]('starship'));
}

/**
 * Returns the directory that must be added to PATH for `starship` to be runnable,
 * or null when it is already reachable.
 *
 * The install script drops the binary in ~/.local/bin, which is not on PATH by
 * default on Debian/Ubuntu or in minimal environments — without this the rc init
 * line resolves to `starship: command not found` on every prompt.
 */
export function getMissingStarshipPathDir(): string | null {
  if (commandExists('starship')) return null;
  return fs.existsSync(path.join(SCRIPT_INSTALL_BIN_DIR, 'starship'))
    ? SCRIPT_INSTALL_BIN_DIR
    : null;
}

export async function installShell(shellId: ShellId, pm: PackageManager): Promise<void> {
  if (pm === 'script') {
    throw new Error(
      `Cannot auto-install ${shellId}: no package manager detected. ` +
        `Install ${shellId} manually (e.g. check your distro's package repo or the ` +
        `${shellId} documentation), then re-run the wizard.`
    );
  }

  const pkg = SHELL_PACKAGES[shellId][pm];
  if (!pkg) {
    throw new Error(
      `No package for ${shellId} on ${pm}. Install ${shellId} manually ` +
        `(check the ${shellId} official docs for install instructions), then re-run the wizard.`
    );
  }

  await runCommand(INSTALL_CMDS[pm](pkg));
}

export function getNerdFontsDir(): string {
  return process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Fonts')
    : path.join(os.homedir(), '.local', 'share', 'fonts');
}

/**
 * The SHA-256 GitHub publishes for a release asset, as a bare hex string.
 *
 * GitHub's releases API returns `assets[].digest` (a "sha256:<hex>" string) for
 * every uploaded file. Total verification without a second trust domain: the
 * digest comes from GitHub's API over the same HTTPS channel the download uses,
 * so a MITM that swapped the archive would have to rewrite the API metadata too.
 */
async function fetchAssetChecksum(assetName: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(NERD_FONTS_API_URL, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'shell-configurator' },
    signal,
  });
  if (!response.ok) {
    throw new Error(`Failed to look up font checksum: HTTP ${response.status}`);
  }

  const release = (await response.json()) as {
    assets?: Array<{ name?: string; digest?: string }>;
  };
  const digest = release.assets?.find((asset) => asset.name === assetName)?.digest;
  if (!digest?.startsWith('sha256:')) {
    throw new Error(
      `No sha256 digest published for ${assetName}; refusing to install an unverified archive.`
    );
  }
  return digest.slice('sha256:'.length);
}

async function downloadFont(zipName: string): Promise<Buffer> {
  const url = `${NERD_FONTS_BASE_URL}/${zipName}`;

  // A hung connection would otherwise block the install phase with no way to cancel.
  const response = await fetch(url, { signal: AbortSignal.timeout(FONT_DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Failed to download font: HTTP ${response.status}`);

  const declaredSize = Number(response.headers.get('content-length') ?? '0');
  if (declaredSize > MAX_FONT_ARCHIVE_BYTES) {
    throw new Error(
      `Refusing to download ${zipName}: ${declaredSize} bytes exceeds the ` +
        `${MAX_FONT_ARCHIVE_BYTES} byte limit.`
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_FONT_ARCHIVE_BYTES) {
    throw new Error(
      `Refusing to install ${zipName}: archive is larger than ` + `${MAX_FONT_ARCHIVE_BYTES} bytes.`
    );
  }
  return buffer;
}

function verifyChecksum(zipName: string, buffer: Buffer, expectedDigest: string): void {
  const actualDigest = sha256Digest(buffer);
  if (actualDigest !== expectedDigest) {
    throw new Error(
      `Checksum mismatch for ${zipName}: expected sha256:${expectedDigest}, ` +
        `got sha256:${actualDigest}. The download was tampered with or GitHub's ` +
        `digest does not match; refusing to install.`
    );
  }
}

async function installFontFiles(zipName: string, buffer: Buffer): Promise<void> {
  let fontFiles: ExtractedFontFile[];
  try {
    fontFiles = await extractFontFiles(buffer);
  } catch (err) {
    throw new Error(`Could not extract ${zipName}: ${err instanceof Error ? err.message : err}`, {
      cause: err,
    });
  }
  if (fontFiles.length === 0) {
    throw new Error(`No font files found in ${zipName}`);
  }

  const fontsDir = getNerdFontsDir();
  fs.mkdirSync(fontsDir, { recursive: true });

  for (const file of fontFiles) {
    // The worker flattens entry paths to basenames; do not join onto the raw path.
    fs.writeFileSync(path.join(fontsDir, file.name), file.bytes);
  }

  // Non-fatal: fc-cache may be absent on minimal systems.
  if (process.platform !== 'darwin') {
    try {
      await runCommand(['fc-cache', '-f']);
    } catch {
      // ignore
    }
  }
}

export async function installNerdFont(fontId: string): Promise<void> {
  const font = NERD_FONTS.find((f) => f.id === fontId);
  if (!font) throw new Error(`Unknown font: ${fontId}`);

  const buffer = await downloadFont(font.zipName);
  const expectedDigest = await fetchAssetChecksum(
    font.zipName,
    AbortSignal.timeout(FONT_CHECKSUM_TIMEOUT_MS)
  );
  verifyChecksum(font.zipName, buffer, expectedDigest);
  await installFontFiles(font.zipName, buffer);
}

export async function setDefaultShell(shellId: ShellId): Promise<void> {
  const binary = getShellBinary(shellId);

  const shellPath = commandPath(binary);
  if (!shellPath) {
    throw new Error(`${binary} not found in PATH`);
  }

  // chsh prompts for current user's password itself — run with stdio: 'inherit'
  try {
    await runCommand(['chsh', '-s', shellPath]);
  } catch (err) {
    // Brew-installed shells usually aren't listed in /etc/shells, so chsh rejects
    // them. Surface an actionable hint instead of the raw chsh error.
    throw new Error(
      `Could not set ${binary} as the default shell. If ${shellPath} isn't listed in ` +
        `/etc/shells, add it first (e.g. 'echo ${shellPath} | sudo tee -a /etc/shells'). ` +
        `${err instanceof Error ? err.message : err}`,
      { cause: err }
    );
  }
}
