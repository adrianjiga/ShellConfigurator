import { ORIGINAL_SUFFIX } from '../../generators/fileWrite.ts';
import type { CliFlags } from '../../services/args.ts';
import { CliUsageError } from '../../services/errors.ts';
import { recordRunSafely } from '../../services/history.ts';
import { CapturedRunError, captureRun, trackedFiles } from '../../services/runCapture.ts';
import { validateFlagValues } from '../../services/stateFlags.ts';
import {
  DEFAULT_UNINSTALL_DEPS,
  formatUninstallReport,
  planUninstall,
  runUninstall,
  type UninstallDeps,
  type UninstallReport,
} from '../../services/uninstall.ts';
import type { ShellId } from '../../types.ts';
import { confirmChanges, DEFAULT_PROMPT_IO, type PromptIo } from '../prompt.ts';

export interface UninstallIo extends PromptIo {
  deps: UninstallDeps;
}

const DEFAULT_UNINSTALL_IO: UninstallIo = { ...DEFAULT_PROMPT_IO, deps: DEFAULT_UNINSTALL_DEPS };

/**
 * Removes what the wizard set up. On a terminal it shows the plan and asks
 * first; elsewhere it needs --yes. A failed step exits non-zero.
 */
export async function runUninstallCommand(
  flags: CliFlags,
  command: string,
  io: UninstallIo = DEFAULT_UNINSTALL_IO
): Promise<void> {
  if (flags.font === 'none') {
    throw new CliUsageError('uninstall --font takes the Nerd Font to remove, not none.');
  }
  validateFlagValues(flags);

  const steps = await planUninstall(
    {
      ...(flags.shells ? { shells: [...new Set(flags.shells)] as ShellId[] } : {}),
      starship: flags.starship ?? false,
      ...(flags.font ? { fontId: flags.font } : {}),
    },
    io.deps
  );
  const dryRun = flags.dryRun ?? false;
  const changes = !dryRun && steps.some((step) => step.run);
  if (changes) {
    const preview = formatUninstallReport(await runUninstall(steps, { dryRun: true }));
    const proceed = await confirmChanges(
      flags,
      io,
      'uninstall removes files',
      () => preview,
      '\nRemove these? [y/N] '
    );
    if (!proceed) return;
  }

  let captured: { result: UninstallReport; runId: string | null; uncaptured: boolean };
  try {
    captured = changes
      ? await captureRun(
          trackedFiles(),
          (notCapturing) => runUninstall(steps, { keepConfigs: notCapturing }),
          { record: { kind: 'uninstall', command } }
        )
      : { result: await runUninstall(steps, { dryRun }), runId: null, uncaptured: false };
  } catch (err) {
    if (!(err instanceof CapturedRunError)) throw err;
    recordRunSafely({ kind: 'uninstall', command, exitCode: 1, runId: err.runId });
    throw err.cause;
  }
  const { result: report, runId, uncaptured } = captured;
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(formatUninstallReport(report));
    const deleted = report.actions
      .filter((a) => (a.id === 'starship' || a.id === 'font') && a.status === 'removed')
      .map((a) => a.title);
    if (runId) {
      process.stdout.write('\nUndo it with: shell-configurator rollback\n');
      if (deleted.length > 0) {
        process.stdout.write(
          `Rollback only puts files back: reinstall ${deleted.join(' and ')} with shell-configurator apply or doctor --fix.\n`
        );
      }
    } else if (uncaptured) {
      process.stdout.write(
        `\nThis run could not be recorded, so rollback cannot undo it. A file ShellConfigurator first changed while it held none of its lines has its content from then beside it as <file>${ORIGINAL_SUFFIX}; that copy predates any later edit.\n`
      );
    }
  }
  if (!report.ok) process.exitCode = 1;
  if (changes) {
    recordRunSafely({ kind: 'uninstall', command, exitCode: report.ok ? 0 : 1, runId });
  }
}
