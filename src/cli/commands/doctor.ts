import { readFileSync } from 'node:fs';
import type { CliFlags } from '../../services/args.ts';
import { formatDoctorReport, runDoctor } from '../../services/doctor.ts';
import { CliUsageError, errorMessage } from '../../services/errors.ts';
import { recordRunSafely } from '../../services/history.ts';
import {
  DEFAULT_REPAIR_DEPS,
  formatRepairReport,
  type RepairDeps,
  type RepairReport,
  runRepair,
} from '../../services/repair.ts';
import { CapturedRunError, captureRun, trackedFiles } from '../../services/runCapture.ts';
import {
  type ActiveConfig,
  activeStarshipConfig,
  DEFAULT_PROBE_DEPS,
  formatTimings,
  type ProbeDeps,
  type TimingsReport,
  timePrompt,
} from '../../services/starshipProbe.ts';
import { stateFromFlags } from '../../services/stateFlags.ts';
import { warnIgnoredFlags } from '../flagChecks.ts';
import { confirmChanges, DEFAULT_PROMPT_IO, type PromptIo } from '../prompt.ts';

/**
 * Runs the read-only health check. A failing check sets the process exit code
 * (so CI and scripts can gate on it) but never throws — the report is the
 * output. `--json` swaps the human summary for the report object, and `--fix`
 * applies the fixes it finds.
 */
export async function runDoctorCommand(
  flags: CliFlags,
  command: string,
  io: PromptIo = DEFAULT_PROMPT_IO,
  probeDeps: ProbeDeps = DEFAULT_PROBE_DEPS
): Promise<void> {
  if (flags.fix) {
    await runRepairCommand(flags, command, io);
    return;
  }
  warnIgnoredFlags(flags, 'doctor');
  const state = flags.stateFile ? stateFromFlags(flags) : null;
  const source = flags.timings ? timingSource(flags.configFile) : null;
  const [report, timings] = await Promise.all([
    runDoctor(state),
    source ? timeSource(source, probeDeps) : undefined,
  ]);
  if (flags.json) {
    const data = timings ? { ...report, timings } : report;
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  } else {
    process.stdout.write(formatDoctorReport(report));
    if (timings && 'error' in timings) {
      process.stdout.write(`\nCould not time the prompt: ${timings.error}\n`);
    } else if (timings) {
      process.stdout.write(`\n${formatTimings(timings, timings.config)}`);
    }
  }
  if (!report.ok || (timings && 'error' in timings)) process.exitCode = 1;
}

export async function runRepairCommand(
  flags: CliFlags,
  command: string,
  io: PromptIo = DEFAULT_PROMPT_IO,
  deps: RepairDeps = DEFAULT_REPAIR_DEPS
): Promise<void> {
  warnIgnoredFlags(flags, 'doctor --fix');
  const state = flags.stateFile ? stateFromFlags(flags) : null;
  const options = { includeWarnings: flags.includeWarnings };
  const plan = await runRepair(state, deps, { ...options, dryRun: true });
  const changes = !flags.dryRun && plan.actions.length > 0;
  if (changes) {
    const proceed = await confirmChanges(
      flags,
      io,
      'doctor --fix changes files and may install software',
      () => formatRepairReport(plan),
      '\nApply these fixes? [y/N] '
    );
    if (!proceed) return;
  }

  const record = (exitCode: number, runId: string | null) =>
    recordRunSafely({ kind: 'repair', command, exitCode, runId, ...(state ? { state } : {}) });
  let captured: { result: RepairReport; runId: string | null };
  try {
    captured = changes
      ? await captureRun(
          trackedFiles(),
          () => runRepair(state, deps, { ...options, before: plan.before }),
          { record: { kind: 'repair', command, ...(state ? { state } : {}) } }
        )
      : { result: { ...plan, dryRun: flags.dryRun ?? false }, runId: null };
  } catch (err) {
    if (!(err instanceof CapturedRunError)) throw err;
    record(1, err.runId);
    throw err.cause;
  }
  const { result: report, runId } = captured;
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(formatRepairReport(report));
    if (runId) process.stdout.write('\nUndo it with: shell-configurator rollback\n');
  }
  if (!report.ok) process.exitCode = 1;
  if (changes) record(report.ok ? 0 : 1, runId);
}

export interface PromptTimings extends TimingsReport {
  config: string;
}

interface TimingSource {
  source: { toml: string; path?: string };
  config: string;
}

/** The config Starship loads in this folder, or `configFile`; a file it cannot read is a usage error. */
function timingSource(configFile: string | undefined): TimingSource {
  const active: ActiveConfig = configFile
    ? { kind: 'file', path: configFile }
    : activeStarshipConfig();
  let source: { toml: string; path?: string };
  let config: string;
  if (active.kind === 'file') {
    try {
      source = { toml: readFileSync(active.path, 'utf8'), path: active.path };
    } catch (err) {
      throw new CliUsageError(`Could not read '${active.path}': ${errorMessage(err)}`);
    }
    config = active.path;
  } else {
    source = { toml: '', path: active.path };
    config = `Starship's built-in default prompt, since ${active.reason}`;
  }
  return { source, config };
}

async function timeSource(
  { source, config }: TimingSource,
  deps: ProbeDeps
): Promise<PromptTimings | { error: string }> {
  try {
    return { config, ...(await timePrompt(source, process.cwd(), deps)) };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}
