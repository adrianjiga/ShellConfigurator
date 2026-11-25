import type { CliFlags } from '../../services/args.ts';
import { CliUsageError } from '../../services/errors.ts';
import { recordRunSafely } from '../../services/history.ts';
import {
  defaultRollbackRun,
  formatRollbackReport,
  formatRollbackRuns,
  planRollback,
  type RollbackReport,
  rollbackRunsWithManifests,
  runRollback,
} from '../../services/rollback.ts';
import {
  CapturedRunError,
  captureRun,
  interruptedRunCount,
  recoverInterruptedRuns,
} from '../../services/runCapture.ts';
import { confirmChanges, DEFAULT_PROMPT_IO, type PromptIo } from '../prompt.ts';

/**
 * Puts back the files a captured run changed: the newest run that still stands,
 * or the one --run names. Files changed again since are left alone. --list
 * shows the runs instead. Asks like uninstall; a failed file exits non-zero.
 */
export async function runRollbackCommand(
  flags: CliFlags,
  command: string,
  io: PromptIo = DEFAULT_PROMPT_IO
): Promise<void> {
  const readOnly = flags.list || flags.dryRun;
  if (!readOnly) recoverInterruptedRuns();
  const waiting = readOnly ? interruptedRunCount() : 0;
  const entries = rollbackRunsWithManifests();
  const runs = entries.map((entry) => entry.run);
  if (waiting > 0 && !flags.json) {
    process.stdout.write(
      `${waiting} interrupted run${waiting === 1 ? ' is' : 's are'} not listed yet; a rollback without --list or --dry-run records ${waiting === 1 ? 'it' : 'them'} first.\n`
    );
  }
  if (flags.list) {
    process.stdout.write(
      flags.json ? `${JSON.stringify(runs, null, 2)}\n` : formatRollbackRuns(runs)
    );
    return;
  }
  const target = flags.runId
    ? runs.find((run) => run.runId === flags.runId)
    : defaultRollbackRun(runs);
  if (flags.runId && !target) {
    throw new CliUsageError(
      `No recorded run '${flags.runId}' changed any files; see shell-configurator rollback --list.`
    );
  }
  const manifest = entries.find((entry) => entry.run === target)?.manifest;
  if (!target || !manifest) {
    const empty = {
      runId: null,
      actions: [],
      ok: true,
      complete: true,
      dryRun: flags.dryRun ?? false,
    };
    process.stdout.write(
      flags.json ? `${JSON.stringify(empty, null, 2)}\n` : 'Nothing to roll back.\n'
    );
    return;
  }

  const steps = planRollback(manifest);
  const dryRun = flags.dryRun ?? false;
  const changes = !dryRun && steps.some((step) => step.run);
  if (changes && target.interrupted && !flags.json) {
    process.stdout.write(
      'That run was interrupted, so its record was finished later: a change made to these files after the interruption is put back too.\n'
    );
  }
  if (changes) {
    const proceed = await confirmChanges(
      flags,
      io,
      'rollback rewrites files',
      () => formatRollbackReport(runRollback(target.runId, steps, { dryRun: true })),
      '\nRoll these back? [y/N] '
    );
    if (!proceed) return;
  }

  let captured: { result: RollbackReport; runId: string | null };
  try {
    captured = changes
      ? await captureRun(
          manifest.files.map((file) => file.path),
          async () => runRollback(target.runId, steps),
          {
            rewritable: manifest.files.filter((file) => file.rewritable).map((file) => file.path),
            record: { kind: 'rollback', command, rollbackOf: target.runId },
            recovered: true,
          }
        )
      : { result: runRollback(target.runId, steps, { dryRun }), runId: null };
  } catch (err) {
    if (!(err instanceof CapturedRunError)) throw err;
    recordRunSafely({
      kind: 'rollback',
      command,
      exitCode: 1,
      runId: err.runId,
      rollbackOf: target.runId,
      partial: true,
    });
    throw err.cause;
  }
  const { result: report, runId } = captured;
  const alreadyBack = !changes && !dryRun && report.complete && !target.rolledBack;
  process.stdout.write(
    flags.json ? `${JSON.stringify(report, null, 2)}\n` : formatRollbackReport(report)
  );
  if (alreadyBack && !flags.json) {
    process.stdout.write('\nEvery file is already back, so that run now counts as rolled back.\n');
  }
  if (!report.ok) process.exitCode = 1;
  if (changes || alreadyBack) {
    recordRunSafely({
      kind: 'rollback',
      command,
      exitCode: report.ok ? 0 : 1,
      runId,
      rollbackOf: target.runId,
      partial: !report.complete,
    });
  }
}
