import * as fs from 'node:fs';
import { promisify } from 'node:util';
import { SHELLS } from '../config/shells.ts';
import type { PackageManager, ShellId, TerminalId } from '../types.ts';
import { commandExistsAsync, runCapture } from './exec.ts';

const readFileP = promisify(fs.readFile);

// Async throughout: these run during the Ink render loop and must not block it.

const APT_DISTROS = ['ubuntu', 'debian', 'linuxmint', 'pop', 'elementary'];
const DNF_DISTROS = ['fedora', 'rhel', 'centos', 'rocky', 'almalinux'];
const PACMAN_DISTROS = ['arch', 'manjaro', 'endeavouros', 'cachyos', 'garuda'];

const OS_RELEASE_FILES = ['/etc/os-release', '/usr/lib/os-release'];

function osReleaseValue(content: string, key: string): string | null {
  const match = content.match(new RegExp(`^${key}=(.+)$`, 'm'));
  return match ? match[1]!.replace(/["']/g, '').toLowerCase().trim() : null;
}

/**
 * The distro id followed by its ID_LIKE parents (e.g. ["kali", "debian"]), so
 * a derivative maps to its parent's package manager.
 */
async function readOsReleaseIdsAsync(): Promise<string[]> {
  for (const file of OS_RELEASE_FILES) {
    let content: string;
    try {
      content = await readFileP(file, 'utf8');
    } catch {
      continue;
    }
    const id = osReleaseValue(content, 'ID');
    const like = osReleaseValue(content, 'ID_LIKE')?.split(/\s+/) ?? [];
    return [...(id ? [id] : []), ...like].filter(Boolean);
  }
  return [];
}

function packageManagerForDistro(id: string): PackageManager | null {
  if (APT_DISTROS.includes(id)) return 'apt';
  if (DNF_DISTROS.includes(id)) return 'dnf';
  if (PACMAN_DISTROS.includes(id)) return 'pacman';
  if (id === 'alpine') return 'apk';
  return null;
}

export async function detectPackageManagerAsync(): Promise<PackageManager> {
  const [hasBrew, hasPacman] = await Promise.all([
    commandExistsAsync('brew'),
    commandExistsAsync('pacman'),
  ]);
  if (hasBrew) return 'brew';
  if (hasPacman) return 'pacman';

  const [ids, hasApt, hasDnf, hasApk] = await Promise.all([
    readOsReleaseIdsAsync(),
    commandExistsAsync('apt-get'),
    commandExistsAsync('dnf'),
    commandExistsAsync('apk'),
  ]);
  const present: Record<PackageManager, boolean> = {
    brew: false,
    pacman: false,
    apt: hasApt,
    dnf: hasDnf,
    apk: hasApk,
    script: false,
  };

  // The distro id breaks a tie between several package managers, but is only
  // trusted when its binary is really there (CentOS 7 has yum, not dnf).
  for (const id of ids) {
    const distroPm = packageManagerForDistro(id);
    if (distroPm && present[distroPm]) return distroPm;
  }

  if (hasApt) return 'apt';
  if (hasDnf) return 'dnf';
  if (hasApk) return 'apk';

  return 'script';
}

export async function isStarshipInstalledAsync(): Promise<{
  installed: boolean;
  version?: string;
}> {
  try {
    // -V prints only the version line; --version adds branch/commit/build time,
    // which made the task label multi-line and drift compare build stamps.
    return { installed: true, version: await runCapture('starship', ['-V']) };
  } catch {
    return { installed: false };
  }
}

export async function detectInstalledShellsAsync(): Promise<ShellId[]> {
  const results = await Promise.all(
    SHELLS.map(async ({ id, binary }) => ({ id, exists: await commandExistsAsync(binary) }))
  );
  return results.filter(({ exists }) => exists).map(({ id }) => id);
}

/**
 * Detects the terminal emulator from the environment markers each one sets.
 * Returns null for a plain TTY or an emulator we do not wire fonts for.
 */
export async function detectTerminalAsync(): Promise<TerminalId | null> {
  const env = process.env;
  const term = env.TERM ?? '';
  if (env.KITTY_WINDOW_ID || term === 'xterm-kitty' || env.TERM_PROGRAM === 'kitty') {
    return 'kitty';
  }
  if (env.GHOSTTY_RESOURCES_DIR || env.TERM_PROGRAM === 'ghostty') return 'ghostty';
  if (env.WEZTERM_PANE || env.TERM_PROGRAM === 'WezTerm') return 'wezterm';
  if (env.ALACRITTY_WINDOW_ID || env.ALACRITTY_SOCKET || env.TERM_PROGRAM === 'Alacritty') {
    return 'alacritty';
  }
  if (term === 'foot' || term.startsWith('foot-')) return 'foot';
  return null;
}

/** Env vars that mean "this is a sandbox, not the user's own machine". */
const CONTAINER_ENV_MARKERS = [
  'CODESPACES',
  'REMOTE_CONTAINERS',
  'DEVCONTAINER',
  'CI',
  'KUBERNETES_SERVICE_HOST',
  'container',
];

/** An env flag counts as set unless it is empty or an explicit false/0/no. */
function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  return !['false', '0', 'no'].includes(value.trim().toLowerCase());
}

/** Files the container runtimes drop at the filesystem root. */
const CONTAINER_MARKER_FILES = ['/run/.containerenv', '/.dockerenv', '/run/systemd/container'];

/**
 * Detects a container/CI sandbox: fonts are per-host and `chsh` is meaningless
 * there, so the install chain skips those steps. Marker files are read (not
 * stat'd) to keep this on the same promisified-fs seam the other detectors use.
 */
export async function detectContainerAsync(): Promise<boolean> {
  if (CONTAINER_ENV_MARKERS.some((name) => isTruthyEnv(process.env[name]))) return true;
  for (const marker of CONTAINER_MARKER_FILES) {
    try {
      await readFileP(marker, 'utf8');
      return true;
    } catch {
      // Marker absent — try the next one.
    }
  }
  return false;
}

const byName = (name: string) => SHELLS.find((s) => s.binary === name || s.id === name);

/**
 * Best-effort detection of the shell the wizard is running in, so it can be
 * pre-selected. Reads $SHELL first, falling back to the process command name.
 * Returns null when it can't be mapped to a known shell.
 */
export async function detectCurrentShellAsync(): Promise<ShellId | null> {
  const envPath = process.env.SHELL?.trim();
  if (envPath) {
    const match = byName(envPath.split('/').pop() ?? '');
    if (match) return match.id;
  }
  try {
    // The parent is the shell that launched the wizard; a login shell's name
    // carries a leading '-' (e.g. "-zsh").
    const comm = (await runCapture('ps', ['-p', `${process.ppid}`, '-o', 'comm='])).trim();
    const match = byName((comm.split('/').pop() ?? '').replace(/^-/, ''));
    if (match) return match.id;
  } catch {
    // fall through to null
  }
  return null;
}
