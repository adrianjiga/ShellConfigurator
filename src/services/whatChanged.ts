import * as fs from 'node:fs';
import * as path from 'node:path';
import { getShell, setupCommand } from '../config/shells.ts';
import { statusMark } from '../config/status.ts';
import { getSharedConfigPath, getShellConfigPath, writeFileAtomic } from '../generators/shellRc.ts';
import { fontIdToInstall, type InstallTask, type WizardState } from '../types.ts';
import { TASK_IDS } from './installTasks.ts';
import { configHome, redactHome } from './paths.ts';
import type { RunManifest } from './runCapture.ts';

/** ~/.config/starship/WHAT-CHANGED.md, rewritten by every install and apply. */
export function whatChangedPath(): string {
  return path.join(configHome(), 'starship', 'WHAT-CHANGED.md');
}

export interface WhatChangedRun {
  kind: 'install' | 'apply';
  timestamp: string;
  state: WizardState;
  results: InstallTask[];
  manifest: RunManifest | null;
  command?: string;
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

/** The Markdown summary of a run: what ran, which files changed, and how to undo it. */
export function renderWhatChanged(run: WhatChangedRun): string {
  const fontInstalled = run.results.some(
    (task) => task.id === TASK_IDS.font && task.status === 'done'
  );
  const fontId = fontInstalled ? fontIdToInstall(run.state.nerdFontToInstall) : null;
  const lines = [
    '# What ShellConfigurator changed',
    '',
    `${run.kind === 'install' ? 'Wizard install' : 'Headless apply'} on ${run.timestamp}${run.command ? ` (\`shell-configurator ${run.command}\`)` : ''}${run.manifest ? `, run id \`${run.manifest.runId}\`` : ''}.`,
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
    ...(run.manifest
      ? run.manifest.files.map((file) => `- ${fileChange(file)} \`${file.path}\``)
      : [
          'No changed files were recorded: the run changed none, or their copies could not be saved, so `rollback` has nothing to put back.',
        ]),
    '',
    '## Shells',
    '',
    ...run.state.selectedShells.map((shellId) => shellLine(run, shellId)),
    '',
    '## Undo',
    '',
    ...(run.manifest
      ? ['- `shell-configurator rollback` puts the files above back as they were before this run.']
      : []),
    `- \`shell-configurator uninstall\` removes the Starship lines${run.state.keepExistingConfig ? '' : ' and per-shell configs'}${fontId ? `; add \`--font ${fontId}\` to remove the font` : ''}, and \`--starship\` to remove Starship.`,
    '- `shell-configurator doctor` checks the setup.',
  ];
  return redactHome(`${lines.join('\n')}\n`);
}

/** Writes the summary; throws when it cannot. Returns where it went. */
export function writeWhatChanged(run: WhatChangedRun): string {
  const file = whatChangedPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeFileAtomic(file, renderWhatChanged(run));
  return file;
}

/** `writeWhatChanged` that never throws: the summary must not fail a finished run. */
export function writeWhatChangedSafely(run: WhatChangedRun): string | null {
  try {
    return writeWhatChanged(run);
  } catch {
    return null;
  }
}
