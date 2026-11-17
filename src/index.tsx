#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { render } from 'ink';
import { App } from './app.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { getSharedConfigPath, ORIGINAL_SUFFIX, writeFileAtomic } from './generators/shellRc.ts';
import type { CliFlags, Subcommand } from './services/args.ts';
import { parseCliArgs, quoteArgv, SUBCOMMANDS } from './services/args.ts';
import {
  COMPLETION_SHELLS,
  type CompletionShell,
  LIST_KINDS,
  type ListKind,
  SUBCOMMAND_INFO,
} from './services/cliSurface.ts';
import { completionScript } from './services/completions.ts';
import {
  collectDebugInfo,
  DEFAULT_DEBUG_INFO_DEPS,
  type DebugInfoDeps,
  formatDebugInfo,
} from './services/debugInfo.ts';
import { formatDoctorReport, runDoctor } from './services/doctor.ts';
import { CliRunError, CliUsageError, errorMessage } from './services/errors.ts';
import { runApply, runGenerate, stateFromFlags, validateFlagValues } from './services/headless.ts';
import { recordRunSafely } from './services/history.ts';
import { formatListing, listEntries } from './services/listings.ts';
import { redactPersonal } from './services/redact.ts';
import {
  DEFAULT_REPAIR_DEPS,
  formatRepairReport,
  type RepairDeps,
  type RepairReport,
  runRepair,
} from './services/repair.ts';
import {
  defaultRollbackRun,
  formatRollbackReport,
  formatRollbackRuns,
  planRollback,
  rollbackRunsWithManifests,
  runRollback,
} from './services/rollback.ts';
import {
  CapturedRunError,
  captureRun,
  interruptedRunCount,
  recoverInterruptedRuns,
  trackedFiles,
} from './services/runCapture.ts';
import { renderShare } from './services/share.ts';
import {
  type ActiveConfig,
  activeStarshipConfig,
  DEFAULT_PROBE_DEPS,
  formatTimings,
  type ProbeDeps,
  type TimingsReport,
  timePrompt,
} from './services/starshipProbe.ts';
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
  const message = redactPersonal(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.stderr.write(`\n${prefix}: ${message}\n`);
  process.exitCode = 1;
}

function printHelp(): void {
  process.stdout.write(`shell-configurator ${VERSION}
Interactive terminal wizard for configuring Starship.

Usage:
  shell-configurator              start the wizard
  shell-configurator generate     render a starship.toml from flags (--markdown to share it)
  shell-configurator apply        run a full install headlessly
  shell-configurator doctor       check the setup; --fix repairs it, --timings times the prompt
  shell-configurator uninstall    remove what the wizard set up
  shell-configurator rollback     put back the files the last run changed
  shell-configurator debug-info   print a report of the setup to attach to a bug report
  shell-configurator list <presets|modules|fonts>  list the ids the flags accept (--json for data)
  shell-configurator completions <bash|zsh|fish>   print a shell completion script
  shell-configurator --help       show this help
  shell-configurator --version    print the version
  shell-configurator --dry-run    preview changes without installing

Options:
  -h, --help          Show this help and exit
  -v, --version       Print the version and exit
  -d, --dry-run       Install nothing; print what would happen (generate still
                     writes -o/--export files)
  --no-install        Alias for --dry-run

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
  --markdown           Print the prompt as Markdown to share, with the card that
                       rebuilds it (-o writes it to a file). The card has no shells
                       or font install of this machine; whoever uses it adds
                       --shells (and --font) to apply.

apply options (a headless install from a state card):
  --state <file>       The state card describing the install (also: --import)
  --dry-run            Print the plan, the generated config and a diff of each
                       file it would change; change nothing
  --adopt              Keep the existing shared starship.toml instead of
                       regenerating it (per-shell files are never written)
  --import-url <url>   Fetch a starship.toml over the web and adopt it (implies --adopt)
  --json               With --dry-run, print the plan, config and diffs as JSON
  Without --state, apply also takes the generate options above except -o and
  --export; --shells is then required.

doctor options (checks the setup; exits non-zero when a check fails):
  --state <file>       Check the setup described by a saved state card
  --json               Print the report as JSON instead of the text summary
  --fix                Apply the fixes for failing checks after asking, then re-check;
                       exits non-zero when one still fails
  --include-warnings   With --fix, also apply the fixes warnings suggest (e.g. the
                       terminal font); a warning may describe a choice you made on purpose
  -y, --yes            With --fix, go ahead without asking (required off a terminal)
  --dry-run            With --fix, print the fixes it would apply; change nothing
  --timings            Also time each prompt module in the current folder and suggest
                       fixes for slow ones: the config Starship loads here
                       ($STARSHIP_CONFIG, else ~/.config/starship.toml, else its
                       built-in default). Modules run in parallel, so the prompt is
                       about as slow as its slowest one.
  --config <file>      With --timings, time this starship.toml instead
  Without --state it checks the shells that were set up, not every installed one.
  rollback puts back the files --fix changed (not a reinstalled Starship or font).

uninstall options (removes the Starship setup; asks before changing anything):
  --shells <id,...>    Only these shells (default: every shell it set up)
  --starship           Also remove Starship itself
  --font <font>        Also remove this Nerd Font
  -y, --yes            Go ahead without asking (required off a terminal)
  --dry-run            Print what it would remove; change nothing
  --json               Print the report as JSON instead of the text summary
  rollback puts the files back (not a removed Starship or font). Starship stays
  while any shell would still start it.

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
  if (flags.outputFile) present.push('--output');
  if (flags.exportFile) present.push('--export');
  return present;
}

/** Every flag on the command line except the help, version and list flags, by the name shown to the user. */
function presentFlags(flags: CliFlags): string[] {
  const present = presentConfigFlags(flags);
  const others: Array<[unknown, string]> = [
    [flags.stateFile, '--state'],
    [flags.dryRun, '--dry-run'],
    [flags.json, '--json'],
    [flags.markdown, '--markdown'],
    [flags.fix, '--fix'],
    [flags.timings, '--timings'],
    [flags.includeWarnings, '--include-warnings'],
    [flags.yes, '--yes'],
    [flags.starship, '--starship'],
    [flags.list, '--list'],
    [flags.runId, '--run'],
    [flags.configFile, '--config'],
  ];
  for (const [value, name] of others) if (value) present.push(name);
  return present;
}

function acceptedFlags(subcommand: Subcommand): Set<string> {
  return new Set(SUBCOMMAND_INFO[subcommand].flags.map((info) => info.name));
}

const NOT_STATE_FLAGS = new Set(['--import-url', '--output', '--export']);

function refuseUnusedFlags(flags: CliFlags, subcommand: Subcommand): void {
  const accepted = acceptedFlags(subcommand);
  const layered =
    subcommand === 'doctor'
      ? presentConfigFlags(flags).filter((flag) => !NOT_STATE_FLAGS.has(flag))
      : [];
  const unused = presentFlags(flags).filter(
    (flag) => !accepted.has(flag) && !layered.includes(flag)
  );
  if (subcommand === 'doctor' && flags.dryRun && !flags.fix) unused.push('--dry-run without --fix');
  if (unused.length > 0) {
    throw new CliUsageError(`${unused.join(', ')} cannot be used with ${subcommand}.`);
  }
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
    ? await captureRun(
        trackedFiles(),
        (uncaptured) => runUninstall(steps, { keepConfigs: uncaptured }),
        { record: { kind: 'uninstall', command } }
      )
    : { result: await runUninstall(steps, { dryRun }), runId: null };
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
    } else if (changes) {
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

  const { result: report, runId } = changes
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

export interface PromptTimings extends TimingsReport {
  config: string;
}

/** Times the config Starship loads in this folder, or `configFile`, module by module. */
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

const NOT_SHARED_FLAGS: Array<[keyof CliFlags, string]> = [
  ['shells', '--shells'],
  ['setDefaultShell', '--set-default'],
  ['skipStarship', '--skip-starship'],
  ['exportFile', '--export'],
  ['dryRun', '--dry-run'],
];

export function runMarkdownCommand(flags: CliFlags): void {
  const refused = NOT_SHARED_FLAGS.filter(([key]) => flags[key]).map(([, name]) => name);
  if (refused.length > 0) {
    throw new CliUsageError(
      `${refused.join(', ')} cannot be used with generate --markdown, which shares the look only.`
    );
  }
  const state = stateFromFlags(flags);
  if (state.keepExistingConfig) {
    throw new CliUsageError(
      `An adopt-mode card keeps your own config, so there is no generated prompt to share; share ${getSharedConfigPath()} itself.`
    );
  }
  const text = renderShare(state);
  if (!flags.outputFile) {
    process.stdout.write(text);
    return;
  }
  try {
    writeFileAtomic(flags.outputFile, text);
  } catch (err) {
    throw new CliRunError(`Could not write '${flags.outputFile}': ${errorMessage(err)}`);
  }
  process.stdout.write(`Wrote ${flags.outputFile}\n`);
}

export function runListCommand(flags: CliFlags): void {
  const kind = flags.argument;
  if (!LIST_KINDS.includes(kind as ListKind)) {
    throw new CliUsageError(
      kind
        ? `Cannot list '${kind}' (available: ${LIST_KINDS.join(', ')}).`
        : `list needs what to list: ${LIST_KINDS.join(', ')}.`
    );
  }
  const entries = listEntries(kind as ListKind);
  process.stdout.write(
    flags.json ? `${JSON.stringify(entries, null, 2)}\n` : formatListing(entries)
  );
}

export function runCompletionsCommand(flags: CliFlags): void {
  const shell = flags.argument;
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
  const info = await collectDebugInfo(VERSION, deps);
  process.stdout.write(
    flags.json ? redactPersonal(`${JSON.stringify(info, null, 2)}\n`) : formatDebugInfo(info)
  );
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
    if (flags.markdown) runMarkdownCommand(flags);
    else runGenerate(flags);
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

/** Reports the crash and exits immediately, so a dead process cannot hang on Ink's stdin. */
export function crash(prefix: string, err: unknown): void {
  reportFatal(prefix, err);
  process.exit(process.exitCode ?? 1);
}

/** Everything before the wizard: global flags, headless subcommands. */
export async function routeCli(argv: string[]): Promise<{ handled: boolean; flags: CliFlags }> {
  const flags: CliFlags = parseCliArgs(argv);
  if (runGlobalFlags(flags)) return { handled: true, flags };
  const handled = await runHeadlessCommand(flags, quoteArgv(argv));
  return { handled, flags };
}

export function assertWizardTerminal(
  stdin: { isTTY?: boolean } = process.stdin,
  stdout: { isTTY?: boolean } = process.stdout
): void {
  if (stdin.isTTY && stdout.isTTY) return;
  throw new CliUsageError(
    'The wizard needs a terminal: its input and output cannot be redirected. ' +
      'To set up without one, run shell-configurator apply --shells <id,...> (see --help).'
  );
}

async function main(): Promise<void> {
  const { handled, flags } = await routeCli(process.argv.slice(2));
  if (handled) return;
  assertWizardTerminal();

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
    { exitOnCtrlC: false, interactive: true }
  );

  await app.waitUntilExit();
  applyInstallOutcomeExitCode();
  restoreTty();
}

export function isEntryPoint(script: string | undefined = process.argv[1]): boolean {
  if (!script) return false;
  try {
    return realpathSync(script) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  process.on('uncaughtException', (err) => crash('ShellConfigurator crashed', err));
  process.on('unhandledRejection', (err) => crash('ShellConfigurator crashed', err));
  main().catch((err) => reportFatal('ShellConfigurator exited abnormally', err));
}
