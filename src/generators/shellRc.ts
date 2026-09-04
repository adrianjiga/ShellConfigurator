import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ShellId } from '../types.ts';
import { getShell } from '../config/shells.ts';

export interface WriteConfigResult {
  /** Where the config was actually written. */
  path: string;
  /** Set when an existing config was copied aside first. */
  backedUpTo?: string;
}

/**
 * Directory that holds per-shell Starship configs, mirroring Starship's own base
 * directory resolution: $XDG_CONFIG_HOME, else ~/.config. Each selected shell gets
 * its own file inside the `starship/` subdirectory, so the shared
 * ~/.config/starship.toml that other shells (e.g. one bootstrapped globally) may
 * already use is never overwritten. Resolved per call so the env is read live.
 */
function getConfigBaseDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  return xdg ? xdg : path.join(os.homedir(), '.config');
}

/**
 * Path to a single shell's own Starship config, e.g. ~/.config/starship/zsh.toml.
 * A shell's rc file points at this via STARSHIP_CONFIG before initializing
 * Starship, isolating its prompt from every other shell.
 */
export function getShellConfigPath(shellId: ShellId): string {
  return path.join(getConfigBaseDir(), 'starship', `${shellId}.toml`);
}

/**
 * Writes one shell's Starship config to its own per-shell file. Never touches the
 * shared ~/.config/starship.toml. Backs up any existing per-shell config first,
 * since overwriting is the one irreversible step in the wizard.
 */
export function writeShellConfig(toml: string, shellId: ShellId): WriteConfigResult {
  const configPath = getShellConfigPath(shellId);
  const configDir = path.dirname(configPath);

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  let backedUpTo: string | undefined;
  if (fs.existsSync(configPath)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    backedUpTo = `${configPath}.bak-${stamp}`;
    fs.copyFileSync(configPath, backedUpTo);
  }

  fs.writeFileSync(configPath, toml, 'utf8');

  return { path: configPath, backedUpTo };
}

export interface ApplyShellConfigOptions {
  /** Directory to prepend to PATH ahead of the init line, when starship is not reachable. */
  ensurePathDir?: string | null;
}

/**
 * The STARSHIP_CONFIG export for a shell, in that shell's own syntax, pointing at
 * the shell's per-shell config so it never inherits the shared starship.toml.
 * Returns null for shells without a script rc file (nushell, powershell).
 */
function starshipConfigLine(shellId: ShellId): string | null {
  const shell = getShell(shellId);
  if (!shell?.rcFile) return null;
  const configPath = getShellConfigPath(shellId);
  if (shellId === 'fish') {
    return `set -gx STARSHIP_CONFIG ${configPath}`;
  }
  return `export STARSHIP_CONFIG="${configPath}"`;
}

export function applyShellConfig(
  shellId: ShellId,
  options: ApplyShellConfigOptions = {}
): { applied: boolean; note?: string } {
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

  // The PATH and STARSHIP_CONFIG lines must come before the init line, or
  // `starship init` cannot resolve either the binary or its config.
  const pathDir = options.ensurePathDir;
  const pathLine = pathDir && shell.pathLine ? shell.pathLine(pathDir) : null;
  const configLine = starshipConfigLine(shellId);

  // Idempotent: skip if already configured (check for the full block we'd add).
  const blockMarker = `# Added by ShellConfigurator`;
  if (existing.includes(configLine ?? shell.initLine)) {
    return { applied: false, note: 'already configured' };
  }

  const lines = [
    ...(pathLine && !existing.includes(pathLine) ? [pathLine] : []),
    ...(configLine && !existing.includes(configLine) ? [configLine] : []),
    ...(!existing.includes(shell.initLine) ? [shell.initLine] : []),
  ];
  const addition = `\n${blockMarker}\n${lines.join('\n')}\n`;
  fs.appendFileSync(rcPath, addition, 'utf8');

  return {
    applied: true,
    note: pathLine ? `${pathDir} added to PATH` : undefined,
  };
}

/**
 * The STARSHIP_CONFIG unset for a shell that should use the shared config, in that
 * shell's own syntax. Exporting STARSHIP_CONFIG in one shell's rc leaks into every
 * shell launched from it (e.g. `bash` typed from a configured zsh), so shells not
 * given their own config must clear the variable at startup to fall back to the
 * shared ~/.config/starship.toml. Returns null for shells without a script rc file.
 */
function starshipUnsetLine(shellId: ShellId): string | null {
  const shell = getShell(shellId);
  if (!shell?.rcFile) return null;
  return shellId === 'fish' ? 'set -e STARSHIP_CONFIG' : 'unset STARSHIP_CONFIG';
}

/**
 * Makes a shell that Starship runs in but that the wizard is NOT giving its own
 * per-shell config return to the shared config, so it never inherits a leaked
 * STARSHIP_CONFIG from a configured parent shell. Idempotent — the unset line is
 * added only if not already present. Leaves the shell's prompt appearance
 * untouched (it still uses the shared starship.toml). Returns {applied:false} for
 * shells with no rc file (nushell, powershell).
 */
export function resetSharedShellConfig(shellId: ShellId): { applied: boolean; note?: string } {
  const shell = getShell(shellId);
  if (!shell) return { applied: false };
  if (!shell.rcFile) return { applied: false, note: shell.manualNote };

  const rcPath = shell.rcFile;
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
  const unsetLine = starshipUnsetLine(shellId)!;

  if (existing.includes(unsetLine)) {
    return { applied: false, note: 'already configured' };
  }

  fs.appendFileSync(rcPath, `\n# Added by ShellConfigurator\n${unsetLine}\n`, 'utf8');
  return { applied: true };
}
