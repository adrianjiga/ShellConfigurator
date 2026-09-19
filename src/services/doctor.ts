import * as fs from 'node:fs';
import { getShell } from '../config/shells.ts';
import {
  getSharedConfigPath,
  getShellConfigPath,
  starshipConfigLine,
} from '../generators/shellRc.ts';
import { fontIdToInstall, type ShellId, type TerminalId, type WizardState } from '../types.ts';
import {
  detectInstalledShellsAsync,
  detectTerminalAsync,
  isStarshipInstalledAsync,
} from './detector.ts';
import { errorMessage } from './errors.ts';
import { runCapture } from './exec.ts';
import { fontLabel, getFontFamily, getNerdFontsDir } from './installer.ts';
import { readTerminalFontFamily, terminalLabel } from './terminalFont.ts';

export type DoctorStatus = 'pass' | 'warn' | 'fail';

/** A repair the P2.4 `--fix` pass knows how to apply. */
export type DoctorFix =
  | { kind: 'reinstall-starship' }
  | { kind: 'configure-shell'; shellId: ShellId }
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
  detectInstalledShells: typeof detectInstalledShellsAsync;
  detectTerminal: typeof detectTerminalAsync;
  readFontFamily: typeof readTerminalFontFamily;
  verifyConfig: (configPath: string) => Promise<void>;
  readFile: (path: string) => string;
  exists: (path: string) => boolean;
  hasFontFiles: (dir: string) => boolean;
  env: NodeJS.ProcessEnv;
}

export const DEFAULT_DOCTOR_DEPS: DoctorDeps = {
  isStarshipInstalled: isStarshipInstalledAsync,
  detectInstalledShells: detectInstalledShellsAsync,
  detectTerminal: detectTerminalAsync,
  readFontFamily: readTerminalFontFamily,
  verifyConfig: (configPath) =>
    runCapture('starship', ['print-config'], {
      env: { ...process.env, STARSHIP_CONFIG: configPath },
    }).then(() => undefined),
  readFile: (path) => fs.readFileSync(path, 'utf8'),
  exists: (path) => fs.existsSync(path),
  hasFontFiles: (dir) => {
    try {
      return fs.readdirSync(dir).some((name) => /\.(ttf|otf)$/i.test(name));
    } catch {
      return false;
    }
  },
  env: process.env,
};

async function checkStarship(deps: DoctorDeps): Promise<DoctorFinding> {
  const { installed, version } = await deps.isStarshipInstalled();
  return installed
    ? { id: 'starship', title: 'Starship', status: 'pass', detail: version ?? 'installed' }
    : {
        id: 'starship',
        title: 'Starship',
        status: 'fail',
        detail: 'starship is not on PATH',
        fix: { kind: 'reinstall-starship' },
      };
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

function checkShellWiring(
  shellId: ShellId,
  pointAtShared: boolean,
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
    return deps.exists(shell.initPath ?? '')
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
          fix,
        };
  }

  const content = deps.exists(shell.rcFile) ? deps.readFile(shell.rcFile) : '';
  const configPath = pointAtShared ? getSharedConfigPath() : getShellConfigPath(shellId);
  const configLine = pointAtShared ? null : starshipConfigLine(shellId);
  const hasInit = content.includes(shell.initLine);
  const hasConfig = configLine ? content.includes(configLine) : true;

  if (!hasInit) {
    return {
      id: `shell:${shellId}`,
      title: shell.label,
      status: 'warn',
      detail: `${shell.rcFile} has no starship init line`,
      fix,
    };
  }
  if (configLine && !hasConfig) {
    return {
      id: `shell:${shellId}`,
      title: shell.label,
      status: 'fail',
      detail: `${shell.rcFile} has the init line but no STARSHIP_CONFIG export`,
      fix,
    };
  }
  if (!deps.exists(configPath)) {
    return {
      id: `shell:${shellId}`,
      title: shell.label,
      status: 'fail',
      detail: `points at ${configPath}, which does not exist`,
      fix,
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
  shellIds: ShellId[],
  pointAtShared: boolean,
  deps: DoctorDeps
): Promise<DoctorFinding> {
  const paths = pointAtShared
    ? [getSharedConfigPath()]
    : shellIds.map((id) => getShellConfigPath(id));
  const existing = paths.filter((p) => deps.exists(p));
  if (existing.length === 0) {
    return {
      id: 'config',
      title: 'Config files',
      status: 'warn',
      detail: 'no Starship config found',
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

function checkFontInstalled(state: WizardState | null, deps: DoctorDeps): DoctorFinding {
  const dir = getNerdFontsDir();
  if (deps.hasFontFiles(dir)) {
    return {
      id: 'font-installed',
      title: 'Nerd Font',
      status: 'pass',
      detail: `fonts present in ${dir}`,
    };
  }
  const fontId = state ? fontIdToInstall(state.nerdFontToInstall) : null;
  return {
    id: 'font-installed',
    title: 'Nerd Font',
    status: 'warn',
    detail: fontId
      ? `${fontLabel(fontId)} is not installed in ${dir}`
      : `no Nerd Font found in ${dir}`,
    ...(fontId ? { fix: { kind: 'reinstall-font' as const, fontId } } : {}),
  };
}

async function checkFontSelected(
  state: WizardState | null,
  deps: DoctorDeps
): Promise<DoctorFinding> {
  const terminalId = await deps.detectTerminal();
  if (!terminalId) {
    return {
      id: 'font-selected',
      title: 'Terminal font',
      status: 'warn',
      detail: 'no supported terminal detected — cannot verify the font is selected',
    };
  }

  const label = terminalLabel(terminalId);
  const fontId = state ? fontIdToInstall(state.nerdFontToInstall) : null;
  const expectedFamily = fontId ? getFontFamily(fontId) : null;
  const wireFix: DoctorFix | undefined = expectedFamily
    ? { kind: 'wire-font', terminalId, family: expectedFamily }
    : undefined;

  if (terminalId === 'wezterm') {
    return {
      id: 'font-selected',
      title: 'Terminal font',
      status: 'warn',
      detail: `WezTerm's config is Lua — verify it selects ${expectedFamily ?? 'a Nerd Font'}`,
      ...(wireFix ? { fix: wireFix } : {}),
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
  if (expectedFamily && family !== expectedFamily) {
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
 * Runs every health check against the machine. `state` is an optional state card
 * describing what the user intended to install; without one the doctor inspects
 * the shells that are actually present.
 */
export async function runDoctor(
  state: WizardState | null,
  deps: DoctorDeps = DEFAULT_DOCTOR_DEPS
): Promise<DoctorReport> {
  const pointAtShared = state?.keepExistingConfig ?? false;
  const shellIds =
    state && state.selectedShells.length > 0
      ? state.selectedShells
      : await deps.detectInstalledShells();

  const findings: DoctorFinding[] = [
    await checkStarship(deps),
    checkLocale(deps),
    ...shellIds.map((id) => checkShellWiring(id, pointAtShared, deps)),
    await checkConfigs(shellIds, pointAtShared, deps),
    checkFontInstalled(state, deps),
    await checkFontSelected(state, deps),
  ];

  return { ok: findings.every((f) => f.status !== 'fail'), findings };
}

const STATUSBAR: Record<DoctorStatus, string> = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' };

/** Human-readable report; `--json` serializes the report object directly. */
export function formatDoctorReport(report: DoctorReport): string {
  const lines = ['Starship health check', ''];
  for (const finding of report.findings) {
    lines.push(`${STATUSBAR[finding.status]}  ${finding.title} — ${finding.detail}`);
  }
  const count = (status: DoctorStatus) => report.findings.filter((f) => f.status === status).length;
  lines.push('');
  lines.push(`${count('pass')} passed, ${count('warn')} warning(s), ${count('fail')} failed`);
  return `${lines.join('\n')}\n`;
}
