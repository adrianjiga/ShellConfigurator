import { getShell } from '../../config/shells.ts';
import { bashLoginFile, bashNeedsLoginFile, loginLoadsBashrc } from '../../generators/bashLogin.ts';
import { getSharedConfigPath, getShellConfigPath } from '../../generators/configPaths.ts';
import { fishInitFile, initReachable, manualSetupAppliedWith } from '../../generators/rcInit.ts';
import {
  hasManagedConfigExport,
  rcExportedConfigPath,
  rcStarshipConfig,
} from '../../generators/rcLines.ts';
import type { ShellId } from '../../types.ts';
import { errorMessage } from '../errors.ts';
import { DEFAULT_DOCTOR_DEPS } from './deps.ts';
import type { DoctorDeps, DoctorFinding, DoctorFix, ShellWiring, StarshipProbe } from './types.ts';

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
  return rcExportedConfigPath(shellId, content);
}

function setsOwnConfig(content: string, shellId: ShellId): boolean {
  return rcStarshipConfig(shellId, content) !== null;
}

/**
 * The "chair in the wheel" check: does the user's own shell (`$SHELL`, their
 * login shell, else the shell that launched the tool) actually load the modified
 * rc? Configuring bash while using zsh is a healthy install that shows nothing.
 */
export async function checkRunningShell(
  wiring: ShellWiring[],
  deps: DoctorDeps
): Promise<DoctorFinding> {
  const shellIds = wiring.map((w) => w.id);
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
    const pointAtShared = wiring.find((w) => w.id === current)?.pointAtShared ?? false;
    return manualSetupAppliedWith(shell, deps, pointAtShared)
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
  deps: Pick<DoctorDeps, 'exists' | 'readFile' | 'env'>
): boolean {
  if (initReachable(content, shellId, deps, deps.env)) return true;
  return shellId === 'fish' && deps.exists(fishInitFile(rcFile));
}

export function checkLocale(deps: DoctorDeps): DoctorFinding {
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

export function checkShellWiring(
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
  if (shellId === 'bash' && bashNeedsLoginFile()) {
    const loginFile = bashLoginFile(deps);
    if (!loginLoadsBashrc(readRc(loginFile, deps), deps, deps.env)) {
      return {
        id: `shell:${shellId}`,
        title: shell.label,
        status: 'fail',
        detail: `${loginFile} does not load ${shell.rcFile}, so the login shells macOS terminals start never run it`,
        fix,
      };
    }
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
  if (fromState && pointAtShared && setsOwnConfig(content, shellId)) {
    const managed = hasManagedConfigExport(shellId, content);
    return {
      id: `shell:${shellId}`,
      title: shell.label,
      status: 'warn',
      detail: managed
        ? `${shell.rcFile} still sets its own STARSHIP_CONFIG, which overrides the shared config`
        : `${shell.rcFile} sets STARSHIP_CONFIG itself, which overrides the shared config — remove that line to use it`,
      ...(managed ? { fix } : {}),
    };
  }
  if (!deps.exists(configPath)) {
    if (pointAtShared) {
      return !fromState
        ? setsOwnConfig(content, shellId)
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

export async function checkConfigs(
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
