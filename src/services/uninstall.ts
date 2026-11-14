import * as fs from 'node:fs';
import { getShell, SHELLS } from '../config/shells.ts';
import { statusLine } from '../config/status.ts';
import {
  getShellConfigPath,
  hasManagedRcBlock,
  type RemovalResult,
  removeManagedRcBlocks,
  removeShellConfigFile,
} from '../generators/shellRc.ts';
import type { PackageManager, ShellId } from '../types.ts';
import { forgetStarshipVersion } from './cache.ts';
import { detectPackageManagerAsync } from './detector.ts';
import { errorMessage } from './errors.ts';
import {
  fontLabel,
  getNerdFontsDir,
  installedFontFiles,
  plannedStarshipRemoval,
  removeFontFiles,
  removeStarship,
  type StarshipRemoval,
} from './installer.ts';

export type UninstallStatus = 'removed' | 'skipped' | 'failed' | 'planned';

/** One step of the plan; a step without `run` has nothing to do and says why. */
export interface UninstallStep {
  id: string;
  title: string;
  detail: string;
  run?: () => Promise<string>;
}

export interface UninstallAction {
  id: string;
  title: string;
  status: UninstallStatus;
  detail: string;
}

export interface UninstallReport {
  actions: UninstallAction[];
  /** False when any step failed. */
  ok: boolean;
  dryRun: boolean;
}

export interface UninstallOptions {
  /** The shells to clean up; by default every shell with something to remove. */
  shells?: ShellId[];
  /** Also remove Starship itself. */
  starship?: boolean;
  /** Also remove this Nerd Font. */
  fontId?: string;
}

export interface UninstallDeps {
  hasManagedRcBlock: (shellId: ShellId) => boolean;
  hasShellConfig: (shellId: ShellId) => boolean;
  removeManagedRcBlocks: (shellId: ShellId) => RemovalResult;
  removeShellConfigFile: (shellId: ShellId) => RemovalResult;
  detectPackageManager: () => Promise<PackageManager>;
  plannedStarshipRemoval: (pm: PackageManager) => StarshipRemoval;
  removeStarship: (plan: StarshipRemoval) => Promise<void>;
  forgetStarshipVersion: () => void;
  installedFontFiles: (fontId: string) => Promise<string[] | null>;
  removeFontFiles: (files: string[]) => Promise<void>;
}

export const DEFAULT_UNINSTALL_DEPS: UninstallDeps = {
  hasManagedRcBlock: (shellId) => hasManagedRcBlock(shellId),
  hasShellConfig: (shellId) => fs.existsSync(getShellConfigPath(shellId)),
  removeManagedRcBlocks,
  removeShellConfigFile,
  detectPackageManager: () => detectPackageManagerAsync(),
  plannedStarshipRemoval,
  removeStarship: (plan) => removeStarship(plan),
  forgetStarshipVersion,
  installedFontFiles,
  removeFontFiles,
};

function describeRemoval(result: RemovalResult, what: string): string {
  const parts = [result.removed ? `removed ${what}` : (result.note ?? `left ${what} alone`)];
  if (result.removed && result.backedUpTo) parts.push(`backup: ${result.backedUpTo}`);
  if (result.removed && result.note) parts.push(result.note);
  return parts.join('; ');
}

/** What a shell has on disk, read once per plan. */
interface ShellFacts {
  shellId: ShellId;
  managedRc: boolean;
  config: boolean;
}

function shellSteps(facts: ShellFacts, explicit: boolean, deps: UninstallDeps): UninstallStep[] {
  const { shellId } = facts;
  const shell = getShell(shellId);
  if (!shell) return [];
  const steps: UninstallStep[] = [];
  if (shell.rcFile) {
    const rc = shell.rcFile;
    if (facts.managedRc) {
      steps.push({
        id: `rc_${shellId}`,
        title: `${shell.label} rc`,
        detail: `remove the ShellConfigurator lines from ${rc}`,
        run: async () =>
          describeRemoval(deps.removeManagedRcBlocks(shellId), `the lines from ${rc}`),
      });
    } else if (explicit) {
      steps.push({
        id: `rc_${shellId}`,
        title: `${shell.label} rc`,
        detail: `no ShellConfigurator lines in ${rc}`,
      });
    }
  } else if (explicit || facts.config) {
    steps.push({
      id: `rc_${shellId}`,
      title: `${shell.label} setup`,
      detail: `set up by hand: remove the Starship lines from ${shell.initPath} yourself`,
    });
  }
  const config = getShellConfigPath(shellId);
  if (facts.config) {
    steps.push({
      id: `config_${shellId}`,
      title: `${shell.label} config`,
      detail: `move ${config} aside to a backup`,
      run: async () => describeRemoval(deps.removeShellConfigFile(shellId), config),
    });
  }
  return steps;
}

async function fontStep(fontId: string, deps: UninstallDeps): Promise<UninstallStep> {
  const label = fontLabel(fontId);
  const files = await deps.installedFontFiles(fontId);
  if (files === null) {
    return {
      id: 'font',
      title: label,
      detail: `no cached ${label} archive to tell its files apart; remove them from ${getNerdFontsDir()} yourself`,
    };
  }
  if (files.length === 0) return { id: 'font', title: label, detail: `${label} is not installed` };
  return {
    id: 'font',
    title: label,
    detail: `delete ${files.length} font file${files.length === 1 ? '' : 's'} from ${getNerdFontsDir()}`,
    run: async () => {
      await deps.removeFontFiles(files);
      return `deleted ${files.length} font file${files.length === 1 ? '' : 's'}`;
    },
  };
}

async function starshipStep(deps: UninstallDeps): Promise<UninstallStep> {
  const plan = deps.plannedStarshipRemoval(await deps.detectPackageManager());
  const remove = (done: string) => async () => {
    await deps.removeStarship(plan);
    deps.forgetStarshipVersion();
    return done;
  };
  switch (plan.kind) {
    case 'absent':
      return { id: 'starship', title: 'Starship', detail: 'Starship is not installed' };
    case 'manual':
      return {
        id: 'starship',
        title: 'Starship',
        detail: `${plan.path} was not installed by a package manager here; remove it with whatever installed it`,
      };
    case 'script':
      return {
        id: 'starship',
        title: 'Starship',
        detail: `delete ${plan.path}`,
        run: remove(`deleted ${plan.path}`),
      };
    case 'package':
      return {
        id: 'starship',
        title: 'Starship',
        detail: `run ${plan.command.join(' ')}`,
        run: remove(`removed the ${plan.pm} package`),
      };
  }
}

/**
 * The steps that undo an install, in reverse install order: each shell's rc
 * lines and config, then the font, then Starship. Reads only; nothing changes.
 */
export async function planUninstall(
  options: UninstallOptions,
  deps: UninstallDeps = DEFAULT_UNINSTALL_DEPS
): Promise<UninstallStep[]> {
  const explicit = options.shells !== undefined;
  const facts = (options.shells ?? SHELLS.map((s) => s.id)).map((shellId) => ({
    shellId,
    managedRc: deps.hasManagedRcBlock(shellId),
    config: deps.hasShellConfig(shellId),
  }));
  const steps = facts
    .filter((f) => explicit || f.managedRc || f.config)
    .flatMap((f) => shellSteps(f, explicit, deps));
  if (options.fontId) steps.push(await fontStep(options.fontId, deps));
  if (options.starship) steps.push(await starshipStep(deps));
  return steps;
}

/** Runs the plan; a failed step does not stop the rest. With `dryRun` nothing runs. */
export async function runUninstall(
  steps: UninstallStep[],
  options: { dryRun?: boolean } = {}
): Promise<UninstallReport> {
  const actions: UninstallAction[] = [];
  for (const { id, title, detail, run } of steps) {
    if (!run) {
      actions.push({ id, title, status: 'skipped', detail });
    } else if (options.dryRun) {
      actions.push({ id, title, status: 'planned', detail });
    } else {
      try {
        actions.push({ id, title, status: 'removed', detail: await run() });
      } catch (err) {
        actions.push({ id, title, status: 'failed', detail: errorMessage(err) });
      }
    }
  }
  return {
    actions,
    ok: actions.every((a) => a.status !== 'failed'),
    dryRun: options.dryRun ?? false,
  };
}

/** Human-readable uninstall report; `--json` serializes the report directly. */
export function formatUninstallReport(report: UninstallReport): string {
  const lines = [
    report.dryRun ? 'Starship uninstall (dry run — nothing was changed)' : 'Starship uninstall',
    '',
  ];
  if (report.actions.length === 0) lines.push('Nothing to uninstall.');
  for (const action of report.actions) {
    lines.push(statusLine(action.status, `${action.title} — ${action.detail}`));
  }
  return `${lines.join('\n')}\n`;
}
