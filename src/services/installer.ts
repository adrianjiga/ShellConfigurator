import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ShellId, PackageManager } from '../types.ts';
import { unzipSync } from 'fflate';
import { commandExists, commandPath, runCommand } from './exec.ts';
import { getShellBinary } from '../config/shells.ts';

// Package names per shell per package manager
const SHELL_PACKAGES: Record<ShellId, Partial<Record<PackageManager, string>>> = {
  bash: { pacman: 'bash', apt: 'bash', dnf: 'bash', brew: 'bash' },
  zsh: { pacman: 'zsh', apt: 'zsh', dnf: 'zsh', brew: 'zsh' },
  fish: { pacman: 'fish', apt: 'fish', dnf: 'fish', brew: 'fish' },
  nushell: { pacman: 'nushell', apt: 'nushell', dnf: 'nushell', brew: 'nushell' },
  powershell: { pacman: 'powershell', brew: 'powershell' },
};

const INSTALL_CMDS: Record<PackageManager, (pkg: string) => string[]> = {
  pacman: (pkg) => ['sudo', 'pacman', '-S', '--noconfirm', pkg],
  apt: (pkg) => ['sudo', 'apt-get', 'install', '-y', pkg],
  dnf: (pkg) => ['sudo', 'dnf', 'install', '-y', pkg],
  brew: (pkg) => ['brew', 'install', pkg],
  script: (_) => [],
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

const NERD_FONTS_BASE_URL = 'https://github.com/ryanoasis/nerd-fonts/releases/latest/download';

/** Cap on how long the font download may hang before it is aborted. */
const FONT_DOWNLOAD_TIMEOUT_MS = 60_000;

const FONT_FILE_RE = /\.(ttf|otf|woff2?)$/i;

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
      // Installs to ~/.local/bin, no sudo needed
      await runCommand(['sh', scriptPath, '--yes']);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    return;
  }

  const cmdArgs = INSTALL_CMDS[pm]('starship');
  if (cmdArgs.length === 0) throw new Error(`No install method for package manager: ${pm}`);
  await runCommand(cmdArgs);
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

export async function installNerdFont(fontId: string): Promise<void> {
  const font = NERD_FONTS.find((f) => f.id === fontId);
  if (!font) throw new Error(`Unknown font: ${fontId}`);

  const fontsDir = getNerdFontsDir();
  fs.mkdirSync(fontsDir, { recursive: true });

  const url = `${NERD_FONTS_BASE_URL}/${font.zipName}`;

  // Download. A hung connection would otherwise block the whole install phase
  // with no way to cancel, so the request carries its own timeout.
  const response = await fetch(url, { signal: AbortSignal.timeout(FONT_DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Failed to download font: HTTP ${response.status}`);

  const declaredSize = Number(response.headers?.get?.('content-length') ?? 0);
  if (declaredSize > MAX_FONT_ARCHIVE_BYTES) {
    throw new Error(
      `Refusing to download ${font.zipName}: ${declaredSize} bytes exceeds the ` +
        `${MAX_FONT_ARCHIVE_BYTES} byte limit.`
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_FONT_ARCHIVE_BYTES) {
    throw new Error(
      `Refusing to install ${font.zipName}: archive is larger than ` +
        `${MAX_FONT_ARCHIVE_BYTES} bytes.`
    );
  }

  // Extracted in-process rather than by shelling out to `unzip`, which is absent
  // on minimal systems and needed its own detection and platform-specific error.
  // Only font files are taken, so non-font payloads (LICENSE.md, readme.md) stay out.
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(buffer), {
      filter: (file) => FONT_FILE_RE.test(file.name),
    });
  } catch (err) {
    throw new Error(
      `Could not extract ${font.zipName}: ${err instanceof Error ? err.message : err}`,
      { cause: err }
    );
  }

  const names = Object.keys(entries);
  if (names.length === 0) {
    throw new Error(`No font files found in ${font.zipName}`);
  }

  for (const name of names) {
    // path.basename is load-bearing, not cosmetic: it strips any directory
    // component from the unverified archive's entries, so a crafted zip cannot
    // write outside fontsDir. Do not replace it with the entry path.
    fs.writeFileSync(path.join(fontsDir, path.basename(name)), entries[name]!);
  }

  // Refresh font cache (Linux only — macOS picks up ~/Library/Fonts automatically).
  // Non-fatal: fc-cache may be absent on minimal systems.
  if (process.platform !== 'darwin') {
    try {
      await runCommand(['fc-cache', '-f']);
    } catch {
      // ignore — cache refresh is best-effort
    }
  }
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
        `Cause: ${err instanceof Error ? err.message : err}`,
      { cause: err }
    );
  }
}
