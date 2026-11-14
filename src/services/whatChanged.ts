import * as fs from 'node:fs';
import * as path from 'node:path';
import { getShell, setupCommand } from '../config/shells.ts';
import { statusMark } from '../config/status.ts';
import { getSharedConfigPath, getShellConfigPath, writeFileAtomic } from '../generators/shellRc.ts';
import { fontIdToInstall, type InstallTask, type WizardState } from '../types.ts';
import { redactUrls } from './debugInfo.ts';
import { TASK_IDS } from './installTasks.ts';
import { configHome, redactHome } from './paths.ts';
import { type RunManifest, readRunManifest, writeInRun } from './runCapture.ts';

export function whatChangedPath(): string {
  return path.join(configHome(), 'starship', 'WHAT-CHANGED.md');
}

export interface WhatChangedRun {
  kind: 'install' | 'apply';
  timestamp: string;
  state: WizardState;
  results: InstallTask[];
  manifest: RunManifest;
  command?: string;
}

function codeSpan(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  return longest === 0 ? `${fence}${text}${fence}` : `${fence} ${text} ${fence}`;
}

function fileChange(file: RunManifest['files'][number]): string {
  if (file.before === null) return 'created';
  if (file.after === null) return 'removed';
  return 'modified';
}

function shellLine(run: WhatChangedRun, shellId: WizardState['selectedShells'][number]): string {
  const shell = getShell(shellId);
  if (!shell) return `- ${shellId}`;
  const config = run.state.keepExistingConfig
    ? `reads the shared config \`${getSharedConfigPath()}\``
    : `config \`${getShellConfigPath(shellId)}\``;
  if (shell.rcFile) {
    return `- ${shell.label}: Starship lines in \`${shell.rcFile}\`, in the block under \`# Added by ShellConfigurator\`; ${config}`;
  }
  return `- ${shell.label}: set up by hand with \`${setupCommand(shell, run.state.keepExistingConfig)}\` (in \`${shell.initPath}\`); ${config}`;
}

export function renderWhatChanged(run: WhatChangedRun): string {
  const installed = (taskId: string) =>
    run.results.some((task) => task.id === taskId && task.status === 'done');
  const fontId = installed(TASK_IDS.font) ? fontIdToInstall(run.state.nerdFontToInstall) : null;
  const removals = [...(fontId ? [`add \`--font ${fontId}\` to remove the font`] : [])];
  const lines = [
    '# What ShellConfigurator changed',
    '',
    `${run.kind === 'install' ? 'Wizard install' : 'Headless apply'} on ${run.timestamp}${run.command ? ` (${codeSpan(`shell-configurator ${redactUrls(run.command)}`)})` : ''}, run id \`${run.manifest.runId}\`.`,
    '',
    'A later `uninstall` or `rollback` may have undone it since; `shell-configurator rollback --list` shows the runs that still stand.',
    '',
    '## Tasks',
    '',
    ...run.results.map((task) => {
      const detail = task.error ? ` — ${task.error}` : task.note ? ` (${task.note})` : '';
      return `- ${statusMark(task.status).icon} ${task.label}${detail}`;
    }),
    '',
    '## Files',
    '',
    ...run.manifest.files.map((file) => `- ${fileChange(file)} \`${file.path}\``),
    '',
    '## Shells',
    '',
    ...run.state.selectedShells.map((shellId) => shellLine(run, shellId)),
    '',
    '## Undo',
    '',
    '- `shell-configurator rollback` puts the files above back as they were before this run.',
    `- \`shell-configurator uninstall\` removes the Starship lines${run.state.keepExistingConfig ? '' : ' and per-shell configs'}${removals.map((removal) => `; ${removal}`).join('')}, and \`--starship\` to remove Starship.`,
    '- `shell-configurator doctor` checks the setup.',
  ];
  return redactHome(`${lines.join('\n')}\n`);
}

/**
 * Writes the summary as part of the run itself, so rolling the run back puts
 * the previous summary back. Null when the run's record cannot take it.
 */
export function writeWhatChanged(run: WhatChangedRun): string | null {
  const file = whatChangedPath();
  const written = writeInRun(run.manifest.runId, file, () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeFileAtomic(file, renderWhatChanged(run));
  });
  return written ? file : null;
}

/**
 * The summary of the captured run `runId`, written when that run changed files
 * and never throwing. A run that changed nothing leaves the last summary alone.
 */
export function writeWhatChangedSafely(
  runId: string | null,
  run: Omit<WhatChangedRun, 'manifest'>
): string | null {
  try {
    const manifest = runId ? readRunManifest(runId) : null;
    return manifest ? writeWhatChanged({ ...run, manifest }) : null;
  } catch {
    return null;
  }
}
