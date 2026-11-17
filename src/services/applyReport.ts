import * as fs from 'node:fs';
import { getShell, type ShellDef, setupCommand } from '../config/shells.ts';
import { statusLine, statusMark } from '../config/status.ts';
import { getSharedConfigPath, getShellConfigPath } from '../generators/configPaths.ts';
import { ORIGINAL_SUFFIX } from '../generators/fileWrite.ts';
import { generateToml } from '../generators/starship.ts';
import type { InstallTask, ShellId, WizardState } from '../types.ts';
import { type FileChange, plannedFileChanges } from './fileDiff.ts';
import { plannedPathDir } from './installer.ts';
import { configIfFontFails, TASK_IDS } from './installTasks.ts';

function formatTask(t: InstallTask): string {
  const suffix = t.error ? ` — ${t.error}` : t.note ? ` (${t.note})` : '';
  return `${statusMark(t.status).icon} ${statusLine(t.status, `${t.label}${suffix}`)}`;
}

/** `text` with terminal control characters shown as `\\uXXXX`, so a fetched file cannot hide lines. */
export function showControlCharacters(text: string): string {
  return text.replace(
    // biome-ignore lint/suspicious/noControlCharactersInRegex: these are what it escapes.
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`
  );
}

/** The plain-text plan/applied view `apply` prints to stdout. */
export function printTasks(tasks: InstallTask[]): void {
  for (const task of tasks) process.stdout.write(`  ${formatTask(task)}\n`);
}

/** The setup command of each selected shell that is set up by hand. */
export function printManualSetup(state: WizardState): void {
  const manual = state.selectedShells
    .map((id) => getShell(id))
    .filter((shell): shell is ShellDef => Boolean(shell && !shell.rcFile));
  for (const shell of manual) {
    process.stdout.write(
      `\n${shell.label} is set up by hand. ${shell.manualNote ?? ''}\n  ${setupCommand(shell, state.keepExistingConfig)}\n`
    );
  }
}

export type DryRunConfig =
  | { kind: 'per-shell'; toml: string; tomlIfFontFails?: string }
  | { kind: 'imported'; path: string; toml: string }
  | { kind: 'kept'; path: string; exists: boolean };

export interface DryRunPlan {
  dryRun: true;
  shells: ShellId[];
  installStarship: boolean;
  tasks: InstallTask[];
  config: DryRunConfig;
  changes: FileChange[];
}

export function dryRunPlan(
  state: WizardState,
  tasks: InstallTask[],
  resetShells: readonly ShellId[],
  starshipInstalled = false
): DryRunPlan {
  const shared = getSharedConfigPath();
  const pathDir = state.skipStarshipInstall ? null : plannedPathDir(state.packageManager);
  return {
    dryRun: true,
    shells: state.selectedShells,
    installStarship: !state.skipStarshipInstall && !starshipInstalled,
    tasks,
    config: state.keepExistingConfig
      ? state.sharedConfigToml != null
        ? { kind: 'imported', path: shared, toml: state.sharedConfigToml }
        : { kind: 'kept', path: shared, exists: fs.existsSync(shared) }
      : perShellConfig(state),
    changes: plannedFileChanges(state, resetShells, pathDir),
  };
}

function perShellConfig(state: WizardState): DryRunConfig {
  const toml = generateToml(state);
  const tomlIfFontFails = configIfFontFails(state);
  return tomlIfFontFails
    ? { kind: 'per-shell', toml, tomlIfFontFails }
    : { kind: 'per-shell', toml };
}

export function printChanges(plan: DryRunPlan): void {
  const shownAbove = new Set(
    plan.config.kind === 'per-shell'
      ? plan.shells.map((shellId) => getShellConfigPath(shellId))
      : plan.config.kind === 'imported'
        ? [plan.config.path]
        : []
  );
  const terminalNote = plan.tasks.some((task) => task.id === TASK_IDS.terminal)
    ? "Its terminal font step edits the terminal's own config, which is not shown here.\n"
    : '';
  if (plan.changes.length === 0) {
    process.stdout.write(`\nNo config or rc file on disk would change.\n${terminalNote}`);
    return;
  }
  process.stdout.write('\nChanges to config and rc files on disk:\n');
  for (const change of plan.changes) {
    if (change.status === 'unreadable') {
      process.stdout.write(`\ncannot read ${change.path}: ${change.error}\n`);
    } else if (change.status === 'create' && shownAbove.has(change.path)) {
      process.stdout.write(`\ncreate ${change.path}: the config shown above\n`);
    } else {
      process.stdout.write(`\n${showControlCharacters(change.diff)}`);
    }
  }
  process.stdout.write(
    `\nA real run also keeps a copy of a file it changes for the first time as <file>${ORIGINAL_SUFFIX}, and writes WHAT-CHANGED.md.\n${terminalNote}`
  );
}
