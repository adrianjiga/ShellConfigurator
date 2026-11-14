#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { render } from 'ink';
import { App } from './app.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { posixShellQuote } from './config/shells.ts';
import { restoreConfigBackups } from './generators/shellRc.ts';
import type { CliFlags } from './services/args.ts';
import { parseCliArgs, quoteArgv } from './services/args.ts';
import { COMPLETION_SHELLS, type CompletionShell } from './services/cliSurface.ts';
import { completionScript } from './services/completions.ts';
import {
  collectDebugInfo,
  DEFAULT_DEBUG_INFO_DEPS,
  type DebugInfoDeps,
  formatDebugInfo,
  redactHome,
} from './services/debugInfo.ts';
import { formatDoctorReport, runDoctor } from './services/doctor.ts';
import { CliRunError, CliUsageError } from './services/errors.ts';
import { runApply, runGenerate, stateFromFlags, validateFlagValues } from './services/headless.ts';
import { lastRunShells, recordRunSafely } from './services/history.ts';
import { formatListing, listEntries } from './services/listings.ts';
import { formatRepairReport, runRepair } from './services/repair.ts';
import {
  defaultRollbackRun,
  formatRollbackReport,
  formatRollbackRuns,
  planRollback,
  rollbackRunsWithManifests,
  runRollback,
} from './services/rollback.ts';
import { captureRun, trackedFiles } from './services/runCapture.ts';
import { restoreTty } from './services/tty.ts';
import {
  DEFAULT_UNINSTALL_DEPS,
  formatUninstallReport,
  planUninstall,
  runUninstall,
  type UninstallDeps,
} from './services/uninstall.ts';
import type { InstallTask, ShellId, WizardState } from './types.ts';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  .version as string;

let installFailed = false;

/** Records whether the install finished with any failed task, and the run in history. */
export function recordInstallOutcome(
  results: InstallTask[] | undefined,
  state?: WizardState
): void {
  installFailed = results?.some((t) => t.status === 'failed') ?? false;
  if (results && state) {
    recordRunSafely({
      kind: 'install',
      state,
      results,
      exitCode: installFailed ? 1 : 0,
      runId: state.runId,
    });
  }
}

/** Applies the recorded install outcome as the process exit code. */
export function applyInstallOutcomeExitCode(): void {
  if (installFailed) process.exitCode = 1;
}

export function reportFatal(prefix: string, err: unknown): void {
  restoreTty();
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
  shell-configurator uninstall    remove what the wizard set up
  shell-configurator rollback     put back the files the last run changed
  shell-configurator debug-info   print a report of the setup to attach to a bug report
  shell-configurator completions <bash|zsh|fish>   print a shell completion script
  shell-configurator --help       show this help
  shell-configurator --version    print the version
  shell-configurator --dry-run    preview changes without installing
  shell-configurator --restore    restore configs from their newest backup
  shell-configurator --list-presets | --list-modules | --list-fonts [--json]
                                  list the ids those flags accept

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
  --fix                Apply the repairs for failing checks, then re-check (like 'repair')
  --include-warnings   With --fix, also apply the repairs warnings suggest

repair options (fixes the failing checks; exits non-zero when one still fails):
  --state <file>       Repair the setup described by a saved state card
  --dry-run            Print the fixes it would apply; change nothing
  --include-warnings   Also apply the fixes warnings suggest (e.g. the terminal font);
                       a warning may describe a choice you made on purpose
  --json               Print the report as JSON instead of the text summary

uninstall options (removes the Starship setup; asks before changing anything):
  --shells <id,...>    Only these shells (default: every shell it set up)
  --starship           Also remove Starship itself
  --font <font>        Also remove this Nerd Font
  -y, --yes            Go ahead without asking (required off a terminal)
  --dry-run            Print what it would remove; change nothing
  --json               Print the report as JSON instead of the text summary
  rc files and configs are backed up first, and rollback puts them back (not a
  removed Starship or font). Starship stays while any shell would still start it.

rollback options (undoes the newest run that changed files; asks first):
  --list               Show the runs that changed files, newest first
  --run <id>           Undo this run instead (an id from --list)
  -y, --yes            Go ahead without asking (required off a terminal)
  --dry-run            Print what it would put back; change nothing
  --json               Print the report (or the --list runs) as JSON
  A file changed again since that run is left alone. Rolling back again undoes
  the run before; rolling back a rollback redoes the run.

debug-info options (reads only; e.g. shell-configurator debug-info > issue.md):
  --json               Print the report data as JSON instead of Markdown
  Your home directory is shown as ~ so the report does not name you.

completions (install the script where your shell loads completions from):
  bash   shell-configurator completions bash > ~/.local/share/bash-completion/completions/shell-configurator
  zsh    shell-configurator completions zsh > "\${fpath[1]}/_shell-configurator"
  fish   shell-configurator completions fish > ~/.config/fish/completions/shell-configurator.fish
`);
}

/** Restore the shared and per-shell configs from their newest backups. */
export function runRestore(): void {
  const { restored, failed } = restoreConfigBackups(lastRunShells() ?? undefined);
  if (restored.length === 0 && failed.length === 0) {
    process.stdout.write('Nothing to restore — no ShellConfigurator backups found.\n');
    return;
  }
  if (restored.length > 0) {
    process.stdout.write('Restored configs from their newest backups:\n');
    for (const r of restored) {
      const saved = r.previousSavedTo ? `; previous saved to ${r.previousSavedTo}` : '';
      process.stdout.write(`  ${r.what}: ${r.restoredTo} (from ${r.restoredFrom}${saved})\n`);
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
  const lists = (
    [
      ['--list-presets', 'presets', flags.listPresets],
      ['--list-modules', 'modules', flags.listModules],
      ['--list-fonts', 'fonts', flags.listFonts],
    ] as const
  ).filter(([, , asked]) => asked);
  if (lists.length > 0) {
    const names = lists.map(([name]) => name).join(', ');
    if (flags.subcommand) {
      throw new CliUsageError(
        `${names} cannot be combined with the ${flags.subcommand} subcommand.`
      );
    }
    if (lists.length > 1) throw new CliUsageError(`Pass one of ${names} at a time.`);
    const entries = listEntries(lists[0]![1]);
    process.stdout.write(
      flags.json ? `${JSON.stringify(entries, null, 2)}\n` : formatListing(entries)
    );
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
  const report = await runRepair(state, undefined, {
    dryRun: flags.dryRun,
    includeWarnings: flags.includeWarnings,
  });
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(formatRepairReport(report));
  }
  if (!report.ok) process.exitCode = 1;
}

async function askToProceed(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(question)).trim());
  } finally {
    rl.close();
  }
}

export interface PromptIo {
  confirm: (question: string) => Promise<boolean>;
  isTerminal: () => boolean;
}

export interface UninstallIo extends PromptIo {
  deps: UninstallDeps;
}

const DEFAULT_PROMPT_IO: PromptIo = {
  confirm: askToProceed,
  isTerminal: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
};

const DEFAULT_UNINSTALL_IO: UninstallIo = { ...DEFAULT_PROMPT_IO, deps: DEFAULT_UNINSTALL_DEPS };

/**
 * Whether a command that changes files may go ahead: --yes says so, a terminal
 * user is shown the plan and asked, and anything else is refused.
 */
async function confirmChanges(
  flags: CliFlags,
  io: PromptIo,
  refusal: string,
  plan: () => string,
  question: string
): Promise<boolean> {
  if (flags.yes) return true;
  if (flags.json || !io.isTerminal()) {
    throw new CliUsageError(`${refusal}; pass --yes to go ahead, or --dry-run to see the plan.`);
  }
  process.stdout.write(plan());
  if (await io.confirm(question)) return true;
  process.stdout.write('Nothing was changed.\n');
  return false;
}

/**
 * Removes what the wizard set up. On a terminal it shows the plan and asks
 * first; elsewhere it needs --yes. A failed step exits non-zero.
 */
export async function runUninstallCommand(
  flags: CliFlags,
  command: string,
  io: UninstallIo = DEFAULT_UNINSTALL_IO
): Promise<void> {
  const unused = presentConfigFlags(flags).filter((f) => f !== '--shells' && f !== '--font');
  if (flags.stateFile) unused.push('--state');
  if (flags.fix) unused.push('--fix');
  if (unused.length > 0) {
    throw new CliUsageError(`${unused.join(', ')} cannot be used with uninstall.`);
  }
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

  const { result: report, runId } = changes
    ? await captureRun(trackedFiles(), () => runUninstall(steps))
    : { result: await runUninstall(steps, { dryRun }), runId: null };
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(formatUninstallReport(report));
    const backups = report.actions.flatMap((a) => (a.backup ? [a.backup] : []));
    const deleted = report.actions
      .filter((a) => (a.id === 'starship' || a.id === 'font') && a.status === 'removed')
      .map((a) => a.title);
    if (runId) {
      process.stdout.write('\nUndo it with: shell-configurator rollback\n');
      if (deleted.length > 0) {
        process.stdout.write(
          `Rollback only puts files back: reinstall ${deleted.join(' and ')} with shell-configurator apply or repair.\n`
        );
      }
    } else if (backups.length > 0) {
      process.stdout.write('\nTo undo, copy the backups back:\n');
      for (const { file, backup } of backups) {
        process.stdout.write(`  cp ${posixShellQuote(backup)} ${posixShellQuote(file)}\n`);
      }
    }
  }
  if (!report.ok) process.exitCode = 1;
  if (changes) {
    recordRunSafely({ kind: 'uninstall', command, exitCode: report.ok ? 0 : 1, runId });
  }
}

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
  const unused = presentConfigFlags(flags);
  if (flags.stateFile) unused.push('--state');
  if (flags.fix) unused.push('--fix');
  if (unused.length > 0) {
    throw new CliUsageError(`${unused.join(', ')} cannot be used with rollback.`);
  }

  const entries = rollbackRunsWithManifests();
  const runs = entries.map((entry) => entry.run);
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

  const { result: report, runId } = changes
    ? await captureRun(
        manifest.files.map((file) => file.path),
        async () => runRollback(target.runId, steps)
      )
    : { result: runRollback(target.runId, steps, { dryRun }), runId: null };
  process.stdout.write(
    flags.json ? `${JSON.stringify(report, null, 2)}\n` : formatRollbackReport(report)
  );
  if (!report.ok) process.exitCode = 1;
  if (changes) {
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

/** Prints the completion script for the shell named after `completions`. */
export function runCompletionsCommand(flags: CliFlags): void {
  const unused = presentConfigFlags(flags);
  if (flags.stateFile) unused.push('--state');
  if (flags.json) unused.push('--json');
  if (flags.dryRun) unused.push('--dry-run');
  if (flags.fix) unused.push('--fix');
  if (unused.length > 0) {
    throw new CliUsageError(`${unused.join(', ')} cannot be used with completions.`);
  }
  const shell = flags.completionShell;
  if (!COMPLETION_SHELLS.includes(shell as CompletionShell)) {
    throw new CliUsageError(
      shell
        ? `No completions for '${shell}' (available: ${COMPLETION_SHELLS.join(', ')}).`
        : `completions needs a shell: ${COMPLETION_SHELLS.join(', ')}.`
    );
  }
  process.stdout.write(completionScript(shell as CompletionShell));
}

/** Prints the debug report (Markdown, or JSON with --json) with the home directory shown as `~`. */
export async function runDebugInfoCommand(
  flags: CliFlags,
  deps: DebugInfoDeps = DEFAULT_DEBUG_INFO_DEPS
): Promise<void> {
  const unused = presentConfigFlags(flags);
  if (flags.stateFile) unused.push('--state');
  if (flags.fix) unused.push('--fix');
  if (flags.dryRun) unused.push('--dry-run');
  if (unused.length > 0) {
    throw new CliUsageError(`${unused.join(', ')} cannot be used with debug-info.`);
  }
  const info = await collectDebugInfo(VERSION, deps);
  process.stdout.write(
    flags.json ? redactHome(`${JSON.stringify(info, null, 2)}\n`) : formatDebugInfo(info)
  );
}

/**
 * Runs a headless subcommand (`generate`, `apply`, `doctor`, `repair`, `uninstall`, `rollback` or `debug-info`) to completion,
 * returning true when the flags targeted one so the Ink wizard is skipped
 * entirely. Errors propagate for the caller's fatal handler — headless runs
 * never render. `command` is the original invocation line, recorded for
 * reproducibility.
 */
export async function runHeadlessCommand(flags: CliFlags, command: string): Promise<boolean> {
  const repairs = flags.subcommand === 'repair' || (flags.subcommand === 'doctor' && flags.fix);
  if (flags.includeWarnings && !repairs) {
    throw new CliUsageError('--include-warnings only applies to repair (or doctor --fix).');
  }
  if (flags.yes && flags.subcommand !== 'uninstall' && flags.subcommand !== 'rollback') {
    throw new CliUsageError('--yes only applies to uninstall and rollback.');
  }
  if (flags.starship && flags.subcommand !== 'uninstall') {
    throw new CliUsageError('--starship only applies to uninstall.');
  }
  if ((flags.list || flags.runId) && flags.subcommand !== 'rollback') {
    throw new CliUsageError(`${flags.list ? '--list' : '--run'} only applies to rollback.`);
  }
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
  if (flags.subcommand === 'uninstall') {
    await runUninstallCommand(flags, command);
    return true;
  }
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
        'Usage: shell-configurator apply --adopt --shells <id,...>'
    );
  }
  const dropped = presentConfigFlags(flags);
  if (flags.stateFile) dropped.push('--state');
  if (flags.json) dropped.push('--json');
  if (flags.fix) dropped.push('--fix');
  if (dropped.length > 0) {
    throw new CliUsageError(
      `${dropped.join(', ')} require a subcommand (generate, apply, doctor, repair, uninstall, rollback, debug-info or completions).`
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
    <ErrorBoundary
      onError={(err) => {
        reportFatal('ShellConfigurator hit a render error', err);
        // Leave the message on screen and exit instead of waiting for Ctrl+C.
        setImmediate(() => app.unmount());
      }}
    >
      <App dryRun={flags.dryRun ?? false} onInstallOutcome={recordInstallOutcome} />
    </ErrorBoundary>,
    // Ctrl+C during the install must cancel it, not leave it running unseen.
    { exitOnCtrlC: false }
  );

  await app.waitUntilExit();
  applyInstallOutcomeExitCode();
  restoreTty();
}

main().catch((err) => reportFatal('ShellConfigurator exited abnormally', err));
