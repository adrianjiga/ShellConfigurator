import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ShellId } from '../types.js';
import { getShell } from '../config/shells.js';

export interface WriteConfigResult {
  /** Where the config was actually written. */
  path: string;
  /** Set when an existing config was copied aside first. */
  backedUpTo?: string;
}

/**
 * Mirrors Starship's own config resolution order:
 * $STARSHIP_CONFIG, else $XDG_CONFIG_HOME/starship.toml, else ~/.config/starship.toml.
 * Resolved per call rather than at module load so the environment is read live.
 */
export function getConfigPath(): string {
  const explicit = process.env.STARSHIP_CONFIG?.trim();
  if (explicit) return explicit;

  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  const baseDir = xdg ? xdg : path.join(os.homedir(), '.config');
  return path.join(baseDir, 'starship.toml');
}

export function writeStarshipConfig(toml: string): WriteConfigResult {
  const configPath = getConfigPath();
  const configDir = path.dirname(configPath);

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  // Overwriting is the one irreversible step in the wizard, so keep a copy of any
  // hand-tuned config the user already had.
  let backedUpTo: string | undefined;
  if (fs.existsSync(configPath)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    backedUpTo = `${configPath}.bak-${stamp}`;
    fs.copyFileSync(configPath, backedUpTo);
  }

  fs.writeFileSync(configPath, toml, 'utf8');

  return { path: configPath, backedUpTo };
}

export function applyShellConfig(shellId: ShellId): { applied: boolean; note?: string } {
  const shell = getShell(shellId);
  if (!shell) return { applied: false };

  // Shells with no automatic rc file (nushell, powershell) need manual setup
  if (!shell.rcFile) {
    return { applied: false, note: shell.manualNote };
  }

  const rcPath = shell.rcFile;

  // Ensure parent directory exists (important for fish)
  const rcDir = path.dirname(rcPath);
  if (!fs.existsSync(rcDir)) {
    try {
      fs.mkdirSync(rcDir, { recursive: true });
    } catch (err) {
      throw new Error(
        `Cannot create directory ${rcDir}: ${err instanceof Error ? err.message : err}`,
        { cause: err }
      );
    }
  }

  const existing = fs.existsSync(rcPath) ? fs.readFileSync(rcPath, 'utf8') : '';

  // Idempotent: skip if already configured (check for exact init line)
  const addition = `\n# Added by ShellConfigurator\n${shell.initLine}\n`;
  if (existing.includes(shell.initLine)) {
    return { applied: false, note: 'already configured' };
  }
  fs.appendFileSync(rcPath, addition, 'utf8');

  return { applied: true };
}
