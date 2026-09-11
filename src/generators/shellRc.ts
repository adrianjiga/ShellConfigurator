import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getShell, isShellId, type ShellDef } from '../config/shells.ts';
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
 * The shared config the wizard never writes but shadows with per-shell configs:
 * ~/.config/starship.toml. Copied aside before an install so it can be restored
 * (see backupSharedConfig / restoreConfigBackups).
 */
export function getSharedConfigPath(): string {
  return path.join(getConfigBaseDir(), 'starship.toml');
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * Snapshots the shared starship.toml before per-shell configs shadow it. Returns
 * the backup path, or null when there is no shared config to protect. Best-effort:
 * a copy failure returns null rather than throwing, so a backup problem can never
 * block the install.
 */
export function backupSharedConfig(): string | null {
  const shared = getSharedConfigPath();
  if (!fs.existsSync(shared)) return null;
  const backup = `${shared}.bak-${stamp()}`;
  try {
    fs.copyFileSync(shared, backup);
  } catch {
    return null;
  }
  return backup;
}

export interface RestoredConfig {
  /** 'shared' for starship.toml, otherwise the shell id. */
  what: 'shared' | ShellId;
  restoredTo: string;
  restoredFrom: string;
}

/** Newest *.bak-* entry for `prefix` inside `dir`, by ISO-stamped file name. */
function newestBackup(dir: string, prefix: string): string | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const candidates = entries.filter((e) => e.startsWith(`${prefix}.bak-`)).sort();
  const newest = candidates[candidates.length - 1];
  return newest ? path.join(dir, newest) : null;
}

function restoreOne(what: 'shared' | ShellId, target: string, backup: string): RestoredConfig {
  fs.copyFileSync(backup, target);
  return { what, restoredTo: target, restoredFrom: backup };
}

/**
 * Copies the newest .bak-* snapshot back over the live config for the shared
 * config and every per-shell config that has one. Backups are kept, not deleted.
 * Returns every restored config; an empty array means nothing to restore.
 */
export function restoreConfigBackups(): RestoredConfig[] {
  const base = getConfigBaseDir();
  const restored: RestoredConfig[] = [];

  const newestShared = newestBackup(base, 'starship.toml');
  if (newestShared) restored.push(restoreOne('shared', getSharedConfigPath(), newestShared));

  const shellsDir = path.join(base, 'starship');
  if (fs.existsSync(shellsDir)) {
    let entries: string[];
    try {
      entries = fs.readdirSync(shellsDir);
    } catch {
      entries = [];
    }
    const shells = new Set(
      entries.map((e) => /^(.+)\.toml\.bak-.*$/.exec(e)?.[1]).filter(isShellId)
    );
    for (const shellId of shells) {
      const backup = newestBackup(shellsDir, `${shellId}.toml`);
      if (!backup) continue;
      restored.push(restoreOne(shellId, getShellConfigPath(shellId), backup));
    }
  }

  return restored;
}

/**
 * True when a manual-setup shell's init command has already been applied:
 * nushell's autoload file exists (written by the documented one-liner), or
 * powershell's $PROFILE contains the init line.
 */
function manualSetupApplied(shell: ShellDef): boolean {
  if (!shell.initPath || !fs.existsSync(shell.initPath)) return false;
  if (shell.id === 'powershell') {
    try {
      return fs.readFileSync(shell.initPath, 'utf8').includes(shell.initLine);
    } catch {
      return false;
    }
  }
  return true;
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
    backedUpTo = `${configPath}.bak-${stamp()}`;
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
export function starshipConfigLine(shellId: ShellId): string | null {
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

/**
 * Computes the PATH, STARSHIP_CONFIG, and init lines that should be appended,
 * skipping any already present in the cleaned rc file.
 */
function buildAdditionLines(
  shell: ShellDef,
  cleaned: string,
  options: ApplyShellConfigOptions
): string[] {
  const pathDir = options.ensurePathDir;
  const pathLine = pathDir && shell.pathLine ? shell.pathLine(pathDir) : null;
  const configLine = starshipConfigLine(shell.id);
  return [
    ...(pathLine && !cleaned.includes(pathLine) ? [pathLine] : []),
    ...(configLine && !cleaned.includes(configLine) ? [configLine] : []),
    ...(!cleaned.includes(shell.initLine) ? [shell.initLine] : []),
  ];
}

export function applyShellConfig(
  shellId: ShellId,
  options: ApplyShellConfigOptions = {}
): { applied: boolean; note?: string } {
  const shell = getShell(shellId);
  if (!shell) return { applied: false };

  // Shells with no automatic rc file (nushell, powershell) need manual setup.
  // If the init command has already been applied, a re-run should say so rather
  // than always reporting "set up manually".
  if (!shell.rcFile) {
    if (manualSetupApplied(shell)) {
      return { applied: false, note: 'already configured' };
    }
    return { applied: false, note: shell.manualNote };
  }

  const rcPath = shell.rcFile;
  ensureRcDir(rcPath);

  const existing = fs.existsSync(rcPath) ? fs.readFileSync(rcPath, 'utf8') : '';

  // Drop a stale unset guard a later "reset" run may have left.
  const cleaned = removeShellConfiguratorBlocks(existing, [starshipUnsetLine(shellId)!]);
  if (cleaned !== existing) fs.writeFileSync(rcPath, cleaned, 'utf8');

  // The PATH and STARSHIP_CONFIG lines must come before the init line, or
  // `starship init` cannot resolve either the binary or its config.
  const configLine = starshipConfigLine(shellId);

  // Idempotent: skip if already configured (check for the full block we'd add).
  if (cleaned.includes(configLine ?? shell.initLine)) {
    return { applied: false, note: 'already configured' };
  }

  const lines = buildAdditionLines(shell, cleaned, options);
  const addition = `\n${BLOCK_MARKER}\n${lines.join('\n')}\n`;
  fs.appendFileSync(rcPath, addition, 'utf8');

  return {
    applied: true,
    note:
      options.ensurePathDir && shell.pathLine
        ? `${options.ensurePathDir} added to PATH`
        : undefined,
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
