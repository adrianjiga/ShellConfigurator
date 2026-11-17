import { PRESETS } from '../config/presets.ts';
import type { InstallTask, WizardState } from '../types.ts';
import {
  dryRunPlan,
  printChanges,
  printManualSetup,
  printTasks,
  showControlCharacters,
} from './applyReport.ts';
import type { CliFlags } from './args.ts';
import { cancelOnSignals, signalExitCode } from './cancel.ts';
import {
  detectContainerAsync,
  detectInstalledShellsAsync,
  detectPackageManagerAsync,
  detectRemoteSessionAsync,
  detectTerminalAsync,
  findStarshipAsync,
} from './detector.ts';
import { CliUsageError, errorMessage } from './errors.ts';
import { recordRunSafely } from './history.ts';
import { customCommands, fetchImportedConfig } from './importConfig.ts';
import { NERD_FONTS } from './installer.ts';
import {
  buildTaskList,
  DEFAULT_INSTALL_TASK_DEPS,
  FONT_FALLBACK_NOTE,
  plannedResetShells,
  runInstallTasks,
} from './installTasks.ts';
import { CapturedRunError, captureRun, trackedFiles } from './runCapture.ts';
import { stateFromFlags } from './stateFlags.ts';
import { whatChangedPath, writeWhatChangedSafely } from './whatChanged.ts';

/**
 * Fills the runtime fields `apply` needs that `stateFromFlags` leaves defaulted:
 * which shells are installed, and which package manager installs should use.
 */
async function prepareApplyState(flags: CliFlags): Promise<WizardState> {
  const preset = PRESETS.find((p) => p.id === flags.preset);
  if (
    preset?.requiresNerdFont &&
    flags.hasNerdFont === undefined &&
    flags.font === undefined &&
    !flags.stateFile &&
    !flags.adopt &&
    !flags.importUrl
  ) {
    throw new CliUsageError(
      `The ${preset.id} preset draws Nerd Font icons. Pass --font <id> to install a Nerd Font ` +
        `(${NERD_FONTS.map((font) => font.id).join(', ')}), --has-nerd-font when the terminal ` +
        'already shows them, or --no-nerd-font for a version without icons.'
    );
  }
  let state = stateFromFlags(flags);

  if (state.selectedShells.length === 0) {
    throw new CliUsageError(
      'apply configures at least one shell, but none are selected. ' +
        'Pass --shells <id,...> or a --state card that selects shells.'
    );
  }

  if (flags.importUrl) {
    const toml = await fetchImportedConfig(flags.importUrl);
    const commands = customCommands(toml);
    if (commands.length > 0) {
      process.stderr.write(
        `shell-configurator: these lines of the imported config may run commands on every prompt; check them:\n${commands
          .map((command) => `  ${showControlCharacters(command)}`)
          .join('\n')}\n`
      );
    }
    state = { ...state, keepExistingConfig: true, sharedConfigToml: toml };
  }
  const [installedShells, packageManager, container, terminal, remoteSession] = await Promise.all([
    detectInstalledShellsAsync(),
    detectPackageManagerAsync(),
    detectContainerAsync(),
    detectTerminalAsync(),
    detectRemoteSessionAsync(),
  ]);
  return { ...state, installedShells, packageManager, container, terminal, remoteSession };
}

function interruptedTasks(tasks: InstallTask[], error: unknown): InstallTask[] {
  return tasks.map((task) =>
    task.status === 'pending' || task.status === 'running'
      ? { ...task, status: 'failed', error: errorMessage(error) }
      : task
  );
}

/**
 * The full `apply` subcommand: headless run of the same install pipeline the
 * wizard drives. `--dry-run` prints the task plan and the TOML that would be
 * written without touching the system; a real run records itself in history.
 * `command` is the original invocation line stored for reproducibility.
 */
export async function runApply(flags: CliFlags, command?: string): Promise<void> {
  if (flags.json && !flags.dryRun) {
    throw new CliUsageError(
      'apply --json only prints a plan, with --dry-run; a real apply reports its tasks as text.'
    );
  }
  const state = await prepareApplyState(flags);

  const resetShells = plannedResetShells(state);
  const tasks = buildTaskList(state, resetShells);

  if (flags.dryRun) {
    const starshipInstalled = !state.skipStarshipInstall && (await findStarshipAsync()).installed;
    const plan = dryRunPlan(state, tasks, resetShells, starshipInstalled);
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
      return;
    }
    process.stdout.write('shell-configurator apply (dry run) — nothing will be changed.\n\n');
    process.stdout.write(
      `Targets: ${plan.shells.join(', ') || '(none)'} · ` +
        `${plan.installStarship ? 'will install Starship' : starshipInstalled ? 'Starship is already installed' : 'will skip Starship'}\n`
    );
    printTasks(plan.tasks);
    printManualSetup(state);
    const config = plan.config;
    if (config.kind === 'per-shell') {
      process.stdout.write(`\nGenerated starship.toml:\n\n${config.toml}`);
      if (config.tomlIfFontFails) process.stdout.write(`\n\n${FONT_FALLBACK_NOTE}\n`);
    } else if (config.kind === 'imported') {
      process.stdout.write('\nConfig to keep (no per-shell TOML is generated):\n\n');
      const shown = showControlCharacters(config.toml);
      process.stdout.write(shown.endsWith('\n') ? shown : `${shown}\n`);
    } else {
      process.stdout.write(
        config.exists
          ? `\nConfig to keep: ${config.path} (left untouched)\n`
          : `\nNo config to keep yet: ${config.path} does not exist, and a real run would leave that as is.\n`
      );
    }
    printChanges(plan);
    return;
  }

  let progress = tasks;
  let finished: InstallTask[] | undefined;
  let summary: string | null = null;
  const onUpdate = (id: string, patch: Partial<InstallTask>) => {
    progress = progress.some((task) => task.id === id)
      ? progress.map((task) => (task.id === id ? { ...task, ...patch } : task))
      : [...progress, { id: id as InstallTask['id'], label: id, status: 'pending', ...patch }];
  };
  let captured: { result: InstallTask[]; runId: string | null };
  const controller = new AbortController();
  const { stop: stopListening } = cancelOnSignals(controller, () =>
    process.stderr.write(
      '\nCancelling: the step that is running finishes first (press Ctrl+C again to quit now).\n'
    )
  );
  try {
    captured = await captureRun(
      [...trackedFiles(), whatChangedPath()],
      async () => {
        finished = await runInstallTasks(
          state,
          DEFAULT_INSTALL_TASK_DEPS,
          onUpdate,
          controller.signal
        );
        return finished;
      },
      {
        rewritable: [whatChangedPath()],
        record: { kind: 'apply', state, ...(command ? { command } : {}) },
        onChanged: (runId, files, error) => {
          summary = writeWhatChangedSafely({
            kind: 'apply',
            timestamp: new Date().toISOString(),
            state,
            results: finished ?? interruptedTasks(progress, error),
            runId,
            files,
            ...(command ? { command } : {}),
          });
        },
      }
    );
  } catch (err) {
    stopListening();
    if (!(err instanceof CapturedRunError)) throw err;
    recordRunSafely({ kind: 'apply', state, command, exitCode: 1, runId: err.runId });
    if (summary) process.stdout.write(`What changed, and how to undo it: ${summary}\n`);
    throw err.cause;
  }
  const cancelledBy = stopListening();
  const { result: results, runId } = captured;
  const failed = results.some((t) => t.status === 'failed');
  printTasks(results);
  printManualSetup(state);

  const exitCode = cancelledBy ? signalExitCode(cancelledBy) : failed ? 1 : 0;
  if (exitCode !== 0) process.exitCode = exitCode;

  recordRunSafely({ kind: 'apply', state, command, results, exitCode, runId });

  if (cancelledBy && runId) {
    process.stdout.write('\nCancelled. Undo what it changed with: shell-configurator rollback\n');
  }
  if (summary) process.stdout.write(`\nWhat changed, and how to undo it: ${summary}\n`);
}
