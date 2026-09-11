import * as fs from 'node:fs';
import { promisify } from 'node:util';
import { SHELLS } from '../config/shells.ts';
import type { PackageManager, ShellId } from '../types.ts';
import { commandExistsAsync, runCapture } from './exec.ts';

const readFileP = promisify(fs.readFile);

// Async throughout: these run during the Ink render loop and must not block it.

const APT_DISTROS = ['ubuntu', 'debian', 'linuxmint', 'pop', 'elementary'];
const DNF_DISTROS = ['fedora', 'rhel', 'centos', 'rocky', 'alma'];
const PACMAN_DISTROS = ['arch', 'manjaro', 'endeavouros', 'cachyos', 'garuda'];

/** Reads the distro id from /etc/os-release, e.g. "ubuntu" or "fedora". */
async function readOsReleaseIdAsync(): Promise<string | null> {
  try {
    const content = await readFileP('/etc/os-release', 'utf8');
    const match = content.match(/^ID=(.+)$/m);
    if (!match) return null;
    return match[1]!.replace(/["']/g, '').toLowerCase().trim();
  } catch {
    return null;
  }
}

export async function detectPackageManagerAsync(): Promise<PackageManager> {
  const [hasBrew, hasPacman] = await Promise.all([
    commandExistsAsync('brew'),
    commandExistsAsync('pacman'),
  ]);
  if (hasBrew) return 'brew';
  if (hasPacman) return 'pacman';

  const id = await readOsReleaseIdAsync();
  if (id) {
    if (APT_DISTROS.includes(id)) return 'apt';
    if (DNF_DISTROS.includes(id)) return 'dnf';
    if (PACMAN_DISTROS.includes(id)) return 'pacman';
    if (id === 'alpine') return 'apk';
  }

  const [hasApt, hasDnf, hasApk] = await Promise.all([
    commandExistsAsync('apt-get'),
    commandExistsAsync('dnf'),
    commandExistsAsync('apk'),
  ]);
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
    return { installed: true, version: await runCapture('starship', ['--version']) };
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
    const comm = (await runCapture('ps', ['-p', `${process.pid}`, '-o', 'comm='])).trim();
    const match = byName(comm.split('/').pop() ?? '');
    if (match) return match.id;
  } catch {
    // fall through to null
  }
  return null;
}
