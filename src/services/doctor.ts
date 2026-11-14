import * as fs from 'node:fs';
import * as path from 'node:path';
import { getShell } from '../config/shells.ts';
import { statusLine } from '../config/status.ts';
import {
  fishInitFile,
  getSharedConfigPath,
  getShellConfigPath,
  hasStarshipInit,
  manualSetupAppliedWith,
} from '../generators/shellRc.ts';
import { fontIdToInstall, type ShellId, type TerminalId, type WizardState } from '../types.ts';
import { cachedStarshipVersion } from './cache.ts';
import {
  detectContainerAsync,
  detectCurrentShellAsync,
  detectInstalledShellsAsync,
  detectTerminalAsync,
  isStarshipInstalledAsync,
} from './detector.ts';
import { errorMessage } from './errors.ts';
import { runCapture } from './exec.ts';
import {
  fontLabel,
  getFontFamily,
  getMissingStarshipPathDir,
  getNerdFontsDir,
  readStarshipVersion,
  verifyStarshipConfig,
} from './installer.ts';
import { readTerminalFontFamily, TERMINAL_LABELS } from './terminalFont.ts';

export type DoctorStatus = 'pass' | 'warn' | 'fail';

/** A repair the P2.4 `--fix` pass knows how to apply. */
export type DoctorFix =
  | { kind: 'reinstall-starship' }
  | { kind: 'configure-shell'; shellId: ShellId }
  | { kind: 'write-config'; shellId: ShellId }
  | { kind: 'reinstall-font'; fontId: string }
  | { kind: 'wire-font'; terminalId: TerminalId; family: string };

export interface DoctorFinding {
  id: string;
  title: string;
  status: DoctorStatus;
  detail: string;
  fix?: DoctorFix;
}

export interface DoctorReport {
  ok: boolean;
  findings: DoctorFinding[];
}

export interface DoctorDeps {
  isStarshipInstalled: typeof isStarshipInstalledAsync;
  /** The script-install bin dir when starship is there but not on PATH, or null. */
  getMissingStarshipPathDir: () => string | null;
  /** Runs `starship -V` with the script install dir on PATH. */
  readStarshipVersion: (pathDir: string) => Promise<string | null>;
  detectCurrentShell: typeof detectCurrentShellAsync;
  /** The starship version the last install/apply recorded, or null. */
  readCachedStarshipVersion: () => string | null;
  detectInstalledShells: typeof detectInstalledShellsAsync;
  detectTerminal: typeof detectTerminalAsync;
  readFontFamily: typeof readTerminalFontFamily;
  /** Terminals that render Nerd Font symbols without one installed. */
  hasBundledNerdFonts: (terminalId: TerminalId) => Promise<boolean>;
  verifyConfig: (configPath: string) => Promise<void>;
  readFile: (path: string) => string;
  exists: (path: string) => boolean;
  hasNerdFonts: () => boolean;
  isContainer: () => Promise<boolean>;
  env: NodeJS.ProcessEnv;
}

export const DEFAULT_DOCTOR_DEPS: DoctorDeps = {
  isStarshipInstalled: isStarshipInstalledAsync,
  getMissingStarshipPathDir,
  readStarshipVersion,
  detectCurrentShell: detectCurrentShellAsync,
  readCachedStarshipVersion: () => cachedStarshipVersion(),
  detectInstalledShells: detectInstalledShellsAsync,
  detectTerminal: detectTerminalAsync,
  readFontFamily: readTerminalFontFamily,
  hasBundledNerdFonts: hasBundledNerdFonts,
  verifyConfig: (configPath) => verifyStarshipConfig(configPath),
  readFile: (path) => fs.readFileSync(path, 'utf8'),
  exists: (path) => fs.existsSync(path),
  hasNerdFonts: () => fontDirs().some((dir) => hasNerdFontFiles(dir)),
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

const NERD_FONT_FILE = /nerd ?font/i;

function fontDirs(): string[] {
  return process.platform === 'darwin'
    ? [getNerdFontsDir(), '/Library/Fonts']
    : [getNerdFontsDir(), '/usr/share/fonts', '/usr/local/share/fonts'];
}

/** Any font file under `dir` whose name says Nerd Font, at any nesting depth. */
function hasNerdFontFiles(dir: string, depth = 3): boolean {
  let entries: Array<fs.Dirent | string>;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  return entries.some((entry) => {
    const name = typeof entry === 'string' ? entry : entry.name;
    if (typeof entry !== 'string' && entry.isDirectory()) {
      return depth > 0 && hasNerdFontFiles(path.join(dir, name), depth - 1);
    }
    return NERD_FONT_FILE.test(name);
  });
}

/**
 * Wiring mode inferred from the rc when no state card is given: our per-shell
 * STARSHIP_CONFIG export means per-shell, anything else shared.
 */
export function shellPointsAtShared(
  shellId: ShellId,
  deps: Pick<DoctorDeps, 'exists' | 'readFile'> = DEFAULT_DOCTOR_DEPS
): boolean {
  const rcFile = getShell(shellId)?.rcFile;
  if (!rcFile) return false;
  const content = readRc(rcFile, deps);
  return exportedConfigPath(content, shellId) === null;
}

/**
 * Reads the STARSHIP_CONFIG path an rc exports, whatever XDG_CONFIG_HOME was at
 * install time — so running the doctor under a different env is not a failure.
 */
function exportedConfigPath(content: string, shellId: ShellId): string | null {
  const match =
    shellId === 'fish'
      ? /set\s+-gx\s+STARSHIP_CONFIG\s+(?:"([^"]+)"|'([^']+)'|(\S+))/.exec(content)
      : /export\s+STARSHIP_CONFIG=(?:"([^"]+)"|'([^']+)'|(\S+))/.exec(content);
  if (!match) return null;
  return match.slice(1).find((value) => value !== undefined) ?? null;
}

function setsOwnConfig(content: string): boolean {
  return content.includes('STARSHIP_CONFIG=') || content.includes('set -gx STARSHIP_CONFIG ');
}

interface StarshipProbe {
  installed: boolean;
  version?: string;
  /** Where a script install put the binary, when PATH does not have it yet. */
  pathDir?: string;
}

async function probeStarship(deps: DoctorDeps): Promise<StarshipProbe> {
  const probe = await deps.isStarshipInstalled();
  if (probe.installed) return probe;
  const pathDir = deps.getMissingStarshipPathDir();
  if (!pathDir) return probe;
  const version = await deps.readStarshipVersion(pathDir);
  return version ? { installed: true, version, pathDir } : probe;
}

function checkStarship(probe: StarshipProbe, state: WizardState | null): DoctorFinding {
  if (probe.installed) {
    return {
      id: 'starship',
      title: 'Starship',
      status: 'pass',
      detail: probe.pathDir
        ? `${probe.version ?? 'installed'} (in ${probe.pathDir}, not on PATH until you restart)`
        : (probe.version ?? 'installed'),
    };
  }
  return {
    id: 'starship',
    title: 'Starship',
    status: 'fail',
    detail: 'starship is not on PATH',
    ...(state?.skipStarshipInstall ? {} : { fix: { kind: 'reinstall-starship' as const } }),
  };
}

/**
 * The version-drift check: does the installed starship match the version the
 * last install/apply recorded? A mismatch means a package-manager upgrade or
 * downgrade happened outside the tool — something the rc stamp cannot see.
 */
function checkVersionDrift(probe: StarshipProbe, deps: DoctorDeps): DoctorFinding {
  const cached = deps.readCachedStarshipVersion();
  if (!cached) {
    return {
      id: 'version-drift',
      title: 'Starship version',
      status: 'pass',
      detail: 'no prior install recorded to compare against',
    };
  }
  const { installed, version } = probe;
  if (!installed || !version) {
    return {
      id: 'version-drift',
      title: 'Starship version',
      status: 'warn',
      detail: `last run recorded ${cached}, but starship is not reachable now`,
    };
  }
  return version === cached
    ? { id: 'version-drift', title: 'Starship version', status: 'pass', detail: cached }
    : {
        id: 'version-drift',
        title: 'Starship version',
        status: 'warn',
        detail: `installed ${version}; the last install recorded ${cached}`,
      };
}

/**
 * The "chair in the wheel" check: does the shell this terminal is *running*
 * actually load the modified rc? Configuring bash while running zsh is a healthy
 * install that still shows the user nothing.
 */
async function checkRunningShell(shellIds: ShellId[], deps: DoctorDeps): Promise<DoctorFinding> {
  const current = await deps.detectCurrentShell();
  const shell = current ? getShell(current) : undefined;
  if (!current || !shell) {
    return {
      id: 'current-shell',
      title: 'Current shell',
      status: 'warn',
      detail: 'cannot identify the shell this terminal is running',
    };
  }
  if (!shellIds.includes(current)) {
    return {
      id: 'current-shell',
      title: 'Current shell',
      status: 'warn',
      detail:
        `${shell.label} is the running shell but is not configured — ` +
        `start ${shellIds.join(' or ') || 'a configured shell'} to see the new prompt`,
    };
  }
  const rcFile = shell.rcFile;
  if (!rcFile) {
    return manualSetupAppliedWith(shell, deps)
      ? {
          id: 'current-shell',
          title: 'Current shell',
          status: 'pass',
          detail: `${shell.label} has Starship set up (restart it to apply now)`,
        }
      : {
          id: 'current-shell',
          title: 'Current shell',
          status: 'warn',
          detail: `${shell.label} is configured, but its manual setup has not been applied yet`,
        };
  }
  const content = readRc(rcFile, deps);
  if (!shellHasInit(current, rcFile, content, deps)) {
    return {
      id: 'current-shell',
      title: 'Current shell',
      status: 'warn',
      detail: `${shell.label} is configured, but its rc does not init Starship yet`,
    };
  }
  return {
    id: 'current-shell',
    title: 'Current shell',
    status: 'pass',
    detail: `${shell.label} loads Starship — restart it to see the new prompt`,
  };
}

/** An rc file's text, or empty when it does not exist yet. */
function readRc(rcFile: string, deps: Pick<DoctorDeps, 'exists' | 'readFile'>): string {
  return deps.exists(rcFile) ? deps.readFile(rcFile) : '';
}

function shellHasInit(
  shellId: ShellId,
  rcFile: string,
  content: string,
  deps: Pick<DoctorDeps, 'exists'>
): boolean {
  if (hasStarshipInit(content, shellId)) return true;
  return shellId === 'fish' && deps.exists(fishInitFile(rcFile));
}

function checkLocale(deps: DoctorDeps): DoctorFinding {
  const value = deps.env.LC_ALL || deps.env.LC_CTYPE || deps.env.LANG || '';
  if (!value) {
    return {
      id: 'locale',
      title: 'Locale',
      status: 'warn',
      detail: 'LANG/LC_ALL is not set — Nerd Font glyphs may render as boxes',
    };
  }
  return /utf-?8/i.test(value)
    ? { id: 'locale', title: 'Locale', status: 'pass', detail: value }
    : {
        id: 'locale',
        title: 'Locale',
        status: 'warn',
        detail: `${value} is not UTF-8 — Nerd Font glyphs may render as boxes`,
      };
}

interface ShellWiring {
  id: ShellId;
  pointAtShared: boolean;
}

function checkShellWiring(
  shellId: ShellId,
  pointAtShared: boolean,
  fromState: boolean,
  deps: DoctorDeps
): DoctorFinding {
  const shell = getShell(shellId);
  if (!shell) {
    return {
      id: `shell:${shellId}`,
      title: shellId,
      status: 'fail',
      detail: `unknown shell '${shellId}'`,
    };
  }
  const fix: DoctorFix = { kind: 'configure-shell', shellId };

  if (!shell.rcFile) {
    return manualSetupAppliedWith(shell, deps, pointAtShared)
      ? {
          id: `shell:${shellId}`,
          title: shell.label,
          status: 'pass',
          detail: 'set up manually',
        }
      : {
          id: `shell:${shellId}`,
          title: shell.label,
          status: 'warn',
          detail: shell.manualNote ?? 'needs manual setup',
        };
  }

  const content = readRc(shell.rcFile, deps);
  const expectedPath = getShellConfigPath(shellId);
  const exportedPath = pointAtShared ? null : exportedConfigPath(content, shellId);
  const configPath = pointAtShared ? getSharedConfigPath() : (exportedPath ?? expectedPath);
  const hasConfig = pointAtShared || exportedPath !== null;
  const hasInit = shellHasInit(shellId, shell.rcFile, content, deps);

  if (!hasInit) {
    return {
      id: `shell:${shellId}`,
      title: shell.label,
      status: 'fail',
      detail: `${shell.rcFile} has no starship init line`,
      fix,
    };
  }
  if (!hasConfig) {
    return {
      id: `shell:${shellId}`,
      title: shell.label,
      status: 'warn',
      detail: `${shell.rcFile} has the init line but no STARSHIP_CONFIG export`,
      fix,
    };
  }
  if (fromState && pointAtShared && setsOwnConfig(content)) {
    return {
      id: `shell:${shellId}`,
      title: shell.label,
      status: 'warn',
      detail: `${shell.rcFile} still sets its own STARSHIP_CONFIG, which overrides the shared config`,
      fix,
    };
  }
  if (!deps.exists(configPath)) {
    if (pointAtShared) {
      return !fromState
        ? setsOwnConfig(content)
          ? {
              id: `shell:${shellId}`,
              title: shell.label,
              status: 'pass',
              detail: `sets its own STARSHIP_CONFIG instead of ${configPath}`,
            }
          : {
              id: `shell:${shellId}`,
              title: shell.label,
              status: 'warn',
              detail: `no shared config at ${configPath} — Starship runs on its defaults`,
            }
        : {
            id: `shell:${shellId}`,
            title: shell.label,
            status: 'pass',
            detail: `no shared config at ${configPath} — Starship uses its defaults`,
          };
    }
    if (configPath.includes('$')) {
      return {
        id: `shell:${shellId}`,
        title: shell.label,
        status: 'pass',
        detail: `sets its own STARSHIP_CONFIG (${configPath})`,
      };
    }
    if (configPath !== expectedPath) {
      return {
        id: `shell:${shellId}`,
        title: shell.label,
        status: 'warn',
        detail: `points at ${configPath}, which does not exist — update or remove that export`,
      };
    }
    return {
      id: `shell:${shellId}`,
      title: shell.label,
      status: 'fail',
      detail: `points at ${configPath}, which does not exist`,
      fix: fromState ? { kind: 'write-config', shellId } : fix,
    };
  }
  return {
    id: `shell:${shellId}`,
    title: shell.label,
    status: 'pass',
    detail: `configured via ${configPath}`,
  };
}

async function checkConfigs(
  wiring: ShellWiring[],
  probe: StarshipProbe,
  deps: DoctorDeps,
  includeShared: boolean
): Promise<DoctorFinding> {
  const paths = [
    ...new Set([
      ...wiring.map((w) => {
        if (w.pointAtShared) return getSharedConfigPath();
        const rcFile = getShell(w.id)?.rcFile;
        const content = rcFile ? readRc(rcFile, deps) : '';
        return exportedConfigPath(content, w.id) ?? getShellConfigPath(w.id);
      }),
      ...(includeShared ? [getSharedConfigPath()] : []),
    ]),
  ];
  const existing = paths.filter((p) => deps.exists(p));
  if (existing.length === 0) {
    return {
      id: 'config',
      title: 'Config files',
      status: 'warn',
      detail: 'no Starship config found',
    };
  }
  if (!probe.installed) {
    return {
      id: 'config',
      title: 'Config files',
      status: 'warn',
      detail: `cannot verify ${existing.join(', ')} — starship is not reachable`,
    };
  }
  for (const configPath of existing) {
    try {
      await deps.verifyConfig(configPath);
    } catch (err) {
      return {
        id: 'config',
        title: 'Config files',
        status: 'fail',
        detail: `${configPath}: ${errorMessage(err)}`,
      };
    }
  }
  return {
    id: 'config',
    title: 'Config files',
    status: 'pass',
    detail: `starship loaded ${existing.length} config(s)`,
  };
}

async function checkFontInstalled(
  state: WizardState | null,
  deps: DoctorDeps
): Promise<DoctorFinding> {
  const dir = getNerdFontsDir();
  const fontId = state ? fontIdToInstall(state.nerdFontToInstall) : null;
  if (await deps.isContainer()) {
    return {
      id: 'font-installed',
      title: 'Nerd Font',
      status: 'pass',
      detail: 'containers skip font installs',
    };
  }
  if (!fontId && state) {
    return {
      id: 'font-installed',
      title: 'Nerd Font',
      status: 'pass',
      detail: 'no Nerd Font requested',
    };
  }
  if (deps.hasNerdFonts()) {
    return {
      id: 'font-installed',
      title: 'Nerd Font',
      status: 'pass',
      detail: `Nerd Font files found for ${dir}`,
    };
  }
  return {
    id: 'font-installed',
    title: 'Nerd Font',
    // A font the state card asked for and that is missing is a broken setup;
    // without a card nothing says one was wanted.
    status: fontId ? 'fail' : 'warn',
    detail: fontId ? `${fontLabel(fontId)} is not installed in ${dir}` : `no Nerd Font found`,
    ...(fontId ? { fix: { kind: 'reinstall-font' as const, fontId } } : {}),
  };
}

/** Accepts a variant of the family (e.g. the "Mono" width) as a match. */
function familyMatches(actual: string, expected: string): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();
  const a = normalize(actual);
  const b = normalize(expected);
  return a === b || a.startsWith(b) || b.startsWith(a);
}

async function checkFontSelected(
  state: WizardState | null,
  deps: DoctorDeps
): Promise<DoctorFinding> {
  const fontId = state ? fontIdToInstall(state.nerdFontToInstall) : null;
  if (state && !fontId) {
    return {
      id: 'font-selected',
      title: 'Terminal font',
      status: 'pass',
      detail: 'no Nerd Font selected — nothing to verify',
    };
  }
  if (await deps.isContainer()) {
    return {
      id: 'font-selected',
      title: 'Terminal font',
      status: 'pass',
      detail: 'containers skip terminal font wiring',
    };
  }
  const terminalId = await deps.detectTerminal();
  if (!terminalId) {
    return {
      id: 'font-selected',
      title: 'Terminal font',
      status: 'warn',
      detail: 'no supported terminal detected — cannot verify the font is selected',
    };
  }

  const label = TERMINAL_LABELS[terminalId];
  const expectedFamily = fontId ? getFontFamily(fontId) : null;
  const wireFix: DoctorFix | undefined = expectedFamily
    ? { kind: 'wire-font', terminalId, family: expectedFamily }
    : undefined;

  if (terminalId === 'wezterm') {
    return {
      id: 'font-selected',
      title: 'Terminal font',
      status: 'warn',
      detail: `WezTerm's config is Lua — check it selects ${expectedFamily ?? 'a Nerd Font'}`,
    };
  }

  if (await deps.hasBundledNerdFonts(terminalId)) {
    return {
      id: 'font-selected',
      title: 'Terminal font',
      status: 'pass',
      detail: `${label} draws Nerd Font symbols itself`,
    };
  }

  const family = deps.readFontFamily(terminalId);
  if (!family) {
    return {
      id: 'font-selected',
      title: 'Terminal font',
      status: 'warn',
      detail: `${label} has no font set`,
      ...(wireFix ? { fix: wireFix } : {}),
    };
  }
  if (expectedFamily && !familyMatches(family, expectedFamily)) {
    return {
      id: 'font-selected',
      title: 'Terminal font',
      status: 'warn',
      detail: `${label} uses "${family}", expected "${expectedFamily}"`,
      ...(wireFix ? { fix: wireFix } : {}),
    };
  }
  return /nerd font/i.test(family)
    ? {
        id: 'font-selected',
        title: 'Terminal font',
        status: 'pass',
        detail: `${label} uses "${family}"`,
      }
    : {
        id: 'font-selected',
        title: 'Terminal font',
        status: 'warn',
        detail: `${label} uses "${family}", which is not a Nerd Font`,
        ...(wireFix ? { fix: wireFix } : {}),
      };
}

/**
 * Runs every health check against the machine. Without a state card the
 * wiring mode of each present shell is read from its rc.
 */
export async function runDoctor(
  state: WizardState | null,
  deps: DoctorDeps = DEFAULT_DOCTOR_DEPS
): Promise<DoctorReport> {
  const shellIds = state ? state.selectedShells : await deps.detectInstalledShells();
  const wiring: ShellWiring[] = shellIds.map((id) => ({
    id,
    pointAtShared: state ? state.keepExistingConfig : shellPointsAtShared(id, deps),
  }));

  const probe = await probeStarship(deps);

  const findings: DoctorFinding[] = [
    checkStarship(probe, state),
    checkLocale(deps),
    ...wiring.map((w) => checkShellWiring(w.id, w.pointAtShared, state !== null, deps)),
    await checkConfigs(wiring, probe, deps, state === null),
    await checkFontInstalled(state, deps),
    await checkFontSelected(state, deps),
    checkVersionDrift(probe, deps),
    await checkRunningShell(shellIds, deps),
  ];

  return { ok: findings.every((f) => f.status !== 'fail'), findings };
}

/** Human-readable report; `--json` serializes the report object directly. */
export function formatDoctorReport(report: DoctorReport): string {
  const lines = ['Starship health check', ''];
  for (const finding of report.findings) {
    lines.push(statusLine(finding.status, `${finding.title} — ${finding.detail}`));
  }
  const count = (status: DoctorStatus) => report.findings.filter((f) => f.status === status).length;
  lines.push('');
  lines.push(`${count('pass')} passed, ${count('warn')} warning(s), ${count('fail')} failed`);
  return `${lines.join('\n')}\n`;
}
