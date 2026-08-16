import {
  WizardState,
  InstallTask,
  FONT_SELECT_SENTINEL,
  PackageManager,
  ShellId,
} from '../types.js';
import {
  NERD_FONTS,
  installStarship,
  installShell,
  installNerdFont,
  setDefaultShell,
  getMissingStarshipPathDir,
} from './installer.js';
import { generateToml } from '../generators/starship.js';
import {
  writeStarshipConfig,
  applyShellConfig,
  WriteConfigResult,
  ApplyShellConfigOptions,
} from '../generators/shellRc.js';
import { isStarshipInstalledAsync } from './detector.js';

export interface InstallTaskDeps {
  isStarshipInstalled: () => Promise<{ installed: boolean; version?: string }>;
  installStarship: (pm: PackageManager) => Promise<void>;
  installNerdFont: (fontId: string) => Promise<void>;
  installShell: (shellId: ShellId, pm: PackageManager) => Promise<void>;
  setDefaultShell: (shellId: ShellId) => Promise<void>;
  generateToml: (state: WizardState) => string;
  writeStarshipConfig: (toml: string) => WriteConfigResult;
  applyShellConfig: (
    shellId: ShellId,
    options?: ApplyShellConfigOptions
  ) => { applied: boolean; note?: string };
  getMissingStarshipPathDir: () => string | null;
}

export const DEFAULT_INSTALL_TASK_DEPS: InstallTaskDeps = {
  isStarshipInstalled: isStarshipInstalledAsync,
  installStarship,
  installNerdFont,
  installShell,
  setDefaultShell,
  generateToml,
  writeStarshipConfig,
  applyShellConfig,
  getMissingStarshipPathDir,
};

export function buildTaskList(state: WizardState): InstallTask[] {
  const tasks: InstallTask[] = [];

  // Starship (skipped when the user chose "Continue without Starship")
  if (!state.skipStarshipInstall) {
    tasks.push({ id: 'starship', label: 'Starship', status: 'pending' });
  }

  // Nerd Font (skip sentinel value)
  if (state.nerdFontToInstall && state.nerdFontToInstall !== FONT_SELECT_SENTINEL) {
    const fontLabel =
      NERD_FONTS.find((f) => f.id === state.nerdFontToInstall)?.label ?? state.nerdFontToInstall;
    tasks.push({ id: 'font', label: `Nerd Font (${fontLabel})`, status: 'pending' });
  }

  // Shells that need installing
  for (const shellId of state.selectedShells) {
    if (!state.installedShells.includes(shellId)) {
      tasks.push({ id: `shell_${shellId}`, label: `Install ${shellId}`, status: 'pending' });
    }
  }

  // Set default shell
  if (state.setDefaultShell) {
    tasks.push({
      id: 'chsh',
      label: `Set ${state.setDefaultShell} as default shell`,
      status: 'pending',
    });
  }

  // Config write
  tasks.push({ id: 'config', label: 'Write starship.toml', status: 'pending' });

  // RC files — one task per shell so a failure in one does not taint the others
  for (const shellId of state.selectedShells) {
    tasks.push({ id: rcTaskId(shellId), label: `Configure ${shellId}`, status: 'pending' });
  }

  return tasks;
}

/** Task id for the rc-file step of a given shell. */
export function rcTaskId(shellId: ShellId): string {
  return `rc_${shellId}`;
}

/** Raised when the user aborts the install phase. */
export class InstallCancelledError extends Error {
  constructor() {
    super('Install cancelled');
    this.name = 'InstallCancelledError';
  }
}

export async function runInstallTasks(
  state: WizardState,
  deps: InstallTaskDeps,
  onUpdate: (id: string, patch: Partial<InstallTask>) => void,
  signal?: AbortSignal
): Promise<InstallTask[]> {
  let tasks = buildTaskList(state);

  function update(id: string, patch: Partial<InstallTask>) {
    tasks = tasks.map((t) => (t.id === id ? { ...t, ...patch } : t));
    onUpdate(id, patch);
  }

  const cancelled = () => signal?.aborted === true;

  /** Marks every task that never ran, so the summary never implies they succeeded. */
  function markRemainingCancelled() {
    for (const task of tasks) {
      if (task.status === 'pending' || task.status === 'running') {
        update(task.id, { status: 'failed', error: 'Cancelled' });
      }
    }
  }

  // --- Starship (task omitted entirely when skipStarshipInstall) ---
  if (!state.skipStarshipInstall) {
    update('starship', { status: 'running' });
    try {
      const check = await deps.isStarshipInstalled();
      if (check.installed) {
        update('starship', {
          status: 'skipped',
          label: `Starship (${check.version ?? 'installed'})`,
        });
      } else {
        await deps.installStarship(state.packageManager);
        update('starship', { status: 'done' });
      }
    } catch (err) {
      update('starship', { status: 'failed', error: String(err) });
    }
  }

  if (cancelled()) {
    markRemainingCancelled();
    return tasks;
  }

  // --- Nerd Font (skip sentinel value) ---
  let fontInstallFailed = false;
  if (state.nerdFontToInstall && state.nerdFontToInstall !== FONT_SELECT_SENTINEL) {
    update('font', { status: 'running' });
    try {
      await deps.installNerdFont(state.nerdFontToInstall);
      update('font', { status: 'done' });
    } catch (err) {
      fontInstallFailed = true;
      update('font', { status: 'failed', error: String(err) });
    }
  }

  if (cancelled()) {
    markRemainingCancelled();
    return tasks;
  }

  // --- Missing shells ---
  for (const shellId of state.selectedShells) {
    if (state.installedShells.includes(shellId)) continue;
    if (cancelled()) break;
    const taskId = `shell_${shellId}`;
    update(taskId, { status: 'running' });
    try {
      await deps.installShell(shellId, state.packageManager);
      update(taskId, { status: 'done' });
    } catch (err) {
      update(taskId, { status: 'failed', error: String(err) });
    }
  }

  if (cancelled()) {
    markRemainingCancelled();
    return tasks;
  }

  // --- chsh ---
  if (state.setDefaultShell) {
    update('chsh', { status: 'running' });
    try {
      await deps.setDefaultShell(state.setDefaultShell);
      update('chsh', { status: 'done' });
    } catch (err) {
      update('chsh', { status: 'failed', error: String(err) });
    }
  }

  if (cancelled()) {
    markRemainingCancelled();
    return tasks;
  }

  // --- Write starship.toml ---
  update('config', { status: 'running' });
  try {
    // hasNerdFont is set optimistically when the user opts into an install. If that
    // install failed, generating with it still true would write a config full of
    // glyphs the terminal cannot render.
    const configState = fontInstallFailed ? { ...state, hasNerdFont: false } : state;
    const toml = deps.generateToml(configState);
    const written = deps.writeStarshipConfig(toml);

    const notes = [
      written?.backedUpTo ? `previous config saved to ${written.backedUpTo}` : null,
      fontInstallFailed ? 'written without Nerd Font glyphs — the font install failed' : null,
    ].filter(Boolean);

    update('config', {
      status: 'done',
      note: notes.length > 0 ? notes.join('; ') : undefined,
    });
  } catch (err) {
    update('config', { status: 'failed', error: String(err) });
  }

  // --- Apply shell RC files (skipped until Starship is installed) ---
  // Checked once, after the install, so the rc lines can fix up PATH if the
  // script install put the binary somewhere the shell will not look.
  const ensurePathDir = state.skipStarshipInstall ? null : deps.getMissingStarshipPathDir();

  for (const shellId of state.selectedShells) {
    const taskId = rcTaskId(shellId);

    if (state.skipStarshipInstall) {
      update(taskId, {
        status: 'skipped',
        label: `Configure ${shellId} (skipped — install Starship first)`,
      });
      continue;
    }

    update(taskId, { status: 'running' });
    try {
      const result = deps.applyShellConfig(shellId, { ensurePathDir });
      if (result.applied) {
        update(taskId, { status: 'done', note: result.note });
      } else if (result.note) {
        // Not an error: the shell was already configured, or it needs manual
        // setup (nushell, powershell). Either way no rc file was written.
        update(taskId, { status: 'skipped', note: result.note });
      } else {
        update(taskId, { status: 'failed', error: `Unknown shell: ${shellId}` });
      }
    } catch (err) {
      update(taskId, { status: 'failed', error: err instanceof Error ? err.message : String(err) });
    }
  }

  return tasks;
}
