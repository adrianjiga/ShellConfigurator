import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getShell, isShellId, posixShellQuote, type ShellDef } from '../config/shells.ts';
import { errorMessage } from '../services/errors.ts';
import { configHome, homeDir } from '../services/paths.ts';
import type { ShellId } from '../types.ts';

export interface WriteConfigResult {
  /** Where the config was actually written. */
  path: string;
  /** Set when an existing config was copied aside first. */
  backedUpTo?: string;
}

/**
 * Path to one shell's own config, e.g. ~/.config/starship/zsh.toml, which the
 * shell's rc file points at via STARSHIP_CONFIG.
 */
export function getShellConfigPath(shellId: ShellId): string {
  return path.join(configHome(), 'starship', `${shellId}.toml`);
}

/**
 * The shared config, ~/.config/starship.toml: per-shell configs shadow it, and
 * only an adopt run with an imported config writes it. Copied aside before an
 * install so it can be restored (see backupSharedConfig / restoreConfigBackups).
 */
export function getSharedConfigPath(): string {
  // Starship's own default ignores XDG_CONFIG_HOME.
  return path.join(homeDir(), '.config', 'starship.toml');
}

export function backupStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * A fresh `<file>.bak-<stamp>` path. A second backup in the same millisecond
 * gets a `-2`, `-3`… suffix instead of overwriting the first.
 */
export function backupPath(filePath: string): string {
  const base = `${filePath}.bak-${backupStamp()}`;
  let candidate = base;
  for (let n = 2; n < 100 && fs.existsSync(candidate); n++) candidate = `${base}-${n}`;
  return candidate;
}

/** Copies the file to a fresh backup when it exists; returns where it went. */
export function backupIfExists(filePath: string): string | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  const backup = backupPath(filePath);
  fs.copyFileSync(filePath, backup);
  return backup;
}

/** Writes a config file, creating its folder and backing up what it replaces. */
function writeWithBackup(configPath: string, toml: string): WriteConfigResult {
  const configDir = path.dirname(configPath);
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
  const backedUpTo = backupIfExists(configPath);
  writeFileAtomic(configPath, toml);
  return { path: configPath, backedUpTo };
}

/** A name `backupPath` produced: an ISO stamp with `:`/`.` replaced, maybe a suffix. */
const BACKUP_STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(-\d+)?$/;

/**
 * Where a write to `filePath` must land, and the mode it must keep. A symlink
 * (stow, chezmoi, yadm) is written through to its target so the link survives;
 * a dangling one is refused rather than replaced; a read-only file is refused
 * rather than silently made writable.
 */
function resolveWriteTarget(filePath: string): { target: string; mode?: number } {
  const link = fs.lstatSync(filePath, { throwIfNoEntry: false });
  if (!link) return { target: filePath };
  let target = filePath;
  if (link.isSymbolicLink()) {
    try {
      target = fs.realpathSync(filePath);
    } catch (err) {
      throw new Error(`${filePath} is a symlink to a file that does not exist`, { cause: err });
    }
  }
  fs.accessSync(target, fs.constants.W_OK);
  const stat = fs.statSync(target, { throwIfNoEntry: false });
  return { target, mode: stat ? stat.mode & 0o7777 : undefined };
}

/**
 * Writes a file atomically: the content goes to a uniquely named temp file in
 * the same directory, flushed to disk, then renamed over the target, keeping
 * its permissions. A reader never sees a truncated file. On failure the temp
 * file is removed and the original error re-thrown.
 */
export function writeFileAtomic(filePath: string, content: string | Buffer): void {
  const { target, mode } = resolveWriteTarget(filePath);
  const tmpPath = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  );
  try {
    fs.writeFileSync(tmpPath, content, { encoding: 'utf8', flush: true });
    if (mode !== undefined) fs.chmodSync(tmpPath, mode);
    fs.renameSync(tmpPath, target);
  } catch (err) {
    try {
      fs.rmSync(tmpPath, { force: true });
    } catch {
      // The temp file may not exist either; the write error is the useful one.
    }
    throw err;
  }
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
  try {
    const previous = newestBackup(path.dirname(shared), path.basename(shared));
    if (previous && fs.readFileSync(previous).equals(fs.readFileSync(shared))) return previous;
  } catch {
    // Fall through to a fresh copy.
  }
  try {
    return backupIfExists(shared) ?? null;
  } catch {
    return null;
  }
}

export interface RestoredConfig {
  /** 'shared' for starship.toml, otherwise the shell id. */
  what: 'shared' | ShellId;
  restoredTo: string;
  restoredFrom: string;
  /** Where the file it replaced was saved, so a restore can itself be undone. */
  previousSavedTo?: string;
}

export interface RestoreFailure {
  what: 'shared' | ShellId;
  restoredFrom: string;
  error: string;
}

export interface RestoreOutcome {
  restored: RestoredConfig[];
  failed: RestoreFailure[];
}

/** Newest *.bak-* entry for `prefix` inside `dir`, by ISO-stamped file name. */
function newestBackup(dir: string, prefix: string): string | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const marker = `${prefix}.bak-`;
  const candidates = entries
    .filter((e) => e.startsWith(marker) && BACKUP_STAMP.test(e.slice(marker.length)))
    .sort((a, b) => {
      const [stampA, nA = '1'] = a.slice(marker.length).split(/Z-?/);
      const [stampB, nB = '1'] = b.slice(marker.length).split(/Z-?/);
      return stampA === stampB ? Number(nA || 1) - Number(nB || 1) : stampA < stampB ? -1 : 1;
    });
  const newest = candidates[candidates.length - 1];
  return newest ? path.join(dir, newest) : null;
}

function restoreOne(
  what: 'shared' | ShellId,
  target: string,
  backup: string,
  outcome: RestoreOutcome
): void {
  try {
    let previousSavedTo: string | undefined;
    if (fs.existsSync(target)) {
      previousSavedTo = `${target}.pre-restore-${backupStamp()}`;
      fs.copyFileSync(target, previousSavedTo);
    }
    fs.copyFileSync(backup, target);
    outcome.restored.push({
      what,
      restoredTo: target,
      restoredFrom: backup,
      ...(previousSavedTo ? { previousSavedTo } : {}),
    });
  } catch (err) {
    outcome.failed.push({
      what,
      restoredFrom: backup,
      error: errorMessage(err),
    });
  }
}

/**
 * Copies the newest .bak-* snapshot back over the live config for the shared
 * config and every per-shell config that has one (only `onlyShells`, when the
 * shells the last run touched are known). Backups are kept, not deleted.
 * A config that fails to copy is reported in `failed` and does not stop the
 * rest; an empty outcome means nothing to restore.
 */
export function restoreConfigBackups(onlyShells?: readonly ShellId[]): RestoreOutcome {
  const base = configHome();
  const outcome: RestoreOutcome = { restored: [], failed: [] };

  const shared = getSharedConfigPath();
  const newestShared = newestBackup(path.dirname(shared), path.basename(shared));
  if (newestShared) restoreOne('shared', shared, newestShared, outcome);

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
      if (onlyShells && !onlyShells.includes(shellId)) continue;
      const backup = newestBackup(shellsDir, `${shellId}.toml`);
      if (!backup) continue;
      restoreOne(shellId, getShellConfigPath(shellId), backup, outcome);
    }
  }

  return outcome;
}

const INIT_COMMAND: Record<ShellId, string> = {
  bash: 'starship init bash',
  zsh: 'starship init zsh',
  fish: 'starship init fish',
  nushell: 'starship init nu',
  powershell: 'starship init powershell',
};

/**
 * True when a non-comment line runs the shell's init, in any spelling the shell
 * accepts: the line we write, `source <(starship init zsh)`, an absolute binary
 * path, or fish's conf.d file (checked by callers via `fishInitFile`).
 */
export function hasStarshipInit(content: string, shellId: ShellId): boolean {
  return initLineIndex(content.split('\n'), shellId) !== -1;
}

/** Index of the first non-comment line that runs the shell's init, or -1. */
function initLineIndex(lines: string[], shellId: ShellId): number {
  const command = INIT_COMMAND[shellId];
  return lines.findIndex((line) => !line.trimStart().startsWith('#') && line.includes(command));
}

/** Fish's drop-in init file, which `hasStarshipInit` cannot see from config.fish. */
export function fishInitFile(rcFile: string): string {
  return path.join(path.dirname(rcFile), 'conf.d', 'starship.fish');
}

export interface RcIo {
  exists: (path: string) => boolean;
  readFile: (path: string) => string;
}

export const FS_RC_IO: RcIo = {
  exists: (filePath) => fs.existsSync(filePath),
  readFile: (filePath) => fs.readFileSync(filePath, 'utf8'),
};

/**
 * Of the given installed shells, the ones whose rc actually loads Starship.
 * Clearing a leaked STARSHIP_CONFIG only makes sense where Starship runs.
 */
export function shellsWithStarshipInit(shells: ShellId[], io: RcIo = FS_RC_IO): ShellId[] {
  return shells.filter((shellId) => {
    const shell = getShell(shellId);
    if (!shell?.rcFile) return false;
    try {
      if (!io.exists(shell.rcFile)) return false;
      if (hasStarshipInit(io.readFile(shell.rcFile), shellId)) return true;
      return shellId === 'fish' && io.exists(fishInitFile(shell.rcFile));
    } catch {
      return false;
    }
  });
}

/**
 * True when a manual-setup shell's init command has already been applied:
 * nushell's autoload file exists (written by the documented one-liner), or
 * powershell's $PROFILE contains the init line.
 */
export function manualSetupAppliedWith(
  shell: ShellDef,
  io: RcIo,
  pointAtSharedConfig = false
): boolean {
  if (!shell.initPath) return false;
  if (shell.id === 'powershell') {
    // The all-hosts profile.ps1 beside the current-host profile is loaded too.
    const profiles = [shell.initPath, path.join(path.dirname(shell.initPath), 'profile.ps1')];
    return profiles.some((profile) => {
      try {
        return io.exists(profile) && hasStarshipInit(io.readFile(profile), shell.id);
      } catch {
        return false;
      }
    });
  }
  if (!io.exists(shell.initPath)) return false;
  // Adopt mode reads the shared config, so the per-shell pin must be gone.
  const pins = shell.additionalInitPaths ?? [];
  return pointAtSharedConfig
    ? pins.every((filePath) => !io.exists(filePath))
    : pins.every((filePath) => io.exists(filePath));
}

export function manualSetupApplied(shell: ShellDef, pointAtSharedConfig = false): boolean {
  return manualSetupAppliedWith(shell, FS_RC_IO, pointAtSharedConfig);
}

/**
 * Writes one shell's config, backing up any existing file first. Never touches
 * the shared starship.toml.
 */
export function writeShellConfig(toml: string, shellId: ShellId): WriteConfigResult {
  const configPath = getShellConfigPath(shellId);
  return writeWithBackup(configPath, toml);
}

/**
 * Writes the shared ~/.config/starship.toml (adopt mode, e.g. a config fetched
 * via --import-url), backing up any existing file first. This is the file every
 * wired shell reads, so it is the one write an adopt-mode run performs.
 */
export function writeSharedConfig(toml: string): WriteConfigResult {
  const configPath = getSharedConfigPath();
  return writeWithBackup(configPath, toml);
}

export const BLOCK_MARKER = '# Added by ShellConfigurator';
/**
 * Adopt-mode block marker: these blocks carry only the init line (no
 * STARSHIP_CONFIG export), so a later non-adopt run can recognise and drop them.
 */
export const ADOPT_MARKER = '# Added by ShellConfigurator (shared config)';

function isBlockMarkerLine(line: string): boolean {
  const t = line.trim();
  return t === BLOCK_MARKER || t === ADOPT_MARKER;
}

function isPathLine(shell: ShellDef, line: string): boolean {
  const t = line.trim();
  return shell.id === 'fish'
    ? t.startsWith('fish_add_path ')
    : t.startsWith('export PATH=') && (t.endsWith(':$PATH"') || t.endsWith(':"$PATH"'));
}

/**
 * The lines a managed block may contain: anything else (a blank line, a user
 * line) ends the block.
 */
function isManagedLine(shell: ShellDef, line: string): boolean {
  const t = line.trim();
  if (t === shell.initLine || isPathLine(shell, t)) return true;
  const env = shell.configEnv;
  return Boolean(env && (t.startsWith(env.exportPrefix) || t === env.unsetLine));
}

/** Matches a managed line by its trimmed text, so CRLF files and stray spaces still match. */
type LineNeedle = string | ((trimmed: string) => boolean);

function lineMatches(line: string, needle: LineNeedle): boolean {
  const t = line.trim();
  return typeof needle === 'string' ? t === needle.trim() : needle(t);
}

/** Any per-shell STARSHIP_CONFIG export, whatever path an earlier run wrote. */
function isConfigExport(shell: ShellDef): LineNeedle {
  const prefix = shell.configEnv?.exportPrefix;
  return (t) => prefix !== undefined && t.startsWith(prefix);
}

/**
 * Drops every "Added by ShellConfigurator" block containing any needle, so a
 * re-run can repair an rc polluted by the opposite block from an earlier run.
 */
function removeShellConfiguratorBlocks(
  content: string,
  shell: ShellDef,
  needles: LineNeedle[],
  removedPathLines: string[] = []
): string {
  const lines = content.split('\n');
  const out: string[] = [];
  let removed = false;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Adopt-mode blocks share the marker prefix, so both are recognised here.
    if (isBlockMarkerLine(line)) {
      const block = [line];
      let j = i + 1;
      while (j < lines.length && !isBlockMarkerLine(lines[j]) && isManagedLine(shell, lines[j])) {
        block.push(lines[j]);
        j++;
      }
      if (needles.some((n) => block.some((blockLine) => lineMatches(blockLine, n)))) {
        // Drop the stale block (and the blank line that follows it), keeping
        // note of its PATH line: without it starship may not be found at all.
        removedPathLines.push(...block.filter((l) => isPathLine(shell, l)).map((l) => l.trim()));
        removed = true;
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
  return removed ? out.join('\n') : content;
}

/** Whether a ShellConfigurator block in `content` exports STARSHIP_CONFIG (an adopt run removes it). */
export function hasManagedConfigExport(shellId: ShellId, content: string): boolean {
  const shell = getShell(shellId);
  if (!shell) return false;
  return removeShellConfiguratorBlocks(content, shell, [isConfigExport(shell)]) !== content;
}

export interface ApplyShellConfigOptions {
  /** Directory to prepend to PATH ahead of the init line, when starship is not reachable. */
  ensurePathDir?: string | null;
  /** Adopt mode: emit no STARSHIP_CONFIG export, so the shell reads the shared
   *  ~/.config/starship.toml (the user's existing or imported config) instead of
   *  a per-shell TOML the wizard generated. */
  pointAtSharedConfig?: boolean;
}

/**
 * STARSHIP_CONFIG export for a shell, in that shell's own syntax. Null for
 * shells without a script rc file (nushell, powershell).
 */
export function starshipConfigLine(shellId: ShellId): string | null {
  const env = getShell(shellId)?.configEnv;
  if (!env) return null;
  return `${env.exportPrefix}${posixShellQuote(getShellConfigPath(shellId))}`;
}

/** Creates the rc file's parent directory (important for fish) when missing. */
function ensureRcDir(rcPath: string): void {
  const rcDir = path.dirname(rcPath);
  if (fs.existsSync(rcDir)) return;
  try {
    fs.mkdirSync(rcDir, { recursive: true });
  } catch (err) {
    throw new Error(`Cannot create directory ${rcDir}: ${errorMessage(err)}`, { cause: err });
  }
}

/** True when a non-comment line of `content` is exactly `line`. */
function hasLine(content: string, line: string): boolean {
  return content.split('\n').some((l) => l.trim() === line);
}

/**
 * The PATH, STARSHIP_CONFIG, and init lines still missing from the cleaned rc
 * file, each checked on its own so a removed init line or a newly needed PATH
 * line is never skipped as "already configured".
 */
function buildAdditionLines(
  shell: ShellDef,
  cleaned: string,
  pathDir: string | null | undefined,
  configLine: string | null,
  initPresent: boolean
): { lines: string[]; pathLine: string | null } {
  const wantedPath = pathDir && shell.pathLine ? shell.pathLine(pathDir) : null;
  const pathLine = wantedPath && !hasLine(cleaned, wantedPath) ? wantedPath : null;
  return {
    lines: [
      ...(pathLine ? [pathLine] : []),
      ...(configLine && !hasLine(cleaned, configLine) ? [configLine] : []),
      ...(!initPresent ? [shell.initLine] : []),
    ],
    pathLine,
  };
}

/**
 * Puts `lines` just above the first init line: PATH must be set before
 * `starship init` runs, and zsh/bash read the config at init time for the
 * continuation prompt. Inside a managed block the lines join it; above a user's
 * own init line they form a block of their own, closed by a blank line so the
 * user's line never becomes part of it. Null when no init line is in the file.
 */
function insertBeforeInit(
  content: string,
  shell: ShellDef,
  marker: string,
  lines: string[]
): string | null {
  const all = content.split('\n');
  const index = initLineIndex(all, shell.id);
  if (index === -1) return null;

  let above = index - 1;
  while (above >= 0 && !isBlockMarkerLine(all[above]) && isManagedLine(shell, all[above])) {
    above--;
  }
  const inBlock = above >= 0 && isBlockMarkerLine(all[above]);
  all.splice(index, 0, ...(inBlock ? lines : [marker, ...lines, '']));
  return all.join('\n');
}

export interface RcPlan {
  content: string;
  applied: boolean;
  note?: string;
}

/**
 * What `applyShellConfig` makes of the rc text `existing`, without writing it:
 * `content` equals `existing` when the file stays as it is. Null for shells
 * without an rc file.
 */
export function appliedRcContent(
  shellId: ShellId,
  existing: string,
  options: ApplyShellConfigOptions = {},
  io: RcIo = FS_RC_IO
): RcPlan | null {
  const shell = getShell(shellId);
  if (!shell?.rcFile) return null;
  const rcPath = shell.rcFile;

  // Drop stale blocks this run is not the owner of, so the modes stay mutually
  // exclusive: a leftover "unset" guard from a reset run, an adopt-mode block
  // when writing per-shell configs, and — in adopt mode — a per-shell export a
  // previous non-adopt run left pointing at a per-shell TOML.
  const configLine = options.pointAtSharedConfig ? null : starshipConfigLine(shellId);
  const cleanNeedles: LineNeedle[] = [starshipUnsetLine(shellId)!];
  if (options.pointAtSharedConfig) {
    cleanNeedles.push(isConfigExport(shell));
  } else {
    cleanNeedles.push(ADOPT_MARKER);
    // An export an earlier run wrote for a different config path is stale too.
    cleanNeedles.push((t) => lineMatches(t, isConfigExport(shell)) && t !== configLine);
  }
  const carriedPathLines: string[] = [];
  const cleaned = removeShellConfiguratorBlocks(existing, shell, cleanNeedles, carriedPathLines);

  const initPresent =
    hasStarshipInit(cleaned, shell.id) || (shell.id === 'fish' && io.exists(fishInitFile(rcPath)));

  const added = buildAdditionLines(shell, cleaned, options.ensurePathDir, configLine, initPresent);
  const carried = [...new Set(carriedPathLines)].filter(
    (line) => line !== added.pathLine && !hasLine(cleaned, line)
  );
  const lines = [...carried, ...added.lines];
  const { pathLine } = added;
  if (lines.length === 0) {
    return { content: cleaned, applied: false, note: 'already configured' };
  }

  const marker = options.pointAtSharedConfig ? ADOPT_MARKER : BLOCK_MARKER;
  const inserted = initPresent ? insertBeforeInit(cleaned, shell, marker, lines) : null;
  return {
    content: inserted ?? appendManagedBlock(cleaned, marker, lines),
    applied: true,
    note: pathLine ? `${options.ensurePathDir} added to PATH` : undefined,
  };
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
    if (manualSetupApplied(shell, options.pointAtSharedConfig)) {
      return { applied: false, note: 'already configured' };
    }
    return { applied: false, note: shell.manualNote };
  }

  const rcPath = shell.rcFile;
  ensureRcDir(rcPath);
  const existing = fs.existsSync(rcPath) ? fs.readFileSync(rcPath, 'utf8') : '';
  const { content, ...result } = appliedRcContent(shellId, existing, options)!;
  if (content !== existing) writeFileAtomic(rcPath, content);
  return result;
}

/** Appends a managed block at the end, after a blank line unless the file is empty. */
function appendManagedBlock(content: string, marker: string, lines: string[]): string {
  return `${content === '' ? '' : `${content}\n`}${marker}\n${lines.join('\n')}\n`;
}

/**
 * STARSHIP_CONFIG unset for a shell that should use the shared config: clears a
 * leaked export from a configured parent shell. Null for shells without an rc file.
 */
function starshipUnsetLine(shellId: ShellId): string | null {
  return getShell(shellId)?.configEnv?.unsetLine ?? null;
}

/** True when the line sets STARSHIP_CONFIG, in any form a user or an earlier run wrote. */
function setsStarshipConfig(shell: ShellDef, line: string): boolean {
  const t = line.trim();
  if (t.startsWith('#')) return false;
  return shell.id === 'fish'
    ? fishExportsStarshipConfig(t)
    : /^(export\s+)?STARSHIP_CONFIG=/.test(t);
}

function fishExportsStarshipConfig(line: string): boolean {
  const [command, ...rest] = line.split(/\s+/);
  if (command !== 'set') return false;
  const nameAt = rest.findIndex((word) => !word.startsWith('-'));
  const flags = rest.slice(0, nameAt === -1 ? rest.length : nameAt);
  const exported = flags.some((flag) =>
    flag.startsWith('--') ? flag === '--export' : flag.includes('x')
  );
  return exported && rest[nameAt] === 'STARSHIP_CONFIG';
}

/**
 * Points a Starship-running shell that wasn't selected this run back at the
 * shared config: removes the per-shell block an earlier run wrote (keeping its
 * PATH line and init), and adds an unset guard above the init line against a
 * STARSHIP_CONFIG leaked from a configured parent shell. A shell whose rc sets
 * STARSHIP_CONFIG itself keeps that export and gets no guard. Idempotent.
 */
export function resetSharedShellConfig(shellId: ShellId): { applied: boolean; note?: string } {
  const shell = getShell(shellId);
  if (!shell) return { applied: false };
  if (!shell.rcFile) return { applied: false, note: shell.manualNote };

  const rcPath = shell.rcFile;
  ensureRcDir(rcPath);
  const existing = fs.existsSync(rcPath) ? fs.readFileSync(rcPath, 'utf8') : '';
  const { content, ...result } = resetRcContent(shellId, existing)!;
  if (content !== existing) writeFileAtomic(rcPath, content);
  return result;
}

/**
 * What `resetSharedShellConfig` makes of the rc text `existing`, without
 * writing it. Null for shells without an rc file.
 */
export function resetRcContent(
  shellId: ShellId,
  existing: string,
  io: RcIo = FS_RC_IO
): RcPlan | null {
  const shell = getShell(shellId);
  if (!shell?.rcFile) return null;
  const rcPath = shell.rcFile;
  const unsetLine = starshipUnsetLine(shellId)!;
  const carried: string[] = [];

  let content = removeShellConfiguratorBlocks(existing, shell, [isConfigExport(shell)], carried);
  const ownExport = content.split('\n').some((line) => setsStarshipConfig(shell, line));
  // A stale unset guard after the shell's own export would cancel it.
  if (ownExport && hasLine(content, unsetLine)) {
    content = removeShellConfiguratorBlocks(content, shell, [unsetLine], carried);
  }

  const initPresent =
    hasStarshipInit(content, shellId) || (shell.id === 'fish' && io.exists(fishInitFile(rcPath)));
  const needsInit = !initPresent && hasStarshipInit(existing, shellId);
  const lines = [
    ...[...new Set(carried)].filter((line) => !hasLine(content, line)),
    ...(!ownExport && !hasLine(content, unsetLine) ? [unsetLine] : []),
  ];
  const note = ownExport ? 'sets its own STARSHIP_CONFIG' : undefined;

  if (lines.length === 0 && !needsInit) {
    return { content, applied: false, note: note ?? 'already configured' };
  }

  const inserted = initPresent ? insertBeforeInit(content, shell, BLOCK_MARKER, lines) : null;
  return {
    content:
      inserted ??
      appendManagedBlock(content, BLOCK_MARKER, needsInit ? [...lines, shell.initLine] : lines),
    applied: true,
    ...(note ? { note } : {}),
  };
}

const EVERY_BLOCK: LineNeedle = () => true;

/** Whether the shell's rc file has a ShellConfigurator block. */
export function hasManagedRcBlock(shellId: ShellId, io: RcIo = FS_RC_IO): boolean {
  const shell = getShell(shellId);
  if (!shell?.rcFile) return false;
  try {
    if (!io.exists(shell.rcFile)) return false;
    const content = io.readFile(shell.rcFile);
    return removeShellConfiguratorBlocks(content, shell, [EVERY_BLOCK]) !== content;
  } catch {
    return false;
  }
}

/**
 * Whether the shell starts Starship: from its rc (ignoring ShellConfigurator's
 * blocks when `withoutManagedBlocks`, as after an uninstall), fish's conf.d
 * file, or a hand-applied Nushell or PowerShell setup.
 */
export function startsStarship(
  shellId: ShellId,
  withoutManagedBlocks: boolean,
  io: RcIo = FS_RC_IO
): boolean {
  const shell = getShell(shellId);
  if (!shell) return false;
  if (!shell.rcFile) {
    return manualSetupAppliedWith(shell, io, false) || manualSetupAppliedWith(shell, io, true);
  }
  try {
    if (shell.id === 'fish' && io.exists(fishInitFile(shell.rcFile))) return true;
    if (!io.exists(shell.rcFile)) return false;
    const content = io.readFile(shell.rcFile);
    const kept = withoutManagedBlocks
      ? removeShellConfiguratorBlocks(content, shell, [EVERY_BLOCK])
      : content;
    return hasStarshipInit(kept, shellId);
  } catch {
    return false;
  }
}

export interface RemovalResult {
  removed: boolean;
  backedUpTo?: string;
  note?: string;
}

/**
 * Removes every ShellConfigurator block from the shell's rc file, after backing
 * it up. A PATH line a block carried stays when the user's own init line (or
 * fish's conf.d init) still needs it to find Starship.
 */
export function removeManagedRcBlocks(shellId: ShellId): RemovalResult {
  const shell = getShell(shellId);
  if (!shell?.rcFile) return { removed: false, note: 'no rc file' };
  const rcPath = shell.rcFile;
  if (!fs.existsSync(rcPath)) return { removed: false, note: `${rcPath} does not exist` };

  const existing = fs.readFileSync(rcPath, 'utf8');
  const carried: string[] = [];
  const stripped = removeShellConfiguratorBlocks(existing, shell, [EVERY_BLOCK], carried);
  if (stripped === existing) {
    return { removed: false, note: `no ShellConfigurator lines in ${rcPath}` };
  }

  const ownInit = hasStarshipInit(stripped, shellId);
  const confDInit = !ownInit && shellId === 'fish' && fs.existsSync(fishInitFile(rcPath));
  const kept =
    ownInit || confDInit ? [...new Set(carried)].filter((line) => !hasLine(stripped, line)) : [];
  const lines = stripped.split('\n');
  if (kept.length > 0) {
    const at = ownInit
      ? initLineIndex(lines, shellId)
      : lines.length - (lines.at(-1) === '' ? 1 : 0);
    lines.splice(at, 0, ...kept);
  }

  const backedUpTo = backupIfExists(rcPath);
  writeFileAtomic(rcPath, lines.join('\n'));
  const notes = [
    ...(ownInit ? ['your own Starship init line stays'] : []),
    ...(confDInit ? ['your conf.d/starship.fish init stays'] : []),
    ...(kept.length > 0 ? ['kept the PATH line it needs'] : []),
  ];
  return {
    removed: true,
    ...(backedUpTo ? { backedUpTo } : {}),
    ...(notes.length > 0 ? { note: notes.join('; ') } : {}),
  };
}

/** Moves a shell's per-shell config aside to a backup, which `--restore` can bring back. */
export function removeShellConfigFile(shellId: ShellId): RemovalResult {
  const configPath = getShellConfigPath(shellId);
  if (!fs.existsSync(configPath)) return { removed: false, note: `${configPath} does not exist` };
  const backedUpTo = backupPath(configPath);
  fs.renameSync(configPath, backedUpTo);
  return { removed: true, backedUpTo };
}
