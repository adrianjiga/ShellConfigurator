import { execFileSync } from 'node:child_process';
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

function appendLine(content: string, line: string): string {
  const base = content.trim() === '' ? '' : content.replace(/\n*$/, '\n');
  return `${base}${line}\n`;
}

/**
 * Sets ghostty's primary font: the first font-family after the last
 * `font-family = ""` reset. The rest of the list stays as fallbacks.
 */
function setGhosttyFont(content: string, family: string): string {
  let primary: RegExpMatchArray | null = null;
  for (const match of content.matchAll(/^[ \t]*font-family[ \t]*=(.*)$/gm)) {
    const value = unquote(match[1] ?? '');
    if (value === '') primary = null;
    else if (primary === null) primary = match;
  }
  if (!primary) return appendLine(content, `font-family = ${family}`);
  if (unquote(primary[1] ?? '') === family) return content;
  const start = primary.index ?? 0;
  return `${content.slice(0, start)}font-family = ${family}${content.slice(start + primary[0].length)}`;
}

/** Replaces the last line matching `pattern` (a global, multiline regex), or appends `line`. */
function setLastLine(content: string, pattern: RegExp, line: string): string {
  const last = [...content.matchAll(pattern)].at(-1);
  if (!last) return appendLine(content, line);
  return content.slice(0, last.index) + line + content.slice(last.index + last[0].length);
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
      ? inner.replace(/family\s*=\s*(?:"[^"]*"|'[^']*')/, line)
      : inner.trim() === ''
        ? ` ${line} `
        : ` ${line},${inner}`;
  const inline = (key: string) =>
    new RegExp(`^([ \\t]*${key}\\s*=\\s*)\\{([^}]*)\\}([ \\t]*(?:#.*)?)$`, 'm');
  const dotted = (key: string) =>
    new RegExp(`^([ \\t]*${key})[ \\t]*=[ \\t]*(?:"[^"]*"|'[^']*')[ \\t]*(?:#.*)?$`, 'm');

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

  const head = content.slice(0, fontNormal.start);
  const separator = head.endsWith('\n') ? '' : '\n';
  const body = content.slice(fontNormal.start, fontNormal.end);
  const newBody = /^[ \t]*family[ \t]*=/m.test(body)
    ? body.replace(/^([ \t]*)family[ \t]*=.*$/m, (_m, indent: string) => `${indent}${line}`)
    : `${line}\n${body}`;
  return head + separator + newBody + content.slice(fontNormal.end);
}

/**
 * Sets the primary `font=` under foot's `[main]` (or the keys before any
 * header, which foot also reads as `[main]`). The first entry's `:size=`
 * options and any comma-separated fallbacks are kept.
 */
function setFootFont(content: string, family: string): string {
  const sections = tomlSections(content);
  const main = sections.find((s) => s.name === 'main');
  const top = sections.find((s) => s.name === null);
  const keyRe = /^([ \t]*)font[ \t]*=[ \t]*(.*)$/m;
  const replace = (_m: string, indent: string, value: string) => {
    const [primary = '', ...fallbacks] = value.split(',');
    const options = primary.includes(':') ? primary.slice(primary.indexOf(':')) : '';
    return `${indent}font=${[`${family}${options}`, ...fallbacks].join(',')}`;
  };

  const edited =
    editSection(content, top, keyRe, replace) ?? editSection(content, main, keyRe, replace);
  if (edited !== null) return edited;
  if (!main) return appendBlock(content, `[main]\nfont=${family}`);

  const head = content.slice(0, main.start);
  const separator = head.endsWith('\n') ? '' : '\n';
  return `${head}${separator}font=${family}\n${content.slice(main.start)}`;
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

// kitty, alacritty and ghostty look in more places than the XDG default; editing a new
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
  if (id === 'ghostty') {
    const dirs = [path.join(configHome(), 'ghostty')];
    if (process.platform === 'darwin') {
      dirs.push(path.join(os.homedir(), 'Library', 'Application Support', 'com.mitchellh.ghostty'));
    }
    return dirs.flatMap((dir) => [path.join(dir, 'config.ghostty'), path.join(dir, 'config')]);
  }
  return [terminalConfigPath(id)];
}

/** The Lua file WezTerm loads, defaulting to its recommended ~/.wezterm.lua. */
function weztermConfigPath(): string {
  const candidates = [
    process.env.WEZTERM_CONFIG_FILE?.trim(),
    terminalConfigPath('wezterm'),
    path.join(os.homedir(), '.wezterm.lua'),
  ].filter((p): p is string => Boolean(p));
  return candidates.find((p) => fs.existsSync(p)) ?? path.join(os.homedir(), '.wezterm.lua');
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
/** `alacritty --version` as [major, minor], or null when it cannot be run. */
export function installedAlacrittyVersion(): [number, number] | null {
  try {
    const output = execFileSync('alacritty', ['--version'], {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 5000,
    });
    const match = /(\d+)\.(\d+)/.exec(output);
    return match ? [Number(match[1]), Number(match[2])] : null;
  } catch {
    return null;
  }
}

export interface WireTerminalFontOptions {
  alacrittyVersion?: () => [number, number] | null;
}

export function wireTerminalFont(
  id: TerminalId,
  family: string,
  options: WireTerminalFontOptions = {}
): TerminalFontResult {
  if (id === 'wezterm') {
    const configPath = weztermConfigPath();
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
      note:
        `${filePath} is YAML, which Alacritty 0.13+ ignores: run \`alacritty migrate\` and ` +
        `re-run, or on an older Alacritty set font.normal.family to "${family}" there`,
    };
  }

  // Alacritty before 0.13 reads only YAML, so a new alacritty.toml would be ignored.
  if (id === 'alacritty' && !fs.existsSync(filePath)) {
    const version = (options.alacrittyVersion ?? installedAlacrittyVersion)();
    if (version && version[0] === 0 && version[1] < 13) {
      return {
        applied: false,
        path: alacrittyYmlPath(),
        note:
          `Alacritty ${version.join('.')} reads only YAML — add font.normal.family: ` +
          `"${family}" to ${alacrittyYmlPath()}`,
      };
    }
  }

  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';

  let updated: string;
  switch (id) {
    case 'alacritty':
      updated = setTomlFont(existing, family);
      break;
    case 'kitty':
      updated = setLastLine(existing, /^[ \t]*font_family[ \t]+.*$/gm, `font_family ${family}`);
      break;
    case 'ghostty':
      updated = setGhosttyFont(existing, family);
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
  // A read-only config (e.g. a Nix-managed link) would fail the write below;
  // checking first keeps it from collecting a backup on every run.
  if (fs.existsSync(filePath)) fs.accessSync(filePath, fs.constants.W_OK);
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
  switch (id) {
    case 'alacritty':
      return filePath.endsWith('.yml') ? readYamlFamily(content) : readTomlFamily(content);
    case 'kitty':
      return readKittyFamily(content);
    case 'ghostty':
      return readGhosttyFamily(content);
    case 'foot':
      return readFootFamily(content);
  }
}

function unquote(value: string): string {
  return value
    .trim()
    .replace(/^(["'])(.*)\1$/, '$2')
    .trim();
}

function readYamlFamily(content: string): string | null {
  const match = content.match(/^\s*family:\s*"?([^"\n]+)"?/m);
  return match?.[1]?.trim() || null;
}

/** The family in alacritty's normal font, in any of the shapes the writer edits. */
function readTomlFamily(content: string): string | null {
  const sections = tomlSections(content);
  const body = (name: string | null) => {
    const section = sections.find((s) => s.name === name);
    return section ? content.slice(section.start, section.end) : '';
  };
  const value = '("[^"]*"|\'[^\']*\')';
  const patterns: Array<[string | null, RegExp]> = [
    ['font.normal', new RegExp(`^[ \\t]*family[ \\t]*=[ \\t]*${value}`, 'm')],
    ['font', new RegExp(`^[ \\t]*normal\\.family[ \\t]*=[ \\t]*${value}`, 'm')],
    ['font', new RegExp(`^[ \\t]*normal\\s*=\\s*\\{[^}]*family\\s*=\\s*${value}`, 'm')],
    [null, new RegExp(`^[ \\t]*font\\.normal\\.family[ \\t]*=[ \\t]*${value}`, 'm')],
    [null, new RegExp(`^[ \\t]*font\\.normal\\s*=\\s*\\{[^}]*family\\s*=\\s*${value}`, 'm')],
  ];
  for (const [section, pattern] of patterns) {
    const match = body(section).match(pattern);
    if (match?.[1]) return unquote(match[1]) || null;
  }
  return null;
}

/** kitty applies the last font_family line; `family="X"` is its newer spelling. */
function readKittyFamily(content: string): string | null {
  const lines = [...content.matchAll(/^[ \t]*font_family[ \t]+(.+)$/gm)];
  const value = lines.at(-1)?.[1]?.trim();
  if (!value) return null;
  const named = value.match(/(?:^|\s)family=("[^"]*"|'[^']*'|\S+)/);
  return (named ? unquote(named[1]!) : value) || null;
}

/** Ghostty builds a fallback list from font-family lines; an empty value resets it. */
function readGhosttyFamily(content: string): string | null {
  let primary: string | null = null;
  for (const match of content.matchAll(/^[ \t]*font-family[ \t]*=(.*)$/gm)) {
    const value = unquote(match[1] ?? '');
    if (value === '') primary = null;
    else if (primary === null) primary = value;
  }
  return primary;
}

/** foot's [main] font, as its comma-separated families without size options. */
function readFootFamily(content: string): string | null {
  const sections = tomlSections(content);
  for (const name of [null, 'main']) {
    const section = sections.find((s) => s.name === name);
    if (!section) continue;
    const match = content.slice(section.start, section.end).match(/^[ \t]*font[ \t]*=(.*)$/m);
    if (!match) continue;
    const families = (match[1] ?? '')
      .split(',')
      .map((entry) => entry.split(':')[0]!.trim())
      .filter(Boolean);
    return families.length > 0 ? families.join(', ') : null;
  }
  return null;
}
