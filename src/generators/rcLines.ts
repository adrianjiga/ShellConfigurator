import { getShell, posixShellQuote, rcQuote, type ShellDef } from '../config/shells.ts';
import { expandShellPath, scriptInstallBinDir } from '../services/paths.ts';
import type { ShellId } from '../types.ts';
import { ADOPT_MARKER, BLOCK_MARKER } from './markers.ts';

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
export function initLineIndex(lines: string[], shellId: ShellId): number {
  const command = INIT_COMMAND[shellId];
  return lines.findIndex((line) => !line.trimStart().startsWith('#') && line.includes(command));
}

export function exportsConfigPath(shell: ShellDef, line: string, configPath: string): boolean {
  const prefix = shell.configEnv?.exportPrefix;
  const t = line.trim();
  if (!prefix || !t.startsWith(prefix)) return false;
  const value = t.slice(prefix.length);
  return [
    rcQuote(shell.id, configPath),
    posixShellQuote(configPath),
    `"${configPath}"`,
    configPath,
  ].includes(value);
}

export function isBlockMarkerLine(line: string): boolean {
  const t = line.trim();
  return t === BLOCK_MARKER || t === ADOPT_MARKER;
}

function ownPathLines(shell: ShellDef): string[] {
  if (!shell.pathLine) return [];
  const dir = scriptInstallBinDir();
  const legacy = shell.id === 'fish' ? `fish_add_path ${dir}` : `export PATH="${dir}:$PATH"`;
  return [shell.pathLine(dir), legacy];
}

const OTHER_HOME_PATH_LINE: Partial<Record<ShellId, RegExp>> = {
  bash: /^export PATH=(?:'\/[^']*\/\.local\/bin':"\$PATH"|"\/[^"$]*\/\.local\/bin:\$PATH")$/,
  zsh: /^export PATH=(?:'\/[^']*\/\.local\/bin':"\$PATH"|"\/[^"$]*\/\.local\/bin:\$PATH")$/,
  fish: /^fish_add_path (?:'\/[^']*\/\.local\/bin'|\/[^\s'"$]*\/\.local\/bin)$/,
};

function isPathLine(shell: ShellDef, line: string): boolean {
  const t = line.trim();
  return ownPathLines(shell).includes(t) || Boolean(OTHER_HOME_PATH_LINE[shell.id]?.test(t));
}

function isConfigLine(shell: ShellDef, line: string): boolean {
  const t = line.trim();
  const env = shell.configEnv;
  return Boolean(env && (t.startsWith(env.exportPrefix) || t === env.unsetLine));
}

/**
 * The lines a managed block may contain: anything else (a blank line, a user
 * line) ends the block.
 */
export function isManagedLine(shell: ShellDef, line: string): boolean {
  return line.trim() === shell.initLine || isPathLine(shell, line) || isConfigLine(shell, line);
}

function managedBlockEnd(lines: string[], start: number, shell: ShellDef): number {
  let configLines = 0;
  let j = start + 1;
  while (j < lines.length && !isBlockMarkerLine(lines[j]) && isManagedLine(shell, lines[j])) {
    if (isConfigLine(shell, lines[j]) && ++configLines > 1) break;
    j++;
    if (lines[j - 1].trim() === shell.initLine) break;
  }
  return j;
}

/** Matches a managed line by its trimmed text, so CRLF files and stray spaces still match. */
export type LineNeedle = string | ((trimmed: string) => boolean);

export function lineMatches(line: string, needle: LineNeedle): boolean {
  const t = line.trim();
  return typeof needle === 'string' ? t === needle.trim() : needle(t);
}

/** Any per-shell STARSHIP_CONFIG export, whatever path an earlier run wrote. */
export function isConfigExport(shell: ShellDef): LineNeedle {
  const prefix = shell.configEnv?.exportPrefix;
  return (t) => prefix !== undefined && t.startsWith(prefix);
}

/**
 * Drops every "Added by ShellConfigurator" block containing any needle, so a
 * re-run can repair an rc polluted by the opposite block from an earlier run.
 */
export function removeShellConfiguratorBlocks(
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
      const j = managedBlockEnd(lines, i, shell);
      const block = lines.slice(i, j);
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

/** True when a non-comment line of `content` is exactly `line`. */
export function hasLine(content: string, line: string): boolean {
  return content.split('\n').some((l) => l.trim() === line);
}

/** `content` in CRLF when `existing` uses CRLF on every line. */
export function keepLineEndings(existing: string, content: string): string {
  const crlfOnly = existing.includes('\r\n') && !existing.replace(/\r\n/g, '').includes('\n');
  return crlfOnly ? content.replace(/\r?\n/g, '\r\n') : content;
}

/** Appends a managed block at the end, after a blank line unless the file is empty. */
export function appendManagedBlock(content: string, marker: string, lines: string[]): string {
  return `${content === '' ? '' : `${content}\n`}${marker}\n${lines.join('\n')}\n`;
}

/**
 * STARSHIP_CONFIG unset for a shell that should use the shared config: clears a
 * leaked export from a configured parent shell. Null for shells without an rc file.
 */
export function starshipUnsetLine(shellId: ShellId): string | null {
  return getShell(shellId)?.configEnv?.unsetLine ?? null;
}

/** True when the line sets STARSHIP_CONFIG, in any form a user or an earlier run wrote. */
export function setsStarshipConfig(shell: ShellDef, line: string, exportedOnly = false): boolean {
  const t = line.trim();
  if (t.startsWith('#')) return false;
  if (shell.id === 'fish') return fishExportsStarshipConfig(t);
  const exported = /^(?:export|(?:typeset|declare)\s+-\w*x\w*)\s+STARSHIP_CONFIG=/.test(t);
  return exported || (!exportedOnly && /^STARSHIP_CONFIG=/.test(t));
}

export function lastStarshipConfigLine(
  shell: ShellDef,
  content: string,
  exportedOnly = false
): string | undefined {
  return content
    .split('\n')
    .filter((line) => setsStarshipConfig(shell, line, exportedOnly))
    .at(-1);
}

function starshipConfigValue(shell: ShellDef, line: string): string {
  const t = line.trim();
  const raw =
    shell.id === 'fish'
      ? t.replace(/^set(\s+-\S+)*\s+STARSHIP_CONFIG\s*/, '')
      : t.slice(t.indexOf('=') + 1);
  const value = raw.trim();
  const quoted = /^(["'])(.*?)\1/.exec(value);
  return quoted ? quoted[2] : (/^[^\s;&|]*/.exec(value)?.[0] ?? '');
}

export function rcStarshipConfig(shellId: ShellId, content: string): string | null {
  const shell = getShell(shellId);
  const setting = shell && lastStarshipConfigLine(shell, content);
  return setting ? starshipConfigValue(shell, setting) : null;
}

/** The config path the rc's last exported STARSHIP_CONFIG line hands Starship, expanded. */
export function rcExportedConfigPath(shellId: ShellId, content: string): string | null {
  const shell = getShell(shellId);
  const setting = shell && lastStarshipConfigLine(shell, content, true);
  const value = setting ? starshipConfigValue(shell, setting) : '';
  return value ? (expandShellPath(value) ?? value) : null;
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

export const EVERY_BLOCK: LineNeedle = () => true;
