import { statusLine } from '../config/status.ts';
import { hasManagedRcBlock, startsStarship } from '../generators/rcInit.ts';
import type { ShellId, WizardState } from '../types.ts';
import { DEFAULT_DOCTOR_DEPS } from './doctor/deps.ts';
import { checkFontInstalled, checkFontSelected } from './doctor/fontChecks.ts';
import {
  checkConfigs,
  checkLocale,
  checkRunningShell,
  checkShellWiring,
  shellPointsAtShared,
} from './doctor/shellChecks.ts';
import { checkStarship, checkVersionDrift, probeStarship } from './doctor/starshipChecks.ts';
import type {
  DoctorDeps,
  DoctorFinding,
  DoctorReport,
  DoctorStatus,
  ShellWiring,
} from './doctor/types.ts';

/**
 * The installed shells that were set up: the last recorded run chose them, or
 * they start Starship or carry a ShellConfigurator block.
 */
async function shellsSetUp(deps: DoctorDeps): Promise<ShellId[]> {
  const lastRun = deps.lastRunShells() ?? [];
  return (await deps.detectInstalledShells()).filter(
    (id) => lastRun.includes(id) || startsStarship(id, false, deps) || hasManagedRcBlock(id, deps)
  );
}

const NO_SHELL_SET_UP: DoctorFinding = {
  id: 'shells',
  title: 'Shells',
  status: 'warn',
  detail: 'no installed shell starts Starship — run shell-configurator to set one up',
};

function withCachedReads(deps: DoctorDeps): DoctorDeps {
  const reads = new Map<string, string>();
  const exists = new Map<string, boolean>();
  return {
    ...deps,
    readFile: (file) => {
      const cached = reads.get(file);
      if (cached !== undefined) return cached;
      const content = deps.readFile(file);
      reads.set(file, content);
      return content;
    },
    exists: (file) => {
      const cached = exists.get(file);
      if (cached !== undefined) return cached;
      const found = deps.exists(file);
      exists.set(file, found);
      return found;
    },
  };
}

/**
 * Runs every health check against the machine. Without a state card it checks
 * the shells that were set up, reading each one's wiring mode from its rc.
 */
export async function runDoctor(
  state: WizardState | null,
  uncached: DoctorDeps = DEFAULT_DOCTOR_DEPS
): Promise<DoctorReport> {
  const deps = withCachedReads(uncached);
  const shellIds = state ? state.selectedShells : await shellsSetUp(deps);
  const wiring: ShellWiring[] = shellIds.map((id) => ({
    id,
    pointAtShared: state ? state.keepExistingConfig : shellPointsAtShared(id, deps),
  }));

  const probe = await probeStarship(deps);

  const findings: DoctorFinding[] = [
    checkStarship(probe, state),
    checkLocale(deps),
    ...(shellIds.length === 0 ? [NO_SHELL_SET_UP] : []),
    ...wiring.map((w) => checkShellWiring(w.id, w.pointAtShared, state !== null, deps)),
    await checkConfigs(wiring, probe, deps, state === null),
    await checkFontInstalled(state, deps),
    await checkFontSelected(state, deps),
    checkVersionDrift(probe, deps),
    await checkRunningShell(wiring, deps),
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
