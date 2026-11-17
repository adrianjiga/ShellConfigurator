import * as path from 'node:path';
import { getShell, rcQuote, type ShellDef } from '../config/shells.ts';
import { homeDir } from '../services/paths.ts';
import type { ShellId } from '../types.ts';
import { bashLoginFiles } from './bashLogin.ts';
import { getShellConfigPath } from './configPaths.ts';
import {
  FS_RC_IO,
  fishInitFile,
  initReachable,
  type RcIo,
  reachableSome,
  sourcedFiles,
} from './rcInit.ts';
import {
  ADOPT_MARKER,
  appendManagedBlock,
  BLOCK_MARKER,
  EVERY_BLOCK,
  hasLine,
  hasStarshipInit,
  initLineIndex,
  isBlockMarkerLine,
  isConfigExport,
  isManagedLine,
  keepLineEndings,
  type LineNeedle,
  lineMatches,
  removeShellConfiguratorBlocks,
  setsStarshipConfig,
  starshipUnsetLine,
} from './rcLines.ts';

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
  return `${env.exportPrefix}${rcQuote(shellId, getShellConfigPath(shellId))}`;
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
export function sourcedInitIndex(lines: string[], shell: ShellDef, io: RcIo): number {
  return lines.findIndex(
    (line) =>
      !line.trimStart().startsWith('#') &&
      sourcedFiles(line).some((file) => {
        try {
          return io.exists(file) && initReachable(io.readFile(file), shell.id, io);
        } catch {
          return false;
        }
      })
  );
}

function insertBeforeInit(
  content: string,
  shell: ShellDef,
  marker: string,
  lines: string[],
  io: RcIo = FS_RC_IO
): string | null {
  const all = content.split('\n');
  const own = initLineIndex(all, shell.id);
  const index = own === -1 ? sourcedInitIndex(all, shell, io) : own;
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
    initReachable(cleaned, shell.id, io) ||
    (shell.id === 'fish' && io.exists(fishInitFile(rcPath)));

  const added = buildAdditionLines(shell, cleaned, options.ensurePathDir, configLine, initPresent);
  const carried = [...new Set(carriedPathLines)].filter(
    (line) => line !== added.pathLine && !hasLine(cleaned, line)
  );
  const lines = [...carried, ...added.lines];
  const { pathLine } = added;
  if (lines.length === 0) {
    return cleaned === existing
      ? { content: cleaned, applied: false, note: 'already configured' }
      : { content: cleaned, applied: true, note: 'removed a stale ShellConfigurator block' };
  }

  const marker = options.pointAtSharedConfig ? ADOPT_MARKER : BLOCK_MARKER;
  const inserted = initPresent ? insertBeforeInit(cleaned, shell, marker, lines, io) : null;
  return {
    content: keepLineEndings(existing, inserted ?? appendManagedBlock(cleaned, marker, lines)),
    applied: true,
    note: pathLine ? `${options.ensurePathDir} added to PATH` : undefined,
  };
}

function startupFiles(shell: ShellDef): string[] {
  const home = homeDir();
  if (shell.id === 'zsh' && shell.rcFile) {
    const dir = path.dirname(shell.rcFile);
    return [
      ...new Set([
        path.join(home, '.zshenv'),
        path.join(dir, '.zshenv'),
        path.join(dir, '.zprofile'),
      ]),
    ];
  }
  if (shell.id === 'bash') return bashLoginFiles();
  return [];
}

function setsOwnStarshipConfig(
  shell: ShellDef,
  rcContent: string,
  io: RcIo,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const sets = (text: string) =>
    removeShellConfiguratorBlocks(text, shell, [EVERY_BLOCK])
      .split('\n')
      .some((line) => setsStarshipConfig(shell, line));
  const skipRc = () => new Set(shell.rcFile ? [shell.rcFile] : []);
  if (reachableSome(rcContent, sets, io, env, 0, skipRc())) return true;
  return startupFiles(shell).some((file) => {
    try {
      return io.exists(file) && reachableSome(io.readFile(file), sets, io, env, 1, skipRc());
    } catch {
      return false;
    }
  });
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
  const ownExport = setsOwnStarshipConfig(shell, content, io);
  // A stale unset guard after the shell's own export would cancel it.
  if (ownExport && hasLine(content, unsetLine)) {
    content = removeShellConfiguratorBlocks(content, shell, [unsetLine], carried);
  }

  const initPresent =
    initReachable(content, shellId, io) || (shell.id === 'fish' && io.exists(fishInitFile(rcPath)));
  const needsInit = !initPresent && hasStarshipInit(existing, shellId);
  const lines = [
    ...[...new Set(carried)].filter((line) => !hasLine(content, line)),
    ...(!ownExport && !hasLine(content, unsetLine) ? [unsetLine] : []),
  ];
  const note = ownExport ? 'sets its own STARSHIP_CONFIG' : undefined;

  if (lines.length === 0 && !needsInit) {
    return content === existing
      ? { content, applied: false, note: note ?? 'already configured' }
      : { content, applied: true, note: note ?? 'removed a stale ShellConfigurator block' };
  }

  const inserted = initPresent ? insertBeforeInit(content, shell, BLOCK_MARKER, lines, io) : null;
  return {
    content: keepLineEndings(
      existing,
      inserted ??
        appendManagedBlock(content, BLOCK_MARKER, needsInit ? [...lines, shell.initLine] : lines)
    ),
    applied: true,
    ...(note ? { note } : {}),
  };
}
