import * as fs from 'node:fs';
import * as path from 'node:path';
import { backupStamp } from '../generators/shellRc.ts';
import { assertNever, type TerminalId } from '../types.ts';
import { configHome } from './paths.ts';

/** Human-readable terminal name, for task labels and notes. */
export const TERMINAL_LABELS: Record<TerminalId, string> = {
  alacritty: 'Alacritty',
  kitty: 'kitty',
  wezterm: 'WezTerm',
  ghostty: 'Ghostty',
  foot: 'foot',
};

export function terminalLabel(id: TerminalId): string {
  return TERMINAL_LABELS[id];
}

export interface TerminalFontResult {
  applied: boolean;
  path?: string;
  backedUpTo?: string;
  note?: string;
}

function appendBlock(content: string, block: string): string {
  if (content.trim() === '') return `${block}\n`;
  return `${content.replace(/\n*$/, '')}\n\n${block}\n`;
}

function setLine(content: string, pattern: RegExp, line: string): string {
  if (pattern.test(content)) return content.replace(pattern, line);
  const base = content.trim() === '' ? '' : content.replace(/\n*$/, '\n');
  return `${base}${line}\n`;
}

/**
 * Sets `family` in Alacritty's `[font.normal]` table. Alacritty accepts either a
 * nested table or an inline `normal = { … }`, and rejects an unknown `family`
 * key directly under `[font]`; each shape is updated in place, and a missing
 * table is appended.
 */
function setTomlFont(content: string, family: string): string {
  const line = `family = "${family}"`;

  const inlineRe = /^([ \t]*)normal\s*=\s*\{([^}]*)\}[ \t]*$/m;
  const inlineMatch = inlineRe.exec(content);
  if (inlineMatch) {
    const [, indent, inner] = inlineMatch;
    const body = /family\s*=/.test(inner)
      ? inner.replace(/family\s*=\s*"[^"]*"/, line)
      : inner.trim() === ''
        ? ` ${line} `
        : ` ${line},${inner}`;
    return content.replace(inlineRe, () => `${indent}normal = {${body}}`);
  }

  const headerMatch = /^\[font\.normal\]\s*$/m.exec(content);
  if (!headerMatch || headerMatch.index === undefined) {
    return appendBlock(content, `[font.normal]\n${line}`);
  }

  const headerEnd = content.indexOf('\n', headerMatch.index);
  if (headerEnd === -1) return `${content}${line}\n`;

  const rest = content.slice(headerEnd + 1);
  const nextRel = rest.search(/^\[/m);
  const body = nextRel === -1 ? rest : rest.slice(0, nextRel);
  const tail = nextRel === -1 ? '' : rest.slice(nextRel);
  const newBody = /^\s*family\s*=/m.test(body)
    ? body.replace(/^\s*family\s*=.*$/m, line)
    : `${line}\n${body}`;
  return content.slice(0, headerEnd + 1) + newBody + tail;
}

/** Sets `font=` under `[main]`, preserving any `:size=` suffix already there. */
function setFootFont(content: string, family: string): string {
  const keyRe = /^(\s*)font\s*=\s*(.*)$/m;
  const match = keyRe.exec(content);
  if (match) {
    const size = match[2].includes(':') ? match[2].slice(match[2].indexOf(':')) : '';
    return content.replace(keyRe, `${match[1]}font=${family}${size}`);
  }

  const headerRe = /^\[main\]\s*$/m;
  if (!headerRe.test(content)) return appendBlock(content, `[main]\nfont=${family}`);

  const headerEnd = content.indexOf('\n', content.search(headerRe));
  if (headerEnd === -1) return `${content}font=${family}\n`;
  return `${content.slice(0, headerEnd + 1)}font=${family}\n${content.slice(headerEnd + 1)}`;
}

function alacrittyTomlPath(): string {
  return path.join(configHome(), 'alacritty', 'alacritty.toml');
}

function alacrittyYmlPath(): string {
  return path.join(configHome(), 'alacritty', 'alacritty.yml');
}

function terminalConfigPath(id: TerminalId): string {
  switch (id) {
    case 'alacritty':
      return alacrittyTomlPath();
    case 'kitty':
      return path.join(configHome(), 'kitty', 'kitty.conf');
    case 'ghostty':
      return path.join(configHome(), 'ghostty', 'config');
    case 'foot':
      return path.join(configHome(), 'foot', 'foot.ini');
    case 'wezterm':
      return path.join(configHome(), 'wezterm', 'wezterm.lua');
  }
}

function backupIfExists(filePath: string): string | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  const backup = `${filePath}.bak-${backupStamp()}`;
  fs.copyFileSync(filePath, backup);
  return backup;
}

/**
 * Points a detected terminal at the installed Nerd Font, editing its config
 * idempotently and backing up any existing file first. WezTerm's Lua config is
 * never edited — the exact line to add is returned as a note instead.
 */
export function wireTerminalFont(id: TerminalId, family: string): TerminalFontResult {
  if (id === 'wezterm') {
    const configPath = terminalConfigPath('wezterm');
    return {
      applied: false,
      path: configPath,
      note: `wezterm's config is Lua — add config.font = wezterm.font("${family}") to ${configPath}`,
    };
  }

  if (
    id === 'alacritty' &&
    !fs.existsSync(alacrittyTomlPath()) &&
    fs.existsSync(alacrittyYmlPath())
  ) {
    const yml = alacrittyYmlPath();
    return {
      applied: false,
      path: yml,
      note: `alacritty.yml is in use — add font.family: "${family}" under font: in ${yml}`,
    };
  }

  const filePath = terminalConfigPath(id);
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';

  let updated: string;
  switch (id) {
    case 'alacritty':
      updated = setTomlFont(existing, family);
      break;
    case 'kitty':
      updated = setLine(existing, /^font_family\s+.*$/m, `font_family ${family}`);
      break;
    case 'ghostty':
      updated = setLine(existing, /^font-family\s*=.*$/m, `font-family = ${family}`);
      break;
    case 'foot':
      updated = setFootFont(existing, family);
      break;
    default:
      return assertNever(id);
  }

  if (updated === existing) {
    return { applied: false, path: filePath, note: 'font already set' };
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const backedUpTo = backupIfExists(filePath);
  fs.writeFileSync(filePath, updated, 'utf8');
  return { applied: true, path: filePath, backedUpTo };
}

/** The font family a terminal is configured to use, or null when unset/unknown. */
export function readTerminalFontFamily(id: TerminalId): string | null {
  if (id === 'wezterm') return null;

  let filePath = terminalConfigPath(id);
  if (id === 'alacritty' && !fs.existsSync(filePath) && fs.existsSync(alacrittyYmlPath())) {
    filePath = alacrittyYmlPath();
  }
  if (!fs.existsSync(filePath)) return null;

  const content = fs.readFileSync(filePath, 'utf8');
  let match: RegExpMatchArray | null;
  switch (id) {
    case 'alacritty':
      match =
        content.match(/^\s*family:\s*"?([^"\n]+)"?/m) ??
        content.match(/^\s*family\s*=\s*"([^"]+)"/m);
      break;
    case 'kitty':
      match = content.match(/^font_family\s+(.+)$/m);
      break;
    case 'ghostty':
      match = content.match(/^font-family\s*=\s*"?([^"\n]+)"?$/m);
      break;
    case 'foot':
      match = content.match(/^\s*font\s*=\s*([^:\n]+)/m);
      break;
  }

  return match?.[1]?.trim() ?? null;
}
