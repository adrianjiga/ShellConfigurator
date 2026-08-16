import * as fs from 'fs';
import { promisify } from 'util';
import { ShellId, PackageManager } from '../types.js';
import { commandExistsAsync, runCapture } from './exec.js';
import { SHELLS } from '../config/shells.js';

const readFileP = promisify(fs.readFile);

// Async throughout: these run during the Ink render loop and must not block it.

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
    if (['ubuntu', 'debian', 'linuxmint', 'pop', 'elementary'].includes(id)) return 'apt';
    if (['fedora', 'rhel', 'centos', 'rocky', 'alma'].includes(id)) return 'dnf';
    if (['arch', 'manjaro', 'endeavouros', 'cachyos', 'garuda'].includes(id)) return 'pacman';
  }

  const [hasApt, hasDnf] = await Promise.all([
    commandExistsAsync('apt-get'),
    commandExistsAsync('dnf'),
  ]);
  if (hasApt) return 'apt';
  if (hasDnf) return 'dnf';

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
