import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ShellId, PackageManager } from '../types.js';

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

/** Nerd Font archives run to tens of MB; anything far past that is not a font archive. */
const MAX_FONT_ARCHIVE_BYTES = 200 * 1024 * 1024;

// Runs a command with stdio: 'inherit' so sudo password prompts appear in terminal.
// This blocks the event loop, so Ink cannot repaint until the child exits — the UI
// is frozen rather than paused, and the child writes to the same TTY Ink draws on.
function runCommand(args: string[]): void {
  const [cmd, ...rest] = args;
  if (!cmd) throw new Error('Empty command');

  const result = spawnSync(cmd, rest, { stdio: 'inherit' });

  if (result.error) throw result.error;
  if (result.signal) {
    throw new Error(`Command killed by signal ${result.signal}: ${args.join(' ')}`);
  }
  if (result.status !== 0) {
    throw new Error(`Command failed with exit code ${result.status}: ${args.join(' ')}`);
  }
}

function hasBinary(cmd: string): boolean {
  try {
    execFileSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/** Where the official install script puts the binary when run without sudo. */
export const SCRIPT_INSTALL_BIN_DIR = path.join(os.homedir(), '.local', 'bin');

const STARSHIP_INSTALL_URL = 'https://starship.rs/install.sh';

export async function installStarship(pm: PackageManager): Promise<void> {
  if (pm === 'script') {
    if (!hasBinary('curl')) {
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
      runCommand(['curl', '-fsS', '-o', scriptPath, STARSHIP_INSTALL_URL]);
      if (!fs.existsSync(scriptPath) || fs.statSync(scriptPath).size === 0) {
        throw new Error(`Downloaded an empty install script from ${STARSHIP_INSTALL_URL}`);
      }
      // Installs to ~/.local/bin, no sudo needed
      runCommand(['sh', scriptPath, '--yes']);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    return;
  }

  const cmdArgs = INSTALL_CMDS[pm]('starship');
  if (cmdArgs.length === 0) throw new Error(`No install method for package manager: ${pm}`);
  runCommand(cmdArgs);
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
  if (hasBinary('starship')) return null;
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

  runCommand(INSTALL_CMDS[pm](pkg));
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

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shellconf-font-'));
  const zipPath = path.join(tmpDir, font.zipName);
  const url = `${NERD_FONTS_BASE_URL}/${font.zipName}`;

  try {
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
    fs.writeFileSync(zipPath, buffer);

    // Extract into the temp dir, then copy only font files so non-font
    // payloads (LICENSE.md, readme.md) don't land in the fonts dir.
    if (!hasBinary('unzip')) {
      throw new Error(
        'Cannot extract the font: "unzip" is not installed. ' +
          `Install it (e.g. ${process.platform === 'darwin' ? 'brew install unzip' : 'sudo apt-get install unzip'}) and try again.`
      );
    }
    runCommand(['unzip', '-o', '-q', zipPath, '-d', tmpDir]);

    const fontFiles = collectFontFiles(tmpDir);
    if (fontFiles.length === 0) {
      throw new Error(`No font files found in ${font.zipName}`);
    }
    for (const file of fontFiles) {
      fs.copyFileSync(file, path.join(fontsDir, path.basename(file)));
    }
  } finally {
    // Clean up temp files
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // Refresh font cache (Linux only — macOS picks up ~/Library/Fonts automatically).
  // Non-fatal: fc-cache may be absent on minimal systems.
  if (process.platform !== 'darwin') {
    try {
      runCommand(['fc-cache', '-f']);
    } catch {
      // ignore — cache refresh is best-effort
    }
  }
}

function collectFontFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectFontFiles(full));
    } else if (/\.(ttf|otf|woff2?)$/i.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

export async function setDefaultShell(shellId: ShellId): Promise<void> {
  const binaries: Record<ShellId, string> = {
    bash: 'bash',
    zsh: 'zsh',
    fish: 'fish',
    nushell: 'nu',
    powershell: 'pwsh',
  };

  const binary = binaries[shellId];
  let shellPath: string;

  try {
    shellPath = execFileSync('sh', ['-c', `command -v ${binary}`], {
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();
  } catch {
    throw new Error(`${binary} not found in PATH`);
  }

  // chsh prompts for current user's password itself — run with stdio: 'inherit'
  try {
    runCommand(['chsh', '-s', shellPath]);
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
