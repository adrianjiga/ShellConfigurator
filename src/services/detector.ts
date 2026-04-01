import { execFileSync } from 'child_process';
import * as fs from 'fs';
import { ShellId, PackageManager } from '../types.js';

function commandExists(cmd: string): boolean {
  try {
    execFileSync('which', [cmd], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function readOsReleaseId(): string | null {
  try {
    const content = fs.readFileSync('/etc/os-release', 'utf8');
    const match = content.match(/^ID=(.+)$/m);
    if (!match) return null;
    return match[1]!.replace(/["']/g, '').toLowerCase().trim();
  } catch {
    return null;
  }
}

export function detectPackageManager(): PackageManager {
  if (commandExists('brew')) return 'brew';
  if (commandExists('pacman')) return 'pacman';

  const id = readOsReleaseId();
  if (id) {
    if (['ubuntu', 'debian', 'linuxmint', 'pop', 'elementary'].includes(id)) return 'apt';
    if (['fedora', 'rhel', 'centos', 'rocky', 'alma'].includes(id)) return 'dnf';
    if (['arch', 'manjaro', 'endeavouros', 'cachyos', 'garuda'].includes(id)) return 'pacman';
  }

  if (commandExists('apt-get')) return 'apt';
  if (commandExists('dnf')) return 'dnf';

  return 'script';
}

export function isStarshipInstalled(): { installed: boolean; version?: string } {
  try {
    const version = execFileSync('starship', ['--version'], {
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();
    return { installed: true, version };
  } catch {
    return { installed: false };
  }
}

export function detectInstalledShells(): ShellId[] {
  const checks: Array<{ id: ShellId; binary: string }> = [
    { id: 'bash', binary: 'bash' },
    { id: 'zsh', binary: 'zsh' },
    { id: 'fish', binary: 'fish' },
    { id: 'nushell', binary: 'nu' },
    { id: 'powershell', binary: 'pwsh' },
  ];

  return checks.filter(({ binary }) => commandExists(binary)).map(({ id }) => id);
}
