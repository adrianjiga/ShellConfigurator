import * as fs from 'node:fs';
import * as os from 'node:os';
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

interface TomlSection {
  /** The table name, or null for the keys before the first header. */
  name: string | null;
  /** Offsets of the section's body, after its header line. */
  start: number;
  end: number;
}

const TOML_HEADER = /^[ \t]*\[([^[\]\n]+)\][ \t]*(?:#.*)?$/gm;

/** Splits a TOML file into its top-level keys and `[table]` sections. */
function tomlSections(content: string): TomlSection[] {
  const sections: TomlSection[] = [];
  let current: TomlSection = { name: null, start: 0, end: content.length };
  for (const match of content.matchAll(TOML_HEADER)) {
    current.end = match.index;
    sections.push(current);
    const lineEnd = match.index + match[0].length;
    current = {
      name: match[1]!.trim(),
      start: Math.min(lineEnd + 1, content.length),
      end: content.length,
    };
  }
  sections.push(current);
  return sections;
}

/** Rewrites the first `pattern` match inside one section; null when it does not match. */
function editSection(
  content: string,
  section: TomlSection | undefined,
  pattern: RegExp,
  replacer: (...groups: string[]) => string
): string | null {
  if (!section) return null;
  const body = content.slice(section.start, section.end);
  if (!pattern.test(body)) return null;
  const edited = body.replace(pattern, (...args: string[]) => replacer(...args));
  return content.slice(0, section.start) + edited + content.slice(section.end);
}

/**
 * Sets `family` in Alacritty's `[font.normal]` table. Only the font tables are
 * edited: the inline `normal = { … }` under `[font]` (or `font.normal = { … }`
 * at the top), dotted `normal.family`/`font.normal.family` keys, and the
 * `[font.normal]` table itself; a missing table is appended, never duplicated.
 */
function setTomlFont(content: string, family: string): string {
  const line = `family = "${family}"`;
  const sections = tomlSections(content);
  const top = sections.find((s) => s.name === null);
  const font = sections.find((s) => s.name === 'font');
  const fontNormal = sections.find((s) => s.name === 'font.normal');

  const inlineBody = (inner: string) =>
    /family\s*=/.test(inner)
      ? inner.replace(/family\s*=\s*"[^"]*"/, line)
      : inner.trim() === ''
        ? ` ${line} `
        : ` ${line},${inner}`;
  const inline = (key: string) =>
    new RegExp(`^([ \\t]*${key}\\s*=\\s*)\\{([^}]*)\\}([ \\t]*(?:#.*)?)$`, 'm');
  const dotted = (key: string) =>
    new RegExp(`^([ \\t]*${key})[ \\t]*=[ \\t]*"[^"]*"[ \\t]*(?:#.*)?$`, 'm');

  const edited =
    editSection(content, font, inline('normal'), (_m, head, inner, tail) => {
      return `${head}{${inlineBody(inner)}}${tail}`;
    }) ??
    editSection(content, top, inline('font\\.normal'), (_m, head, inner, tail) => {
      return `${head}{${inlineBody(inner)}}${tail}`;
    }) ??
    editSection(content, font, dotted('normal\\.family'), (_m, key) => `${key} = "${family}"`) ??
    editSection(content, top, dotted('font\\.normal\\.family'), (_m, key) => {
      return `${key} = "${family}"`;
    });
  if (edited !== null) return edited;

  if (!fontNormal) return appendBlock(content, `[font.normal]\n${line}`);

  const body = content.slice(fontNormal.start, fontNormal.end);
  const newBody = /^\s*family\s*=/m.test(body)
    ? body.replace(/^\s*family\s*=.*$/m, line)
    : `${line}\n${body}`;
  return content.slice(0, fontNormal.start) + newBody + content.slice(fontNormal.end);
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

// kitty and alacritty look in more places than the XDG default; editing a new
// file in the primary location would shadow the user's real config there.
function configLookupPaths(id: TerminalId): string[] {
  if (id === 'kitty') {
    const paths: string[] = [];
    const kittyDir = process.env.KITTY_CONFIG_DIRECTORY;
    if (kittyDir) paths.push(path.join(kittyDir, 'kitty.conf'));
    paths.push(path.join(configHome(), 'kitty', 'kitty.conf'));
    if (process.platform === 'darwin') {
      paths.push(path.join(os.homedir(), 'Library', 'Preferences', 'kitty', 'kitty.conf'));
    }
    return paths;
  }
  if (id === 'alacritty') {
    const root = configHome();
    return [
      alacrittyTomlPath(),
      alacrittyYmlPath(),
      path.join(root, 'alacritty.toml'),
      path.join(root, 'alacritty.yml'),
      path.join(os.homedir(), '.alacritty.toml'),
      path.join(os.homedir(), '.alacritty.yml'),
    ];
  }
  return [terminalConfigPath(id)];
}

function resolveTerminalConfigPath(id: TerminalId): string {
  return configLookupPaths(id).find((p) => fs.existsSync(p)) ?? terminalConfigPath(id);
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

  const filePath = resolveTerminalConfigPath(id);
  if (id === 'alacritty' && filePath.endsWith('.yml')) {
    return {
      applied: false,
      path: filePath,
      note: `alacritty.yml is in use — add font.family: "${family}" under font: in ${filePath}`,
    };
  }

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

  const filePath = resolveTerminalConfigPath(id);
  if (!fs.existsSync(filePath)) return null;

  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
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
