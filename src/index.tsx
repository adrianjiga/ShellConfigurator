#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { render } from 'ink';
import { App } from './app.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { restoreConfigBackups } from './generators/shellRc.ts';
import type { CliFlags } from './services/args.ts';
import { parseCliArgs, quoteArgv } from './services/args.ts';
import { formatDoctorReport, runDoctor } from './services/doctor.ts';
import { CliRunError, CliUsageError, errorMessage } from './services/errors.ts';
import { runApply, runGenerate, stateFromFlags } from './services/headless.ts';
import { appendHistory, writeSnapshot } from './services/history.ts';
import { formatRepairReport, runRepair } from './services/repair.ts';
import { restoreTty } from './services/tty.ts';
import type { InstallTask, WizardState } from './types.ts';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  .version as string;

let installFailed = false;

/** Records whether the install finished with any failed task. */
export function recordInstallOutcome(
  results: InstallTask[] | undefined,
  state?: WizardState
): void {
  installFailed = results?.some((t) => t.status === 'failed') ?? false;
  if (results && state) recordWizardInstall(results, state);
}

/**
 * Snapshots the run's state card and appends it to history.jsonl (P1.1). The
 * ledger is best-effort: a wizard that just installed must not die because the
 * history file could not be written. The snapshot id is the rollback handle #14
 * resolves later.
 */
function recordWizardInstall(results: InstallTask[], state: WizardState): void {
  const timestamp = new Date().toISOString();
  try {
    const snapshotId = writeSnapshot(state, timestamp);
    appendHistory({
      version: 1,
      timestamp,
      kind: 'install',
      snapshotId,
      results,
      exitCode: results.some((t) => t.status === 'failed') ? 1 : 0,
    });
  } catch (err) {
    process.stderr.write(`Warning: could not record this run in history: ${errorMessage(err)}\n`);
  }
}

/** Applies the recorded install outcome as the process exit code. */
export function applyInstallOutcomeExitCode(): void {
  if (installFailed) process.exitCode = 1;
}

/**
 * Ink puts the terminal in raw mode and hides the cursor; if the process dies
 * without unwinding that, the user's shell is left unusable.
 */
export function restoreTerminal(): void {
  restoreTty();
}

export function reportFatal(prefix: string, err: unknown): void {
  restoreTerminal();
  // User mistakes and run failures read clean — no stack. Usage errors are
  // exit 2; run failures are exit 1.
  if (err instanceof CliUsageError || err instanceof CliRunError) {
    process.stderr.write(`\nshell-configurator: ${err.message}\n`);
    process.exitCode = err instanceof CliUsageError ? 2 : 1;
    return;
  }
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`\n${prefix}: ${message}\n`);
  process.exitCode = 1;
}

function printHelp(): void {
  process.stdout.write(`shell-configurator ${VERSION}
Interactive terminal wizard for configuring Starship.

Usage:
  shell-configurator              start the wizard
  shell-configurator generate     render a starship.toml from flags
  shell-configurator apply        run a full install headlessly
  shell-configurator doctor       check an existing setup and report problems
  shell-configurator repair       fix the problems doctor finds
  shell-configurator --help       show this help
  shell-configurator --version    print the version
  shell-configurator --dry-run    preview changes without installing
  shell-configurator --restore    restore configs from their newest backup

Options:
  -h, --help          Show this help and exit
  -v, --version       Print the version and exit
  -d, --dry-run       Install nothing; print what would happen (generate still
                     writes -o/--export files)
  --no-install        Alias for --dry-run
  --restore, --undo   Copy the newest .bak-* snapshot back over the shared and
                     per-shell configs created by earlier wizard runs

  Flags may appear before or after the subcommand (e.g. "--dry-run generate"
  works like "generate --dry-run"); when a flag is repeated the last one wins.

generate options (the config — a versioned state card with --export):
  --preset <id>        Seed modules, palette and powerline from a preset
  --palette <id>       Override the colour palette
  --powerline, --no-powerline   Draw segments as interlocking coloured blocks
  --shells <id,...>    Shells to configure: zsh,bash,fish,nushell,powershell
  --font <none|font>   Nerd Font to install, or 'none' to skip fonts
  --has-nerd-font, --no-nerd-font   Already render Nerd Font glyphs (auto toggles with --font)
  --character <arrow|lambda|dollar> The prompt character symbol
  --set-default <shell>  Make a shell the login default
  --skip-starship      Do not install or require Starship
  -o, --output <file>  Write the TOML here instead of stdout
  --export <file>      Write the state card here (add -o to keep the TOML too)
  --import, --state <file>  Start from a saved state card instead of flags

apply options (a headless install from a state card):
  --state <file>       The state card describing the install (also: --import)
  --dry-run            Print the plan and generated config; change nothing
  --adopt              Keep the existing shared starship.toml instead of
                       regenerating it (per-shell files are never written)
  --import-url <url>   Fetch a starship.toml over the web and adopt it (implies --adopt)
  Without --state, apply also takes the generate options above; --shells is
  then required.

doctor options (checks the setup; exits non-zero when a check fails):
  --state <file>       Check the setup described by a saved state card
  --json               Print the report as JSON instead of the text summary
  --fix                Apply the available repairs, then re-check (like 'repair')

repair options (fixes the failing checks; exits non-zero when one still fails):
  --state <file>       Repair the setup described by a saved state card
  --dry-run            Print the fixes it would apply; change nothing
  --json               Print the report as JSON instead of the text summary
`);
}

/** Restore the shared and per-shell configs from their newest backups. */
export function runRestore(): void {
  const { restored, failed } = restoreConfigBackups();
  if (restored.length === 0 && failed.length === 0) {
    process.stdout.write('Nothing to restore — no ShellConfigurator backups found.\n');
    return;
  }
  if (restored.length > 0) {
    process.stdout.write('Restored configs from their newest backups:\n');
    for (const r of restored) {
      process.stdout.write(`  ${r.what}: ${r.restoredTo} (from ${r.restoredFrom})\n`);
    }
  }
  if (failed.length > 0) {
    process.stderr.write('Could not restore some configs:\n');
    for (const f of failed) {
      process.stderr.write(`  ${f.what} (from ${f.restoredFrom}): ${f.error}\n`);
    }
    process.exitCode = 1;
  }
}

export function runGlobalFlags(flags: CliFlags): boolean {
  if (flags.help) {
    printHelp();
    return true;
  }
  if (flags.version) {
    process.stdout.write(`${VERSION}\n`);
    return true;
  }
  if (flags.restore) {
    if (flags.subcommand) {
      throw new CliUsageError(
        `--restore cannot be combined with the ${flags.subcommand} subcommand; ` +
          'run it on its own.'
      );
    }
    if (flags.dryRun) {
      throw new CliUsageError(
        '--restore rewrites config files from their backups; it cannot run in a dry run.'
      );
    }
    runRestore();
    return true;
  }
  return false;
}

/** The config flags present on the command line, by the name shown to the user. */
function presentConfigFlags(flags: CliFlags): string[] {
  const present: string[] = [];
  if (flags.preset) present.push('--preset');
  if (flags.palette) present.push('--palette');
  if (flags.powerline !== undefined)
    present.push(flags.powerline ? '--powerline' : '--no-powerline');
  if (flags.shells) present.push('--shells');
  if (flags.font) present.push('--font');
  if (flags.hasNerdFont !== undefined)
    present.push(flags.hasNerdFont ? '--has-nerd-font' : '--no-nerd-font');
  if (flags.characterSymbol) present.push('--character');
  if (flags.setDefaultShell) present.push('--set-default');
  if (flags.skipStarship) present.push('--skip-starship');
  if (flags.adopt) present.push('--adopt');
  if (flags.importUrl) present.push('--import-url');
  if (flags.outputFile) present.push('-o/--output');
  if (flags.exportFile) present.push('--export');
  return present;
}

function warnIgnoredFlags(flags: CliFlags, subcommand: string): void {
  if (flags.stateFile) return;
  for (const flag of presentConfigFlags(flags)) {
    process.stderr.write(
      `shell-configurator: warning: ${flag} is ignored by ${subcommand} without --state\n`
    );
  }
}

/**
 * Runs the read-only health check. A failing check sets the process exit code
 * (so CI and scripts can gate on it) but never throws — the report is the
 * output. `--json` swaps the human summary for the report object, and `--fix`
 * upgrades the run into a repair.
 */
export async function runDoctorCommand(flags: CliFlags): Promise<void> {
  if (flags.fix) {
    await runRepairCommand(flags);
    return;
  }
  warnIgnoredFlags(flags, 'doctor');
  const state = flags.stateFile ? stateFromFlags(flags) : null;
  const report = await runDoctor(state);
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(formatDoctorReport(report));
  }
  if (!report.ok) process.exitCode = 1;
}

/** Runs the doctor's fixes, then re-checks; a still-failing check exits non-zero. */
export async function runRepairCommand(flags: CliFlags): Promise<void> {
  warnIgnoredFlags(flags, 'repair');
  const state = flags.stateFile ? stateFromFlags(flags) : null;
  const report = await runRepair(state, undefined, { dryRun: flags.dryRun });
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(formatRepairReport(report));
  }
  if (!report.ok) process.exitCode = 1;
}

/**
 * Runs a headless subcommand (`generate`, `apply` or `doctor`) to completion,
 * returning true when the flags targeted one so the Ink wizard is skipped
 * entirely. Errors propagate for the caller's fatal handler — headless runs
 * never render. `command` is the original invocation line, recorded for
 * reproducibility.
 */
export async function runHeadlessCommand(flags: CliFlags, command: string): Promise<boolean> {
  if (flags.subcommand === 'generate') {
    runGenerate(flags);
    return true;
  }
  if (flags.subcommand === 'apply') {
    await runApply(flags, command);
    return true;
  }
  if (flags.subcommand === 'doctor') {
    await runDoctorCommand(flags);
    return true;
  }
  if (flags.subcommand === 'repair') {
    await runRepairCommand(flags);
    return true;
  }
  // No subcommand: the interactive wizard runs next — silently dropping
  // headless flags here would fake the run the user asked for.
  if (flags.adopt || flags.importUrl) {
    throw new CliUsageError(
      '--adopt and --import-url require the apply subcommand. ' +
        'Usage: shell-configurator apply --adopt [--shells <id,...>]'
    );
  }
  const dropped = presentConfigFlags(flags);
  if (flags.stateFile) dropped.push('--state');
  if (flags.json) dropped.push('--json');
  if (flags.fix) dropped.push('--fix');
  if (dropped.length > 0) {
    throw new CliUsageError(
      `${dropped.join(', ')} require a subcommand (generate, apply, doctor or repair).`
    );
  }
  return false;
}

/** Reports the crash and exits immediately, so a dead process cannot hang on Ink's stdin. */
export function crash(prefix: string, err: unknown): void {
  reportFatal(prefix, err);
  process.exit(process.exitCode ?? 1);
}

process.on('uncaughtException', (err) => crash('ShellConfigurator crashed', err));
process.on('unhandledRejection', (err) => crash('ShellConfigurator crashed', err));

/** Everything before the wizard: global flags, headless subcommands. */
export async function routeCli(argv: string[]): Promise<{ handled: boolean; flags: CliFlags }> {
  const flags: CliFlags = parseCliArgs(argv);
  if (runGlobalFlags(flags)) return { handled: true, flags };
  const handled = await runHeadlessCommand(flags, quoteArgv(argv));
  return { handled, flags };
}

async function main(): Promise<void> {
  const { handled, flags } = await routeCli(process.argv.slice(2));
  if (handled) return;

  const app = render(
    <ErrorBoundary onError={(err) => reportFatal('ShellConfigurator hit a render error', err)}>
      <App dryRun={flags.dryRun ?? false} onInstallOutcome={recordInstallOutcome} />
    </ErrorBoundary>
  );

  await app.waitUntilExit();
  applyInstallOutcomeExitCode();
  restoreTerminal();
}

main().catch((err) => reportFatal('ShellConfigurator exited abnormally', err));
