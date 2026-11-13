import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getShellBinary } from '../config/shells.ts';
import type { PackageManager, ShellId } from '../types.ts';
import { cachedFont, cacheFont, sha256Digest } from './cache.ts';
import { CommandCancelledError, commandExists, commandPath, runCommand } from './exec.ts';
import { type ExtractedFontFile, extractFontFiles } from './fontExtractor.ts';

// Package names per shell per package manager. Missing combos are intentional
// (powershell is AUR-only on Arch, nushell is absent from Debian/Ubuntu
// repos), so `undefined` is a valid lookup.
const SHELL_PACKAGES: Record<ShellId, Partial<Record<PackageManager, string>>> = {
  bash: { pacman: 'bash', apt: 'bash', dnf: 'bash', brew: 'bash', apk: 'bash' },
  zsh: { pacman: 'zsh', apt: 'zsh', dnf: 'zsh', brew: 'zsh', apk: 'zsh' },
  fish: { pacman: 'fish', apt: 'fish', dnf: 'fish', brew: 'fish', apk: 'fish' },
  nushell: { pacman: 'nushell', dnf: 'nushell', brew: 'nushell', apk: 'nushell' },
  powershell: { brew: 'powershell' },
};

/** Root (common in containers) has no sudo to call. */
function needsSudo(): boolean {
  return typeof process.getuid === 'function' && process.getuid() !== 0;
}

/** The scripted path is a separate code branch; omitting it here makes a stray lookup a type error. */
const INSTALL_CMDS: Record<Exclude<PackageManager, 'script'>, (pkg: string) => string[]> = {
  pacman: (pkg) => [...sudo(), 'pacman', '-Sy', '--noconfirm', '--needed', pkg],
  apt: (pkg) => [...sudo(), 'apt-get', 'install', '-y', pkg],
  dnf: (pkg) => [...sudo(), 'dnf', 'install', '-y', pkg],
  brew: (pkg) => ['brew', 'install', pkg],
  apk: (pkg) => [...sudo(), 'apk', 'add', '--no-cache', pkg],
};

function sudo(): string[] {
  return needsSudo() ? ['sudo'] : [];
}

/** A fresh image has no package index, so the first apt install would 404. */
async function refreshPackageIndex(pm: PackageManager, signal?: AbortSignal): Promise<void> {
  if (pm !== 'apt') return;
  await runCommand([...sudo(), 'apt-get', 'update', '-qq'], { signal });
}

// Nerd Font definitions: id → GitHub release zip name. `family` is the font
// family name the archive installs (nerd-fonts appends " Nerd Font").
export const NERD_FONTS: Array<{ id: string; label: string; zipName: string; family: string }> = [
  {
    id: 'JetBrainsMono',
    label: 'JetBrains Mono',
    zipName: 'JetBrainsMono.zip',
    family: 'JetBrainsMono Nerd Font',
  },
  { id: 'FiraCode', label: 'Fira Code', zipName: 'FiraCode.zip', family: 'FiraCode Nerd Font' },
  { id: 'Hack', label: 'Hack', zipName: 'Hack.zip', family: 'Hack Nerd Font' },
  {
    id: 'CascadiaCode',
    label: 'Cascadia Code',
    zipName: 'CascadiaCode.zip',
    family: 'CaskaydiaCove Nerd Font',
  },
  { id: 'Meslo', label: 'Meslo LG', zipName: 'Meslo.zip', family: 'MesloLGL Nerd Font' },
  {
    id: 'SourceCodePro',
    label: 'Source Code Pro',
    zipName: 'SourceCodePro.zip',
    family: 'SauceCodePro Nerd Font',
  },
];

/** The human-readable name for a font id, falling back to the raw id itself. */
export function fontLabel(fontId: string): string {
  return NERD_FONTS.find((f) => f.id === fontId)?.label ?? fontId;
}

/** The installed font family name a terminal should select for a font id. */
export function getFontFamily(fontId: string): string | null {
  return NERD_FONTS.find((f) => f.id === fontId)?.family ?? null;
}

const NERD_FONTS_BASE_URL = 'https://github.com/ryanoasis/nerd-fonts/releases/latest/download';

/** GitHub REST endpoint whose asset digests are the checksums we verify against. */
const NERD_FONTS_API_URL = 'https://api.github.com/repos/ryanoasis/nerd-fonts/releases/latest';

/** Font archives are 100 MB+, so a slow link must still be able to finish. */
const FONT_DOWNLOAD_TIMEOUT_MS = 5 * 60_000;

/**
 * The same idea for the checksum lookup: a stuck metadata fetch must not wedge the install.
 */
const FONT_CHECKSUM_TIMEOUT_MS = 30_000;

/** Nerd Font archives run to tens of MB; anything far past that is not a font archive. */
const MAX_FONT_ARCHIVE_BYTES = 200 * 1024 * 1024;

/** Where the official install script puts the binary when run without sudo. */
export function scriptInstallBinDir(): string {
  return path.join(os.homedir(), '.local', 'bin');
}

const STARSHIP_INSTALL_URL = 'https://starship.rs/install.sh';

async function installStarshipViaScript(signal?: AbortSignal): Promise<void> {
  // Accepted risk: we deliberately run Starship's official install script
  // unchanged (only pinning --bin-dir). That trusts starship.rs, its CDN and
  // the script over another first-party channel; it is the documented
  // installation path and the practical only option on package-manager-less
  // systems. The script is downloaded to a temp dir first and vetted for an
  // empty body, so a failed or empty download fails the step instead of
  // running garbage.
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
    await runCommand(['curl', '-fsS', '-o', scriptPath, STARSHIP_INSTALL_URL], { signal });
    if (!fs.existsSync(scriptPath) || fs.statSync(scriptPath).size === 0) {
      throw new Error(`Downloaded an empty install script from ${STARSHIP_INSTALL_URL}`);
    }
    // --bin-dir pins the drop location: without it the script defaults to
    // /usr/local/bin, which is root-owned and would trigger a sudo prompt.
    // POSIXLY_CORRECT keeps the script happy on distros where /bin/sh is bash.
    fs.mkdirSync(scriptInstallBinDir(), { recursive: true });
    await runCommand(
      ['env', 'POSIXLY_CORRECT=1', 'sh', scriptPath, '--yes', '--bin-dir', scriptInstallBinDir()],
      { signal }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export async function installStarship(pm: PackageManager, signal?: AbortSignal): Promise<void> {
  // Debian 12, Ubuntu 22.04/24.04 and Fedora carry no starship package.
  if (pm === 'script' || pm === 'apt' || pm === 'dnf') {
    await installStarshipViaScript(signal);
    return;
  }

  await runCommand(INSTALL_CMDS[pm]('starship'), { signal });
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
  return fs.existsSync(path.join(scriptInstallBinDir(), 'starship')) ? scriptInstallBinDir() : null;
}

/**
 * Whether the current package manager can auto-install a given shell. False for
 * the script fallback (there is no package concept to run an install through)
 * and for shell/manager combos without a package entry (e.g. powershell on
 * apt/dnf/apk). The review/install plan uses this to tag such shells as manual
 * so the user knows before the run that auto-install will fail.
 */
export function shellInstallSupported(shellId: ShellId, pm: PackageManager): boolean {
  if (pm === 'script') return false;
  return SHELL_PACKAGES[shellId][pm] != null;
}

export async function installShell(
  shellId: ShellId,
  pm: PackageManager,
  signal?: AbortSignal
): Promise<void> {
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

  await refreshPackageIndex(pm, signal);
  await runCommand(INSTALL_CMDS[pm](pkg), { signal });
}

export function getNerdFontsDir(): string {
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Fonts');
  const dataHome = process.env.XDG_DATA_HOME?.trim();
  const base = dataHome ? dataHome : path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'fonts');
}

interface FontAsset {
  url: string;
  digest: string;
}

/**
 * The download URL and SHA-256 GitHub publishes for a release asset.
 *
 * GitHub's releases API returns `assets[].digest` (a "sha256:<hex>" string) for
 * every uploaded file. Total verification without a second trust domain: the
 * digest comes from GitHub's API over the same HTTPS channel the download uses,
 * so a MITM that swapped the archive would have to rewrite the API metadata too.
 * The asset URL is taken from the same response, so a release published between
 * the lookup and the download cannot hand us a different archive.
 */
async function resolveFontAsset(assetName: string, signal: AbortSignal): Promise<FontAsset> {
  const response = await fetch(NERD_FONTS_API_URL, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'shell-configurator' },
    signal,
  });
  if (!response.ok) {
    throw new Error(`Failed to look up font checksum: HTTP ${response.status}`);
  }

  const release = (await response.json()) as {
    assets?: Array<{ name?: string; digest?: string; browser_download_url?: string }>;
  };
  const asset = release.assets?.find((entry) => entry.name === assetName);
  const digest = asset?.digest;
  if (!digest?.startsWith('sha256:')) {
    throw new Error(
      `No sha256 digest published for ${assetName}; refusing to install an unverified archive.`
    );
  }
  return {
    url: asset?.browser_download_url ?? `${NERD_FONTS_BASE_URL}/${assetName}`,
    digest: digest.slice('sha256:'.length),
  };
}

/** A user cancel and the download timeout share one signal; only the former is "Cancelled". */
function downloadSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function downloadFont(zipName: string, url: string, signal?: AbortSignal): Promise<Buffer> {
  let response: Response;
  try {
    // A hung connection would otherwise block the install phase with no way to cancel.
    response = await fetch(url, { signal: downloadSignal(signal, FONT_DOWNLOAD_TIMEOUT_MS) });
  } catch (err) {
    if (signal?.aborted) throw new CommandCancelledError(`download ${zipName}`);
    throw err;
  }
  if (!response.ok) throw new Error(`Failed to download font: HTTP ${response.status}`);

  const declaredSize = Number(response.headers.get('content-length') ?? '0');
  if (declaredSize > MAX_FONT_ARCHIVE_BYTES) {
    throw new Error(
      `Refusing to download ${zipName}: ${declaredSize} bytes exceeds the ` +
        `${MAX_FONT_ARCHIVE_BYTES} byte limit.`
    );
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error(`Failed to download font: empty body for ${zipName}`);

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      // Enforced while reading: content-length is absent on chunked responses,
      // and reading 200 MB before rejecting wastes the user's bandwidth.
      if (total > MAX_FONT_ARCHIVE_BYTES) {
        await reader.cancel();
        throw new Error(
          `Refusing to install ${zipName}: archive is larger than ` +
            `${MAX_FONT_ARCHIVE_BYTES} bytes.`
        );
      }
      chunks.push(value);
    }
  } catch (err) {
    if (signal?.aborted) throw new CommandCancelledError(`download ${zipName}`);
    throw err;
  }
  return Buffer.concat(chunks);
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

async function installFontFiles(
  zipName: string,
  buffer: Buffer,
  signal?: AbortSignal
): Promise<void> {
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
      await runCommand(['fc-cache', '-f'], { signal });
    } catch {
      // ignore
    }
  }
}

/**
 * Installs a Nerd Font (or confirms it is on the machine). A verified archive in
 * the font cache (P1.1) skips the download entirely — so re-runs, repair (#20)
 * and rollback survive offline / rate-limit situations. Returns a note when the
 * font came from cache, so the task list can explain why there was no download.
 */
export async function installNerdFont(
  fontId: string,
  signal?: AbortSignal
): Promise<string | undefined> {
  const font = NERD_FONTS.find((f) => f.id === fontId);
  if (!font) throw new Error(`Unknown font: ${fontId}`);

  const cached = cachedFont(fontId);
  if (cached) {
    await installFontFiles(font.zipName, cached.buffer, signal);
    return `installed ${font.label} from cache`;
  }

  let asset: FontAsset;
  try {
    asset = await resolveFontAsset(font.zipName, downloadSignal(signal, FONT_CHECKSUM_TIMEOUT_MS));
  } catch (err) {
    if (signal?.aborted) throw new CommandCancelledError(`look up ${font.zipName} checksum`);
    throw err;
  }

  const buffer = await downloadFont(font.zipName, asset.url, signal);
  verifyChecksum(font.zipName, buffer, asset.digest);
  await installFontFiles(font.zipName, buffer, signal);

  // Pin the verified archive so a later run reuses it without re-downloading.
  // A cache that cannot be written (no space, read-only ~/.cache) must not undo
  // a font that is already installed on disk.
  try {
    cacheFont(fontId, buffer);
  } catch {
    // Best-effort only.
  }
  return undefined;
}

export async function setDefaultShell(shellId: ShellId, signal?: AbortSignal): Promise<void> {
  const binary = getShellBinary(shellId);

  const shellPath = commandPath(binary);
  if (!shellPath) {
    throw new Error(`${binary} not found in PATH`);
  }

  // chsh prompts for current user's password itself — run with stdio: 'inherit'
  try {
    await runCommand(['chsh', '-s', shellPath], { signal });
  } catch (err) {
    if (err instanceof CommandCancelledError) throw err;
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
