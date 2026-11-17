import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TerminalId } from '../../types.ts';
import { cachedStarshipVersion } from '../cache.ts';
import {
  detectContainerAsync,
  detectCurrentShellAsync,
  detectInstalledShellsAsync,
  detectTerminalAsync,
  isStarshipInstalledAsync,
} from '../detector.ts';
import { escapeRegExp } from '../escapeRegExp.ts';
import { runCapture } from '../exec.ts';
import { lastRunShells } from '../history.ts';
import {
  getMissingStarshipPathDir,
  getNerdFontsDir,
  NERD_FONTS,
  readStarshipVersion,
  verifyStarshipConfig,
} from '../installer.ts';
import { readTerminalFontFamily } from '../terminalFont.ts';
import type { DoctorDeps } from './types.ts';

export const DEFAULT_DOCTOR_DEPS: DoctorDeps = {
  isStarshipInstalled: isStarshipInstalledAsync,
  getMissingStarshipPathDir,
  readStarshipVersion,
  detectCurrentShell: detectCurrentShellAsync,
  readCachedStarshipVersion: () => {
    try {
      return cachedStarshipVersion();
    } catch {
      return null;
    }
  },
  detectInstalledShells: detectInstalledShellsAsync,
  lastRunShells,
  detectTerminal: detectTerminalAsync,
  readFontFamily: readTerminalFontFamily,
  hasBundledNerdFonts: hasBundledNerdFonts,
  verifyConfig: (configPath) => verifyStarshipConfig(configPath),
  readFile: (path) => fs.readFileSync(path, 'utf8'),
  exists: (path) => fs.existsSync(path),
  hasNerdFonts: (fontId) => fontDirs().some((dir) => hasNerdFontFiles(dir, nerdFontFile(fontId))),
  isContainer: detectContainerAsync,
  env: process.env,
};

/** Ghostty always ships the symbols; kitty gained them in 0.36. */
async function hasBundledNerdFonts(terminalId: TerminalId): Promise<boolean> {
  if (terminalId === 'ghostty') return true;
  if (terminalId !== 'kitty') return false;
  try {
    const output = await runCapture('kitty', ['--version']);
    const match = /(\d+)\.(\d+)/.exec(output);
    if (!match) return false;
    return Number(match[1]) > 0 || Number(match[2]) >= 36;
  } catch {
    return false;
  }
}

const NERD_FONT_FILE = /nerd ?font.*\.(ttf|otf)$/i;

function fontDirs(): string[] {
  return process.platform === 'darwin'
    ? [getNerdFontsDir(), '/Library/Fonts']
    : [getNerdFontsDir(), '/usr/share/fonts', '/usr/local/share/fonts'];
}

function nerdFontFile(fontId?: string | null): RegExp {
  const family = NERD_FONTS.find((font) => font.id === fontId)?.family;
  if (!family) return NERD_FONT_FILE;
  const name = escapeRegExp(family.replace(/\s*Nerd Font$/, '').replace(/\s+/g, ''));
  return new RegExp(`^${name}.*NerdFont.*\\.(ttf|otf)$`, 'i');
}

function hasNerdFontFiles(dir: string, pattern: RegExp, depth = 3): boolean {
  let entries: Array<fs.Dirent | string>;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  return entries.some((entry) => {
    const name = typeof entry === 'string' ? entry : entry.name;
    if (typeof entry !== 'string' && entry.isDirectory()) {
      return depth > 0 && hasNerdFontFiles(path.join(dir, name), pattern, depth - 1);
    }
    return pattern.test(name.replace(/\s+/g, ''));
  });
}
