import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getShell } from '../config/shells.ts';
import type { ShellId } from '../types.ts';

export interface WriteConfigResult {
  /** Where the config was actually written. */
  path: string;
  /** Set when an existing config was copied aside first. */
  backedUpTo?: string;
}

/**
 * Base directory for per-shell Starship configs: $XDG_CONFIG_HOME, else
 * ~/.config. Resolved per call so the env is read live.
 */
function getConfigBaseDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  return xdg ? xdg : path.join(os.homedir(), '.config');
}

/**
 * Path to one shell's own config, e.g. ~/.config/starship/zsh.toml, which the
 * shell's rc file points at via STARSHIP_CONFIG.
 */
export function getShellConfigPath(shellId: ShellId): string {
  return path.join(getConfigBaseDir(), 'starship', `${shellId}.toml`);
}

/**
 * Writes one shell's config, backing up any existing file first (overwriting is
 * the one irreversible step). Never touches the shared starship.toml.
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

const BLOCK_MARKER = '# Added by ShellConfigurator';

/**
 * Drops every "Added by ShellConfigurator" block containing any needle, so a
 * re-run can repair an rc polluted by the opposite block from an earlier run.
 */
function removeShellConfiguratorBlocks(content: string, needles: string[]): string {
  const lines = content.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === BLOCK_MARKER) {
      const block = [line];
      let j = i + 1;
      while (j < lines.length && lines[j].trim() !== '') {
        block.push(lines[j]);
        j++;
      }
      if (needles.some((n) => block.includes(n))) {
        // Drop the stale block (and the blank line that follows it).
        i = j;
        if (i < lines.length && lines[i].trim() === '') i++;
        continue;
      }
      // Keep the block, ensuring a single blank line separates it from whatever
      // came before.
      if (out.length > 0 && out[out.length - 1].trim() !== '') out.push('');
      out.push(...block);
      i = j;
    } else {
      out.push(line);
      i++;
    }
  }
  return out.join('\n');
}

export interface ApplyShellConfigOptions {
  /** Directory to prepend to PATH ahead of the init line, when starship is not reachable. */
  ensurePathDir?: string | null;
}

/**
 * STARSHIP_CONFIG export for a shell, in that shell's own syntax. Null for
 * shells without a script rc file (nushell, powershell).
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

/** Creates the rc file's parent directory (important for fish) when missing. */
function ensureRcDir(rcPath: string): void {
  const rcDir = path.dirname(rcPath);
  if (fs.existsSync(rcDir)) return;
  try {
    fs.mkdirSync(rcDir, { recursive: true });
  } catch (err) {
    throw new Error(
      `Cannot create directory ${rcDir}: ${err instanceof Error ? err.message : err}`,
      { cause: err }
    );
  }
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
  ensureRcDir(rcPath);

  const existing = fs.existsSync(rcPath) ? fs.readFileSync(rcPath, 'utf8') : '';

  // Drop a stale unset guard a later "reset" run may have left.
  const cleaned = removeShellConfiguratorBlocks(existing, [starshipUnsetLine(shellId)!]);
  // Persist removals before appending below.
  if (cleaned !== existing) fs.writeFileSync(rcPath, cleaned, 'utf8');

  // The PATH and STARSHIP_CONFIG lines must come before the init line, or
  // `starship init` cannot resolve either the binary or its config.
  const pathDir = options.ensurePathDir;
  const pathLine = pathDir && shell.pathLine ? shell.pathLine(pathDir) : null;
  const configLine = starshipConfigLine(shellId);

  // Idempotent: skip if already configured (check for the full block we'd add).
  if (cleaned.includes(configLine ?? shell.initLine)) {
    return { applied: false, note: 'already configured' };
  }

  const lines = [
    ...(pathLine && !cleaned.includes(pathLine) ? [pathLine] : []),
    ...(configLine && !cleaned.includes(configLine) ? [configLine] : []),
    ...(!cleaned.includes(shell.initLine) ? [shell.initLine] : []),
  ];
  const addition = `\n${BLOCK_MARKER}\n${lines.join('\n')}\n`;
  fs.appendFileSync(rcPath, addition, 'utf8');

  return {
    applied: true,
    note: pathLine ? `${pathDir} added to PATH` : undefined,
  };
}

/**
 * STARSHIP_CONFIG unset for a shell that should use the shared config: clears a
 * leaked export from a configured parent shell. Null for shells without an rc file.
 */
function starshipUnsetLine(shellId: ShellId): string | null {
  const shell = getShell(shellId);
  if (!shell?.rcFile) return null;
  return shellId === 'fish' ? 'set -e STARSHIP_CONFIG' : 'unset STARSHIP_CONFIG';
}

/**
 * Points a Starship-running shell that wasn't given its own config back at the
 * shared config, so it never inherits a leaked STARSHIP_CONFIG. Idempotent.
 */
export function resetSharedShellConfig(shellId: ShellId): { applied: boolean; note?: string } {
  const shell = getShell(shellId);
  if (!shell) return { applied: false };
  if (!shell.rcFile) return { applied: false, note: shell.manualNote };

  const rcPath = shell.rcFile;
  ensureRcDir(rcPath);

  const existing = fs.existsSync(rcPath) ? fs.readFileSync(rcPath, 'utf8') : '';
  // Drop any per-shell wiring an earlier "configure" run may have added.
  const cleaned = removeShellConfiguratorBlocks(existing, [
    starshipConfigLine(shellId)!,
    shell.initLine,
  ]);
  if (cleaned !== existing) fs.writeFileSync(rcPath, cleaned, 'utf8');
  const unsetLine = starshipUnsetLine(shellId)!;

  if (cleaned.includes(unsetLine)) {
    return { applied: false, note: 'already configured' };
  }

  fs.appendFileSync(rcPath, `\n${BLOCK_MARKER}\n${unsetLine}\n`, 'utf8');
  return { applied: true };
}
