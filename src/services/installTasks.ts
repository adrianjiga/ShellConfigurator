import {
  type ApplyShellConfigOptions,
  applyShellConfig,
  backupSharedConfig,
  getSharedConfigPath,
  getShellConfigPath,
  resetSharedShellConfig,
  type WriteConfigResult,
  writeSharedConfig,
  writeShellConfig,
} from '../generators/shellRc.ts';
import { generateToml } from '../generators/starship.ts';
import {
  fontIdToInstall,
  type InstallStatus,
  type InstallTask,
  type InstallTaskId,
  type PackageManager,
  type ShellId,
  type TerminalId,
  type WizardState,
} from '../types.ts';
import { detectInstalledShellsAsync, isStarshipInstalledAsync } from './detector.ts';
import { errorMessage } from './errors.ts';
import { runCapture } from './exec.ts';
import {
  fontLabel,
  getFontFamily,
  getMissingStarshipPathDir,
  installNerdFont,
  installShell,
  installStarship,
  setDefaultShell,
  shellInstallSupported,
} from './installer.ts';
import { type TerminalFontResult, terminalLabel, wireTerminalFont } from './terminalFont.ts';

export interface InstallTaskDeps {
  isStarshipInstalled: () => Promise<{ installed: boolean; version?: string }>;
  installStarship: (pm: PackageManager) => Promise<void>;
  installShell: (shellId: ShellId, pm: PackageManager) => Promise<void>;
  setDefaultShell: (shellId: ShellId) => Promise<void>;
  /** Installs a Nerd Font; resolves with a note when it came from the cache. */
  installNerdFont: (fontId: string) => Promise<string | undefined>;
  generateToml: (state: WizardState) => string;
  writeShellConfig: (toml: string, shellId: ShellId) => WriteConfigResult;
  /** Writes the shared starship.toml in adopt mode (e.g. an --import-url fetch). */
  writeSharedConfig: (toml: string) => WriteConfigResult;
  /** Snapshots the shared starship.toml before per-shell configs shadow it. Null when none exists. */
  backupSharedConfig: () => string | null;
  applyShellConfig: (
    shellId: ShellId,
    options?: ApplyShellConfigOptions
  ) => { applied: boolean; note?: string };
  resetSharedShellConfig: (shellId: ShellId) => { applied: boolean; note?: string };
  /** Shells that run Starship and could inherit a leaked STARSHIP_CONFIG. */
  getShellsUsingStarship: () => Promise<ShellId[]>;
  getMissingStarshipPathDir: () => string | null;
  /** Rejects when starship cannot load the config at `configPath`. */
  verifyConfig: (configPath: string) => Promise<void>;
  /** Points the detected terminal at the installed Nerd Font family. */
  wireTerminalFont: (terminalId: TerminalId, family: string) => TerminalFontResult;
}

export const DEFAULT_INSTALL_TASK_DEPS: InstallTaskDeps = {
  isStarshipInstalled: isStarshipInstalledAsync,
  installStarship,
  installNerdFont,
  installShell,
  setDefaultShell,
  generateToml,
  writeShellConfig,
  writeSharedConfig,
  backupSharedConfig,
  applyShellConfig,
  resetSharedShellConfig,
  getShellsUsingStarship: detectInstalledShellsAsync,
  getMissingStarshipPathDir,
  verifyConfig: async (configPath) => {
    await runCapture('starship', ['print-config'], {
      env: { ...process.env, STARSHIP_CONFIG: configPath },
    });
  },
  wireTerminalFont,
};

/** The single-task ids shared by the screens, so no magic strings leak. */
export const TASK_IDS = {
  starship: 'starship',
  font: 'font',
  config: 'config',
  chsh: 'chsh',
  verify: 'verify',
  terminal: 'terminal',
} as const satisfies Record<string, InstallTaskId>;

/** Task id for the rc-file step of a given shell. */
export function rcTaskId(shellId: ShellId): `rc_${ShellId}` {
  return `rc_${shellId}`;
}

/** Task id for the install step of a given shell. */
export function shellTaskId(shellId: ShellId): `shell_${ShellId}` {
  return `shell_${shellId}`;
}

export function buildTaskList(state: WizardState): InstallTask[] {
  const tasks: InstallTask[] = [];

  // Starship (skipped when the user chose "Continue without Starship")
  if (!state.skipStarshipInstall) {
    tasks.push({ id: TASK_IDS.starship, label: 'Starship', status: 'pending' });
  }

  // Nerd Font (only when a concrete font was chosen)
  const fontId = fontIdToInstall(state.nerdFontToInstall);
  if (fontId) {
    tasks.push({ id: TASK_IDS.font, label: `Nerd Font (${fontLabel(fontId)})`, status: 'pending' });
  }

  // Terminal font wiring: only meaningful once a concrete font is being installed.
  if (fontId && state.terminal) {
    tasks.push({
      id: TASK_IDS.terminal,
      label: `Set ${terminalLabel(state.terminal)} font`,
      status: 'pending',
    });
  }

  // Shells that need installing. A shell the detected package manager has no
  // package for gets tagged "(manual)" so the plan is honest up front.
  for (const shellId of state.selectedShells) {
    if (!state.installedShells.includes(shellId)) {
      const supported = shellInstallSupported(shellId, state.packageManager);
      tasks.push({
        id: shellTaskId(shellId),
        label: `Install ${shellId}${supported ? '' : ' (manual)'}`,
        status: 'pending',
      });
    }
  }

  // Set default shell
  if (state.setDefaultShell) {
    tasks.push({
      id: TASK_IDS.chsh,
      label: `Set ${state.setDefaultShell} as default shell`,
      status: 'pending',
    });
  }

  // Config write. In adopt mode the shared config is kept (and possibly replaced
  // by an --import-url download) instead of regenerating per-shell files.
  tasks.push({
    id: TASK_IDS.config,
    label: state.keepExistingConfig ? 'Keep existing Starship config' : 'Write config files',
    status: 'pending',
  });

  // RC files — one task per shell so a failure in one does not taint the others
  for (const shellId of state.selectedShells) {
    tasks.push({ id: rcTaskId(shellId), label: `Configure ${shellId}`, status: 'pending' });
  }

  // Post-install verification, skipped when starship was never installed.
  if (!state.skipStarshipInstall) {
    tasks.push({ id: TASK_IDS.verify, label: 'Verify config', status: 'pending' });
  }

  return tasks;
}

/** The final state runTask reports for a task, plus any extra fields to store. */
interface TaskOutcome {
  status: InstallStatus;
  patch?: Partial<InstallTask>;
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

  /**
   * Runs one task with a shared lifecycle, so every phase guards abort and
   * reports errors the same way. When the user has aborted, the unrun tasks are
   * marked failed and the work is never invoked. Returning undefined means the
   * task completed cleanly; otherwise the outcome carries the final status.
   */
  async function runTask(
    id: InstallTaskId,
    work: () => Promise<TaskOutcome | undefined> | TaskOutcome | undefined
  ): Promise<InstallStatus> {
    if (cancelled()) {
      markRemainingCancelled();
      return 'failed';
    }
    update(id, { status: 'running' });
    try {
      const outcome = await work();
      if (outcome) update(id, { status: outcome.status, ...outcome.patch });
      else update(id, { status: 'done' });
      return outcome?.status ?? 'done';
    } catch (err) {
      update(id, { status: 'failed', error: errorMessage(err) });
      return 'failed';
    }
  }

  // --- Starship (task omitted entirely when skipStarshipInstall) ---
  if (!state.skipStarshipInstall) {
    await runTask(TASK_IDS.starship, async () => {
      const check = await deps.isStarshipInstalled();
      if (check.installed) {
        return {
          status: 'skipped',
          patch: { label: `Starship (${check.version ?? 'installed'})` },
        };
      }
      await deps.installStarship(state.packageManager);
    });
  }

  // --- Nerd Font (only when a concrete font was chosen) ---
  const fontId = fontIdToInstall(state.nerdFontToInstall);
  let fontInstallFailed = false;
  if (fontId) {
    fontInstallFailed =
      (await runTask(TASK_IDS.font, async () => {
        // A cache note (e.g. "installed from cache") is shown as task detail.
        const note = await deps.installNerdFont(fontId);
        return note ? { status: 'done', patch: { note } } : undefined;
      })) === 'failed';
  }

  // --- Terminal font wiring (only when a concrete font was chosen) ---
  const terminalId = state.terminal;
  if (fontId && terminalId) {
    await runTask(TASK_IDS.terminal, async () => {
      // The config was generated glyph-free when the font install failed, so
      // wiring the terminal at a font that is not there would be a lie.
      if (fontInstallFailed) {
        return { status: 'skipped', patch: { note: 'font install failed' } };
      }
      const family = getFontFamily(fontId) ?? fontId;
      const result = deps.wireTerminalFont(terminalId, family);
      if (result.applied) {
        return {
          status: 'done',
          patch: { note: result.note ?? `set font in ${result.path}` },
        };
      }
      return { status: 'skipped', patch: { note: result.note ?? 'nothing to change' } };
    });
  }

  // --- Missing shells ---
  for (const shellId of state.selectedShells) {
    if (state.installedShells.includes(shellId)) continue;
    await runTask(shellTaskId(shellId), async () => {
      await deps.installShell(shellId, state.packageManager);
    });
  }

  // --- chsh ---
  const defaultShell = state.setDefaultShell;
  if (defaultShell) {
    await runTask(TASK_IDS.chsh, async () => {
      await deps.setDefaultShell(defaultShell);
    });
  }

  // --- Config: write per-shell starship configs, or adopt an existing one ---
  const configStatus = await runTask(TASK_IDS.config, async () => {
    if (state.selectedShells.length === 0) {
      throw new Error('No shells selected — nothing to configure');
    }

    if (state.keepExistingConfig) {
      // Adopt mode never regenerates: the shared starship.toml (whether already
      // present or fetched via --import-url) stays the prompt every shell reads.
      const notes: string[] = [];
      if (state.sharedConfigToml != null) {
        const written = deps.writeSharedConfig(state.sharedConfigToml);
        notes.push(
          written.backedUpTo
            ? `shared config saved to ${written.backedUpTo}`
            : 'wrote the imported config'
        );
      } else {
        // Point at what is already there; snapshot it so a re-run can restore it.
        try {
          const sharedBackup = deps.backupSharedConfig();
          if (sharedBackup) notes.push(`shared config saved to ${sharedBackup}`);
        } catch {
          // Non-fatal — the existing config is left untouched regardless.
        }
        notes.push('keeping the existing config untouched');
      }
      return { status: 'done', patch: { note: notes.join('; ') } };
    }

    // hasNerdFont is set optimistically when the user opts into an install. If
    // that install failed, generating with it still true would write a config
    // full of glyphs the terminal cannot render.
    const configState = fontInstallFailed ? { ...state, hasNerdFont: false } : state;
    const toml = deps.generateToml(configState);

    const notes: string[] = [];

    // Snapshot the shared starship.toml before per-shell configs shadow it, so a
    // re-run can restore the pre-wizard prompt. Best-effort: a backup failure
    // must not stop the config write.
    try {
      const sharedBackup = deps.backupSharedConfig();
      if (sharedBackup) notes.push(`shared config saved to ${sharedBackup}`);
    } catch {
      // Non-fatal — the install still proceeds with whatever protection exists.
    }

    for (const shellId of state.selectedShells) {
      const written = deps.writeShellConfig(toml, shellId);
      if (written?.backedUpTo) {
        notes.push(`${shellId}: previous config saved to ${written.backedUpTo}`);
      }
    }
    if (fontInstallFailed) notes.push('written without Nerd Font glyphs — the font install failed');

    return {
      status: 'done',
      patch: { note: notes.length > 0 ? notes.join('; ') : undefined },
    };
  });

  // --- Verify the config(s) this run wrote load under the real starship binary ---
  if (!state.skipStarshipInstall) {
    await runTask(TASK_IDS.verify, async () => {
      if (configStatus === 'failed') {
        return { status: 'skipped', patch: { note: 'no config was written' } };
      }
      if (!(await deps.isStarshipInstalled()).installed) {
        return { status: 'skipped', patch: { note: 'starship not on PATH' } };
      }
      let configPaths: string[];
      if (state.keepExistingConfig) {
        configPaths = state.sharedConfigToml != null ? [getSharedConfigPath()] : [];
      } else {
        configPaths = state.selectedShells.map((shellId) => getShellConfigPath(shellId));
      }
      if (configPaths.length === 0) {
        return { status: 'skipped', patch: { note: 'nothing written to verify' } };
      }
      for (const configPath of configPaths) await deps.verifyConfig(configPath);
      return { status: 'done', patch: { note: `verified ${configPaths.length} config(s)` } };
    });
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

    // The rc lines point at a per-shell config that was never written: wiring
    // the shell up anyway would init Starship against a config that does not
    // exist. Fail the rc step with the config error instead of running it.
    if (configStatus === 'failed') {
      const configTask = tasks.find((t) => t.id === TASK_IDS.config);
      update(taskId, {
        status: 'failed',
        error: configTask?.error ?? 'Config was not written',
      });
      continue;
    }

    await runTask(taskId, async () => {
      // Adopt mode omits the STARSHIP_CONFIG export so the shell reads the
      // shared config that was kept or imported.
      const result = deps.applyShellConfig(shellId, {
        ensurePathDir,
        pointAtSharedConfig: state.keepExistingConfig,
      });
      if (result.applied) return { status: 'done', patch: { note: result.note } };
      if (result.note) {
        // Not an error: the shell was already configured, or it needs manual
        // setup (nushell, powershell). Either way no rc file was written.
        return { status: 'skipped', patch: { note: result.note } };
      }
      throw new Error(`Unknown shell: ${shellId}`);
    });
  }

  // --- Reset leaked STARSHIP_CONFIG for shells not given their own config ---
  // Their rc must clear the variable at startup or they'd show a parent shell's
  // prompt. Skipped when Starship was never installed/configured.
  if (!state.skipStarshipInstall) {
    try {
      const starshipShells = await deps.getShellsUsingStarship();
      for (const shellId of starshipShells) {
        if (state.selectedShells.includes(shellId)) continue;
        if (cancelled()) break;
        deps.resetSharedShellConfig(shellId);
      }
    } catch {
      // Detection is best-effort; a failure must not fail the whole run.
    }
  }

  return tasks;
}
