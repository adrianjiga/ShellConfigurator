import * as fs from 'node:fs';
import * as path from 'node:path';
import { getShell, type ShellDef } from '../config/shells.ts';
import { expandShellPath } from '../services/paths.ts';
import type { ShellId } from '../types.ts';
import { getShellConfigPath } from './configPaths.ts';
import {
  EVERY_BLOCK,
  exportsConfigPath,
  hasStarshipInit,
  lastStarshipConfigLine,
  rcExportedConfigPath,
  removeShellConfiguratorBlocks,
} from './rcLines.ts';

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

const MAX_SOURCE_DEPTH = 3;

/** The files a shell script sources (`source f`, `. f`), expanded; ones it cannot resolve are left out. */
export function sourcedFiles(content: string, env: NodeJS.ProcessEnv = process.env): string[] {
  return content.split('\n').flatMap((line) => {
    if (line.trimStart().startsWith('#')) return [];
    return [
      ...line.matchAll(/(?:^|[;&|]|\s)\s*(?:source|\.)\s+("[^"]*"|'[^']*'|[^\s;&|]+)/g),
    ].flatMap((match) => expandShellPath(match[1], env) ?? []);
  });
}

export function reachableSome(
  content: string,
  test: (text: string) => boolean,
  io: RcIo,
  env: NodeJS.ProcessEnv,
  depth = 0,
  seen: Set<string> = new Set()
): boolean {
  if (test(content)) return true;
  if (depth >= MAX_SOURCE_DEPTH) return false;
  return sourcedFiles(content, env).some((file) => {
    if (seen.has(file)) return false;
    seen.add(file);
    try {
      return io.exists(file) && reachableSome(io.readFile(file), test, io, env, depth + 1, seen);
    } catch {
      return false;
    }
  });
}

export function initReachable(
  content: string,
  shellId: ShellId,
  io: RcIo = FS_RC_IO,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return reachableSome(content, (text) => hasStarshipInit(text, shellId), io, env);
}

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
      if (initReachable(io.readFile(shell.rcFile), shellId, io)) return true;
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

/**
 * Whether the shell still has its own working setup from an earlier run: its rc
 * exports STARSHIP_CONFIG to its per-shell config, and that file exists. Such a
 * shell already overrides a STARSHIP_CONFIG leaked from a parent shell.
 */
export function keepsOwnConfig(shellId: ShellId, io: RcIo = FS_RC_IO): boolean {
  const shell = getShell(shellId);
  if (!shell?.rcFile || !shell.configEnv) return false;
  const configPath = getShellConfigPath(shellId);
  try {
    if (!io.exists(shell.rcFile)) return false;
    const content = io.readFile(shell.rcFile);
    const setting = lastStarshipConfigLine(shell, content, true);
    return (
      setting !== undefined &&
      (exportsConfigPath(shell, setting, configPath) ||
        rcExportedConfigPath(shellId, content) === configPath) &&
      io.exists(configPath)
    );
  } catch {
    return false;
  }
}

export function manualSetupApplied(shell: ShellDef, pointAtSharedConfig = false): boolean {
  return manualSetupAppliedWith(shell, FS_RC_IO, pointAtSharedConfig);
}

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
    return initReachable(kept, shellId, io);
  } catch {
    return false;
  }
}
