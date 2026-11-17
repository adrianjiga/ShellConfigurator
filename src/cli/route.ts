import { type CliFlags, parseCliArgs, quoteArgv, SUBCOMMANDS } from '../services/args.ts';
import { CliUsageError } from '../services/errors.ts';
import { runApply } from '../services/headless.ts';
import { runDoctorCommand } from './commands/doctor.ts';
import { runGenerateCommand } from './commands/generate.ts';
import { runCompletionsCommand, runDebugInfoCommand, runListCommand } from './commands/info.ts';
import { runRollbackCommand } from './commands/rollback.ts';
import { runUninstallCommand } from './commands/uninstall.ts';
import { presentConfigFlags, refuseUnusedFlags } from './flagChecks.ts';
import { printHelp } from './help.ts';
import { VERSION } from './version.ts';

export function runGlobalFlags(flags: CliFlags): boolean {
  if (flags.help) {
    printHelp();
    return true;
  }
  if (flags.version) {
    process.stdout.write(`${VERSION}\n`);
    return true;
  }
  return false;
}

/**
 * Runs a headless subcommand (one of SUBCOMMANDS) to completion,
 * returning true when the flags targeted one so the Ink wizard is skipped
 * entirely. Errors propagate for the caller's fatal handler — headless runs
 * never render. `command` is the original invocation line, recorded for
 * reproducibility.
 */
export async function runHeadlessCommand(flags: CliFlags, command: string): Promise<boolean> {
  const repairs = flags.subcommand === 'doctor' && flags.fix;
  if (flags.includeWarnings && !repairs) {
    throw new CliUsageError('--include-warnings only applies to doctor --fix.');
  }
  if (
    flags.yes &&
    !repairs &&
    flags.subcommand !== 'uninstall' &&
    flags.subcommand !== 'rollback'
  ) {
    throw new CliUsageError('--yes only applies to doctor --fix, uninstall and rollback.');
  }
  if (flags.starship && flags.subcommand !== 'uninstall') {
    throw new CliUsageError('--starship only applies to uninstall.');
  }
  const timesPrompt = flags.subcommand === 'doctor' && flags.timings;
  if (flags.timings && flags.subcommand !== 'doctor') {
    throw new CliUsageError('--timings only applies to doctor.');
  }
  if (flags.configFile && !timesPrompt) {
    throw new CliUsageError('--config only applies to doctor --timings.');
  }
  if (timesPrompt && flags.fix) {
    throw new CliUsageError('--timings cannot be used with --fix.');
  }
  if (timesPrompt) {
    const building = [...(flags.stateFile ? ['--state'] : []), ...presentConfigFlags(flags)];
    if (building.length > 0) {
      throw new CliUsageError(
        `--timings times the config Starship loads here (or --config <file>), so ${building.join(', ')} cannot be used with it.`
      );
    }
  }
  if ((flags.list || flags.runId) && flags.subcommand !== 'rollback') {
    throw new CliUsageError(`${flags.list ? '--list' : '--run'} only applies to rollback.`);
  }
  if (flags.subcommand) refuseUnusedFlags(flags, flags.subcommand);
  if (flags.subcommand === 'rollback') {
    await runRollbackCommand(flags, command);
    return true;
  }
  if (flags.subcommand === 'debug-info') {
    await runDebugInfoCommand(flags);
    return true;
  }
  if (flags.subcommand === 'completions') {
    runCompletionsCommand(flags);
    return true;
  }
  if (flags.subcommand === 'list') {
    runListCommand(flags);
    return true;
  }
  if (flags.subcommand === 'uninstall') {
    await runUninstallCommand(flags, command);
    return true;
  }
  if (flags.subcommand === 'generate') {
    runGenerateCommand(flags);
    return true;
  }
  if (flags.subcommand === 'apply') {
    await runApply(flags, command);
    return true;
  }
  if (flags.subcommand === 'doctor') {
    await runDoctorCommand(flags, command);
    return true;
  }
  // No subcommand: the interactive wizard runs next — silently dropping
  // headless flags here would fake the run the user asked for.
  if (flags.adopt || flags.importUrl) {
    throw new CliUsageError(
      '--adopt and --import-url require the apply subcommand. ' +
        'Usage: shell-configurator apply --adopt --shells <id,...>'
    );
  }
  const dropped = presentConfigFlags(flags);
  if (flags.stateFile) dropped.push('--state');
  if (flags.json) dropped.push('--json');
  if (flags.fix) dropped.push('--fix');
  if (flags.markdown) dropped.push('--markdown');
  if (dropped.length > 0) {
    throw new CliUsageError(
      `${dropped.join(', ')} require a subcommand (${SUBCOMMANDS.join(', ')}).`
    );
  }
  return false;
}

/** Everything before the wizard: global flags, headless subcommands. */
export async function routeCli(argv: string[]): Promise<{ handled: boolean; flags: CliFlags }> {
  const flags: CliFlags = parseCliArgs(argv);
  if (runGlobalFlags(flags)) return { handled: true, flags };
  const handled = await runHeadlessCommand(flags, quoteArgv(argv));
  return { handled, flags };
}
