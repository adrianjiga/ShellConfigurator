import { applyShellConfig } from '../generators/shellRc.ts';
import type { PackageManager, ShellId, TerminalId, WizardState } from '../types.ts';
import { detectPackageManagerAsync } from './detector.ts';
import {
  type DoctorFix,
  type DoctorReport,
  formatDoctorReport,
  runDoctor,
  shellPointsAtShared,
} from './doctor.ts';
import { errorMessage } from './errors.ts';
import { fontLabel, installNerdFont, installStarship } from './installer.ts';
import { type TerminalFontResult, terminalLabel, wireTerminalFont } from './terminalFont.ts';

export type RepairStatus = 'fixed' | 'failed' | 'skipped' | 'planned';

export interface RepairAction {
  findingId: string;
  title: string;
  status: RepairStatus;
  detail: string;
}

export interface RepairReport {
  before: DoctorReport;
  after: DoctorReport;
  actions: RepairAction[];
  /** Mirrors the post-repair doctor report: only false when a check still fails. */
  ok: boolean;
  /** True when the fixes were only planned, not applied. */
  dryRun: boolean;
}

export interface RepairOptions {
  /** Plan the fixes without applying anything; the after-report is skipped. */
  dryRun?: boolean;
}

export interface RepairDeps {
  runDoctor: (state: WizardState | null) => Promise<DoctorReport>;
  /** Resolves a shell's wiring mode from its rc when no state card is given. */
  shellPointsAtShared: (shellId: ShellId) => boolean;
  applyShellConfig: (
    shellId: ShellId,
    options: { pointAtSharedConfig: boolean }
  ) => { applied: boolean; note?: string };
  installStarship: (pm: PackageManager) => Promise<void>;
  installNerdFont: (fontId: string) => Promise<string | undefined>;
  wireTerminalFont: (terminalId: TerminalId, family: string) => TerminalFontResult;
  detectPackageManager: () => Promise<PackageManager | null>;
}

export const DEFAULT_REPAIR_DEPS: RepairDeps = {
  runDoctor: (state) => runDoctor(state),
  shellPointsAtShared: (shellId) => shellPointsAtShared(shellId),
  applyShellConfig,
  installNerdFont,
  installStarship,
  wireTerminalFont,
  detectPackageManager: () => detectPackageManagerAsync(),
};

/** What a fix would do — the dry-run counterpart of actually applying it. */
function describeFix(fix: DoctorFix): string {
  switch (fix.kind) {
    case 'reinstall-starship':
      return 'reinstall Starship via the detected package manager';
    case 'configure-shell':
      return `add the starship init line to ${fix.shellId}`;
    case 'reinstall-font':
      return `reinstall ${fontLabel(fix.fontId)}`;
    case 'wire-font':
      return `set the ${terminalLabel(fix.terminalId)} font to "${fix.family}"`;
  }
}

async function applyFix(
  fix: DoctorFix,
  pointAtShared: boolean | null,
  deps: RepairDeps
): Promise<{ detail: string; status: RepairStatus }> {
  switch (fix.kind) {
    case 'reinstall-starship': {
      const pm = await deps.detectPackageManager();
      if (!pm) throw new Error('no supported package manager detected');
      await deps.installStarship(pm);
      return { detail: `reinstalled Starship via ${pm}`, status: 'fixed' };
    }
    case 'configure-shell': {
      const shared = pointAtShared ?? deps.shellPointsAtShared(fix.shellId);
      const result = deps.applyShellConfig(fix.shellId, { pointAtSharedConfig: shared });
      return result.applied
        ? { detail: `added the starship init line to ${fix.shellId}`, status: 'fixed' }
        : { detail: result.note ?? 'already configured', status: 'skipped' };
    }
    case 'reinstall-font': {
      await deps.installNerdFont(fix.fontId);
      return { detail: `reinstalled ${fontLabel(fix.fontId)}`, status: 'fixed' };
    }
    case 'wire-font': {
      const result = deps.wireTerminalFont(fix.terminalId, fix.family);
      return result.applied
        ? {
            detail: `set the ${terminalLabel(fix.terminalId)} font to "${fix.family}"`,
            status: 'fixed',
          }
        : { detail: result.note ?? 'could not edit the terminal config', status: 'skipped' };
    }
  }
}

/**
 * Runs the doctor, applies the fix for every failing check that carries one,
 * then runs the doctor again so the caller reports the *result*, not the
 * intent. Warnings are left alone — they describe states the user may have
 * chosen. Each fix is attempted independently: one failure does not stop the
 * others. With `dryRun` nothing is applied and the planned actions are
 * reported against the unchanged before-report.
 */
export async function runRepair(
  state: WizardState | null,
  deps: RepairDeps = DEFAULT_REPAIR_DEPS,
  options: RepairOptions = {}
): Promise<RepairReport> {
  const before = await deps.runDoctor(state);
  const pointAtShared = state?.keepExistingConfig ?? null;
  const actions: RepairAction[] = [];

  for (const finding of before.findings) {
    if (finding.status !== 'fail' || !finding.fix) continue;
    if (options.dryRun) {
      actions.push({
        findingId: finding.id,
        title: finding.title,
        status: 'planned',
        detail: describeFix(finding.fix),
      });
      continue;
    }
    try {
      const { detail, status } = await applyFix(finding.fix, pointAtShared, deps);
      actions.push({ findingId: finding.id, title: finding.title, status, detail });
    } catch (err) {
      actions.push({
        findingId: finding.id,
        title: finding.title,
        status: 'failed',
        detail: errorMessage(err),
      });
    }
  }

  const after = options.dryRun ? before : await deps.runDoctor(state);
  return { before, after, actions, ok: after.ok, dryRun: options.dryRun ?? false };
}

/** Human-readable repair report; `--json` serializes the report directly. */
export function formatRepairReport(report: RepairReport): string {
  const lines = [
    report.dryRun ? 'Starship repair (dry run — nothing was applied)' : 'Starship repair',
    '',
  ];
  if (report.actions.length === 0) {
    lines.push('Nothing to repair.');
  } else {
    for (const action of report.actions) {
      lines.push(`${action.status.toUpperCase().padEnd(7)} ${action.title} — ${action.detail}`);
    }
  }
  if (!report.dryRun) {
    lines.push('', 'After repair:', '', formatDoctorReport(report.after).trimEnd());
  }
  return `${lines.join('\n')}\n`;
}
