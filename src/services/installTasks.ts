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
} from './installer.js';
import { generateToml } from '../generators/starship.js';
import { writeStarshipConfig, applyShellConfig } from '../generators/shellRc.js';
import { isStarshipInstalledAsync } from './detector.js';

export interface InstallTaskDeps {
  isStarshipInstalled: () => Promise<{ installed: boolean; version?: string }>;
  installStarship: (pm: PackageManager) => Promise<void>;
  installNerdFont: (fontId: string) => Promise<void>;
  installShell: (shellId: ShellId, pm: PackageManager) => Promise<void>;
  setDefaultShell: (shellId: ShellId) => Promise<void>;
  generateToml: (state: WizardState) => string;
  writeStarshipConfig: (toml: string) => void;
  applyShellConfig: (shellId: ShellId) => { applied: boolean; note?: string };
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

  // RC files
  tasks.push({ id: 'rc', label: 'Apply shell configs', status: 'pending' });

  return tasks;
}

export async function runInstallTasks(
  state: WizardState,
  deps: InstallTaskDeps,
  onUpdate: (id: string, patch: Partial<InstallTask>) => void
): Promise<InstallTask[]> {
  let tasks = buildTaskList(state);

  function update(id: string, patch: Partial<InstallTask>) {
    tasks = tasks.map((t) => (t.id === id ? { ...t, ...patch } : t));
    onUpdate(id, patch);
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

  // --- Nerd Font (skip sentinel value) ---
  if (state.nerdFontToInstall && state.nerdFontToInstall !== FONT_SELECT_SENTINEL) {
    update('font', { status: 'running' });
    try {
      await deps.installNerdFont(state.nerdFontToInstall);
      update('font', { status: 'done' });
    } catch (err) {
      update('font', { status: 'failed', error: String(err) });
    }
  }

  // --- Missing shells ---
  for (const shellId of state.selectedShells) {
    if (state.installedShells.includes(shellId)) continue;
    const taskId = `shell_${shellId}`;
    update(taskId, { status: 'running' });
    try {
      await deps.installShell(shellId, state.packageManager);
      update(taskId, { status: 'done' });
    } catch (err) {
      update(taskId, { status: 'failed', error: String(err) });
    }
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

  // --- Write starship.toml ---
  update('config', { status: 'running' });
  try {
    const toml = deps.generateToml(state);
    deps.writeStarshipConfig(toml);
    update('config', { status: 'done' });
  } catch (err) {
    update('config', { status: 'failed', error: String(err) });
  }

  // --- Apply shell RC files (skipped until Starship is installed) ---
  if (state.skipStarshipInstall) {
    update('rc', {
      status: 'skipped',
      label: 'Apply shell configs (skipped — install Starship first)',
    });
  } else {
    update('rc', { status: 'running' });
    const rcErrors: string[] = [];
    for (const shellId of state.selectedShells) {
      try {
        deps.applyShellConfig(shellId);
      } catch (err) {
        rcErrors.push(`${shellId}: ${err instanceof Error ? err.message : err}`);
      }
    }
    if (rcErrors.length > 0) {
      update('rc', { status: 'failed', error: rcErrors.join('; ') });
    } else {
      update('rc', { status: 'done' });
    }
  }

  return tasks;
}
