import * as fs from 'node:fs';
import {
  type ApplyShellConfigOptions,
  applyShellConfig,
  backupSharedConfig,
  getSharedConfigPath,
  getShellConfigPath,
  resetSharedShellConfig,
  shellsWithStarshipInit,
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
import { recordStarshipVersion } from './cache.ts';
import { detectInstalledShellsAsync, isStarshipInstalledAsync } from './detector.ts';
import { errorMessage } from './errors.ts';
import { runCapture, runCaptureBoth } from './exec.ts';
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
  installStarship: (pm: PackageManager, signal?: AbortSignal) => Promise<void>;
  /** Records the starship version a fresh install produced, for drift. */
  recordStarshipVersion: (version: string) => void;
  installShell: (shellId: ShellId, pm: PackageManager, signal?: AbortSignal) => Promise<void>;
  setDefaultShell: (shellId: ShellId, signal?: AbortSignal) => Promise<void>;
  /** Installs a Nerd Font; resolves with a note when it came from the cache. */
  installNerdFont: (fontId: string, signal?: AbortSignal) => Promise<string | undefined>;
  generateToml: (state: WizardState) => string;
  writeShellConfig: (toml: string, shellId: ShellId) => WriteConfigResult;
  /** Writes the shared starship.toml in adopt mode (e.g. an --import-url fetch). */
  writeSharedConfig: (toml: string) => WriteConfigResult;
  /** Snapshots the shared starship.toml before per-shell configs shadow it. Null when none exists. */
  backupSharedConfig: () => string | null;
  sharedConfigExists: () => boolean;
  applyShellConfig: (
    shellId: ShellId,
    options?: ApplyShellConfigOptions
  ) => { applied: boolean; note?: string };
  resetSharedShellConfig: (shellId: ShellId) => { applied: boolean; note?: string };
  /** Installed shells whose rc loads Starship (possible STARSHIP_CONFIG inheritors). */
  getShellsUsingStarship: () => Promise<ShellId[]>;
  getMissingStarshipPathDir: () => string | null;
  /** Reads the version of a script install that PATH does not have yet. */
  readStarshipVersion: (pathDir: string) => Promise<string | null>;
  /** Rejects when starship cannot load the config at `configPath`. */
  verifyConfig: (configPath: string, pathDir?: string | null) => Promise<void>;
  /** Points the detected terminal at the installed Nerd Font family. */
  wireTerminalFont: (terminalId: TerminalId, family: string) => TerminalFontResult;
}

export const DEFAULT_INSTALL_TASK_DEPS: InstallTaskDeps = {
  isStarshipInstalled: isStarshipInstalledAsync,
  installStarship,
  recordStarshipVersion,
  installNerdFont,
  installShell,
  setDefaultShell,
  generateToml,
  writeShellConfig,
  writeSharedConfig,
  backupSharedConfig,
  sharedConfigExists: () => fs.existsSync(getSharedConfigPath()),
  applyShellConfig,
  resetSharedShellConfig,
  getShellsUsingStarship: async () => shellsWithStarshipInit(await detectInstalledShellsAsync()),
  getMissingStarshipPathDir,
  readStarshipVersion: async (pathDir) => {
    const env: Record<string, string | undefined> = { ...process.env };
    env.PATH = `${pathDir}${process.env.PATH ? `:${process.env.PATH}` : ''}`;
    try {
      return await runCapture('starship', ['-V'], { env });
    } catch {
      return null;
    }
  },
  verifyConfig: async (configPath, pathDir) => {
    const env: Record<string, string | undefined> = { ...process.env, STARSHIP_CONFIG: configPath };
    // A `script` install drops the binary in a dir the current process PATH may
    // not include yet; prepend it so verification resolves Starship regardless.
    if (pathDir) env.PATH = `${pathDir}${process.env.PATH ? `:${process.env.PATH}` : ''}`;
    const { stderr } = await runCaptureBoth('starship', ['print-config'], { env });
    if (stderr) throw new Error(stderr);
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

/** Task id for clearing a stale STARSHIP_CONFIG in a shell that is not being wired. */
export function resetTaskId(shellId: ShellId): `reset_${ShellId}` {
  return `reset_${shellId}`;
}

/** Task id for the install step of a given shell. */
export function shellTaskId(shellId: ShellId): `shell_${ShellId}` {
  return `shell_${shellId}`;
}

function resetLabel(shellId: ShellId): string {
  return `Clear old STARSHIP_CONFIG in ${shellId}`;
}

/**
 * Installed shells outside the selection whose rc already loads Starship: the
 * run adds an unset guard to each so a configured parent's STARSHIP_CONFIG
 * cannot leak into them.
 */
export function plannedResetShells(state: WizardState): ShellId[] {
  if (state.skipStarshipInstall) return [];
  return shellsWithStarshipInit(
    state.installedShells.filter((shellId) => !state.selectedShells.includes(shellId))
  );
}

export function buildTaskList(
  state: WizardState,
  resetShells: readonly ShellId[] = []
): InstallTask[] {
  const tasks: InstallTask[] = [];

  // Starship (skipped when the user chose "Continue without Starship")
  if (!state.skipStarshipInstall) {
    tasks.push({ id: TASK_IDS.starship, label: 'Starship', status: 'pending' });
  }

  // Nerd Font (only when a concrete font was chosen; skipped in containers,
  // where fonts belong to the host terminal, not the sandbox)
  const fontId = fontIdToInstall(state.nerdFontToInstall);
  if (fontId && !state.container) {
    tasks.push({ id: TASK_IDS.font, label: `Nerd Font (${fontLabel(fontId)})`, status: 'pending' });
  }

  // Terminal font wiring: only meaningful once a concrete font is being installed.
  if (fontId && state.terminal && !state.container) {
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

  // Set default shell (meaningless inside a container)
  if (state.setDefaultShell && !state.container) {
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
    for (const shellId of resetShells) {
      if (state.selectedShells.includes(shellId)) continue;
      tasks.push({ id: resetTaskId(shellId), label: resetLabel(shellId), status: 'pending' });
    }
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
  let resetShells: ShellId[] = [];
  if (!state.skipStarshipInstall && !signal?.aborted) {
    try {
      resetShells = (await deps.getShellsUsingStarship()).filter(
        (shellId) => !state.selectedShells.includes(shellId)
      );
    } catch {
      // Detection is best-effort; a failure must not fail the whole run.
    }
  }
  let tasks = buildTaskList(state, resetShells);
  for (const shellId of resetShells) {
    onUpdate(resetTaskId(shellId), { label: resetLabel(shellId), status: 'pending' });
  }

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
  let starshipInstallFailed = false;
  if (!state.skipStarshipInstall) {
    const status = await runTask(TASK_IDS.starship, async () => {
      const check = await deps.isStarshipInstalled();
      if (check.installed) {
        return {
          status: 'skipped',
          patch: { label: `Starship (${check.version ?? 'installed'})` },
        };
      }
      // An earlier script install off PATH still counts; the rc PATH line reaches it.
      const existingDir = deps.getMissingStarshipPathDir();
      if (existingDir) {
        const version = await deps.readStarshipVersion(existingDir);
        return {
          status: 'skipped',
          patch: {
            label: `Starship (${version ?? 'installed'})`,
            note: `already in ${existingDir}`,
          },
        };
      }
      await deps.installStarship(state.packageManager, signal);
      // Record what the fresh install produced, so the doctor can flag drift
      // when a later package-manager update moves starship under its nose.
      const after = await deps.isStarshipInstalled();
      const scriptDir = after.version ? null : deps.getMissingStarshipPathDir();
      const version =
        after.version ?? (scriptDir ? await deps.readStarshipVersion(scriptDir) : null);
      if (version) {
        // A read-only cache must not turn a successful install into a failure.
        try {
          deps.recordStarshipVersion(version);
        } catch {
          // Best-effort drift tracking.
        }
      }
    });
    starshipInstallFailed = status === 'failed';
  }

  // --- Nerd Font (only when a concrete font was chosen; skipped in containers) ---
  const fontId = fontIdToInstall(state.nerdFontToInstall);
  let fontInstallFailed = false;
  if (fontId && !state.container) {
    fontInstallFailed =
      (await runTask(TASK_IDS.font, async () => {
        // A cache note (e.g. "installed from cache") is shown as task detail.
        const note = await deps.installNerdFont(fontId, signal);
        return note ? { status: 'done', patch: { note } } : undefined;
      })) === 'failed';
  }

  // --- Terminal font wiring (only when a concrete font was chosen) ---
  const terminalId = state.terminal;
  if (fontId && terminalId && !state.container) {
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
  const shellInstallFailures = new Set<ShellId>();
  for (const shellId of state.selectedShells) {
    if (state.installedShells.includes(shellId)) continue;
    const status = await runTask(shellTaskId(shellId), async () => {
      await deps.installShell(shellId, state.packageManager, signal);
    });
    if (status === 'failed') shellInstallFailures.add(shellId);
  }

  // --- chsh (skipped in containers, where the login shell is the image's) ---
  const defaultShell = state.setDefaultShell;
  if (defaultShell && !state.container) {
    await runTask(TASK_IDS.chsh, async () => {
      if (shellInstallFailures.has(defaultShell)) {
        throw new Error(`Cannot set ${defaultShell} as the default shell — its install failed`);
      }
      await deps.setDefaultShell(defaultShell, signal);
    });
  }

  // --- Config: write per-shell starship configs, or adopt an existing one ---
  const configWritten = new Set<ShellId>();
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
      } else if (!deps.sharedConfigExists()) {
        notes.push(`no shared config at ${getSharedConfigPath()} — Starship will use its defaults`);
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

    const writeErrors: string[] = [];
    for (const shellId of state.selectedShells) {
      try {
        const written = deps.writeShellConfig(toml, shellId);
        configWritten.add(shellId);
        if (written?.backedUpTo) {
          notes.push(`${shellId}: previous config saved to ${written.backedUpTo}`);
        }
      } catch (err) {
        writeErrors.push(`${shellId}: ${errorMessage(err)}`);
      }
    }
    if (writeErrors.length > 0) throw new Error(writeErrors.join('; '));
    if (fontInstallFailed) notes.push('written without Nerd Font glyphs — the font install failed');

    return {
      status: 'done',
      patch: { note: notes.length > 0 ? notes.join('; ') : undefined },
    };
  });

  // --- Apply shell RC files (skipped until Starship is installed) ---
  // Checked once, after the install, so the rc lines can fix up PATH if the
  // script install put the binary somewhere the shell will not look.
  const ensurePathDir = state.skipStarshipInstall ? null : deps.getMissingStarshipPathDir();

  for (const shellId of state.selectedShells) {
    if (cancelled()) {
      markRemainingCancelled();
      break;
    }
    const taskId = rcTaskId(shellId);

    if (state.skipStarshipInstall) {
      update(taskId, {
        status: 'skipped',
        label: `Configure ${shellId} (skipped — install Starship first)`,
      });
      continue;
    }

    // Starship is not there to run, so wiring shells would produce
    // "command not found: starship" on every new terminal.
    if (starshipInstallFailed) {
      update(taskId, { status: 'failed', error: 'Starship was not installed' });
      continue;
    }

    if (shellInstallFailures.has(shellId)) {
      update(taskId, { status: 'failed', error: `Install of ${shellId} failed` });
      continue;
    }

    // The rc lines point at a per-shell config that was never written: wiring
    // the shell up anyway would init Starship against a config that does not
    // exist. Fail the rc step with the config error instead of running it.
    if (configStatus === 'failed' && !configWritten.has(shellId)) {
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

  // --- Verify the config(s) this run wrote load under the real starship binary ---
  // Runs after the rc steps so it matches the plan order: "post-install
  // verification" is the last thing that happens to the configs.
  if (!state.skipStarshipInstall) {
    await runTask(TASK_IDS.verify, async () => {
      if (configStatus === 'failed' && configWritten.size === 0) {
        return { status: 'skipped', patch: { note: 'no config was written' } };
      }
      const onPath = await deps.isStarshipInstalled();
      // A `script` install lands in a dir the current process PATH may not
      // include; resolve that dir so verification still runs instead of being
      // silently skipped the moment PATH is stale.
      const scriptDir = onPath.installed ? null : deps.getMissingStarshipPathDir();
      if (!onPath.installed && !scriptDir) {
        return { status: 'skipped', patch: { note: 'starship not on PATH' } };
      }
      let configPaths: string[];
      if (state.keepExistingConfig) {
        configPaths = state.sharedConfigToml != null ? [getSharedConfigPath()] : [];
      } else {
        configPaths = state.selectedShells
          .filter((shellId) => configWritten.has(shellId))
          .map((shellId) => getShellConfigPath(shellId));
      }
      if (configPaths.length === 0) {
        return { status: 'skipped', patch: { note: 'nothing written to verify' } };
      }
      const failures: string[] = [];
      for (const configPath of configPaths) {
        try {
          if (scriptDir) await deps.verifyConfig(configPath, scriptDir);
          else await deps.verifyConfig(configPath);
        } catch (err) {
          failures.push(`${configPath}: ${errorMessage(err)}`);
        }
      }
      if (failures.length > 0) throw new Error(failures.join('; '));
      const suffix = scriptDir ? ` (via ${scriptDir})` : '';
      return {
        status: 'done',
        patch: { note: `verified ${configPaths.length} config(s)${suffix}` },
      };
    });
  }

  // --- Reset leaked STARSHIP_CONFIG for shells not given their own config ---
  // Their rc must clear the variable at startup or they'd show a parent shell's
  // prompt. Each row is its own task so one unreadable rc cannot hide the rest.
  for (const shellId of resetShells) {
    await runTask(resetTaskId(shellId), async () => {
      const result = deps.resetSharedShellConfig(shellId);
      if (result.applied) return { status: 'done', patch: { note: result.note } };
      if (result.note) return { status: 'skipped', patch: { note: result.note } };
      return undefined;
    });
  }

  return tasks;
}
