import * as fs from 'node:fs';
import * as path from 'node:path';
import { getShell } from '../config/shells.ts';
import { errorMessage } from '../services/errors.ts';
import type { ShellId } from '../types.ts';
import { bashLoginFile, ensureBashLogin } from './bashLogin.ts';
import { getSharedConfigPath, getShellConfigPath } from './configPaths.ts';
import {
  assertWritable,
  type KeepOriginalOptions,
  keepOriginal,
  type RemovalResult,
  readTextToRewrite,
  withNote,
  writeFileAtomic,
} from './fileWrite.ts';
import { FS_RC_IO, fishInitFile, initReachable, manualSetupApplied } from './rcInit.ts';
import {
  EVERY_BLOCK,
  hasLine,
  hasStarshipInit,
  initLineIndex,
  keepLineEndings,
  removeShellConfiguratorBlocks,
} from './rcLines.ts';
import {
  type ApplyShellConfigOptions,
  appliedRcContent,
  resetRcContent,
  sourcedInitIndex,
} from './rcPlan.ts';

export interface WriteConfigResult {
  /** Where the config was actually written. */
  path: string;
  note?: string;
}

/** Writes a config file, creating its folder. */
function writeConfigFile(
  configPath: string,
  toml: string,
  options: KeepOriginalOptions = {}
): WriteConfigResult {
  const configDir = path.dirname(configPath);
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
  const current = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : null;
  if (current === toml) return { path: configPath };
  const note = keepOriginal(configPath, options);
  writeFileAtomic(configPath, toml);
  return { path: configPath, ...(note ? { note } : {}) };
}

/**
 * Writes one shell's config, keeping the original of a hand-written one first.
 * Never touches the shared starship.toml.
 */
export function writeShellConfig(toml: string, shellId: ShellId): WriteConfigResult {
  const configPath = getShellConfigPath(shellId);
  return writeConfigFile(configPath, toml, { toolOwned: true });
}

/**
 * Writes the shared ~/.config/starship.toml (adopt mode, e.g. a config fetched
 * via --import-url), keeping the original of an existing file first. This is the file every
 * wired shell reads, so it is the one write an adopt-mode run performs.
 */
export function writeSharedConfig(toml: string): WriteConfigResult {
  const configPath = getSharedConfigPath();
  return writeConfigFile(configPath, toml);
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
  const existing = fs.existsSync(rcPath) ? readTextToRewrite(rcPath) : '';
  const { content, ...planned } = appliedRcContent(shellId, existing, options)!;
  const copyNote = content === existing ? null : keepOriginal(rcPath);
  if (content !== existing) writeFileAtomic(rcPath, content);
  const result = withNote<{ applied: boolean; note?: string }>(planned, copyNote);
  if (shellId !== 'bash') return result;
  let loginNote: string;
  try {
    const login = ensureBashLogin();
    if (!login) return result;
    loginNote = `${path.basename(login.file)} now loads .bashrc`;
    if (login.note) loginNote = `${loginNote}, but ${login.note}`;
  } catch (err) {
    loginNote = `could not make ${path.basename(bashLoginFile())} load .bashrc (${errorMessage(err)}), so macOS terminals may not show the prompt`;
    if (!result.applied) return withNote({ applied: false, note: loginNote }, copyNote);
  }
  const rcNote = result.applied ? result.note : (copyNote ?? undefined);
  return { applied: true, note: rcNote ? `${rcNote}; ${loginNote}` : loginNote };
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
  const existing = fs.existsSync(rcPath) ? readTextToRewrite(rcPath) : '';
  const { content, ...result } = resetRcContent(shellId, existing)!;
  if (content === existing) return result;
  const note = keepOriginal(rcPath);
  writeFileAtomic(rcPath, content);
  return withNote(result, note);
}

/**
 * Removes every ShellConfigurator block from the shell's rc file. A PATH line a block carried stays when the user's own init line (or
 * fish's conf.d init) still needs it to find Starship.
 */
export function removeManagedRcBlocks(shellId: ShellId): RemovalResult {
  const shell = getShell(shellId);
  if (!shell?.rcFile) return { removed: false, note: 'no rc file' };
  const rcPath = shell.rcFile;
  if (!fs.existsSync(rcPath)) return { removed: false, note: `${rcPath} does not exist` };

  const existing = readTextToRewrite(rcPath);
  const carried: string[] = [];
  const stripped = removeShellConfiguratorBlocks(existing, shell, [EVERY_BLOCK], carried);
  if (stripped === existing) {
    return { removed: false, note: `no ShellConfigurator lines in ${rcPath}` };
  }

  const ownInit = hasStarshipInit(stripped, shellId);
  const otherInit =
    !ownInit &&
    ((shellId === 'fish' && fs.existsSync(fishInitFile(rcPath))) ||
      initReachable(stripped, shellId));
  const kept =
    ownInit || otherInit ? [...new Set(carried)].filter((line) => !hasLine(stripped, line)) : [];
  const lines = stripped.split('\n');
  if (kept.length > 0) {
    const sourced = ownInit ? -1 : sourcedInitIndex(lines, shell, FS_RC_IO);
    const at = ownInit
      ? initLineIndex(lines, shellId)
      : sourced !== -1
        ? sourced
        : lines.length - (lines.at(-1) === '' ? 1 : 0);
    lines.splice(at, 0, ...kept);
  }

  assertWritable(rcPath);
  writeFileAtomic(rcPath, keepLineEndings(existing, lines.join('\n')));
  const notes = [
    ...(ownInit ? ['your own Starship init line stays'] : []),
    ...(otherInit
      ? [
          shellId === 'fish' && fs.existsSync(fishInitFile(rcPath))
            ? 'your conf.d/starship.fish init stays'
            : 'the Starship init in a file it sources stays',
        ]
      : []),
    ...(kept.length > 0 ? ['kept the PATH line it needs'] : []),
  ];
  return {
    removed: true,
    ...(notes.length > 0 ? { note: notes.join('; ') } : {}),
  };
}

/** Deletes a shell's per-shell config, keeping its original first when it was not generated. */
export function removeShellConfigFile(shellId: ShellId): RemovalResult {
  const configPath = getShellConfigPath(shellId);
  if (!fs.existsSync(configPath)) return { removed: false, note: `${configPath} does not exist` };
  const note = keepOriginal(configPath, { toolOwned: true });
  fs.rmSync(configPath);
  return { removed: true, ...(note ? { note } : {}) };
}
