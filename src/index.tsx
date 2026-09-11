#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { render } from 'ink';
import { App } from './app.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { restoreConfigBackups } from './generators/shellRc.ts';
import { parseCliArgs } from './services/args.ts';
import { runApply, runGenerate } from './services/headless.ts';
import { restoreTty } from './services/tty.ts';
import type { InstallTask } from './types.ts';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  .version as string;

let installFailed = false;

/** Records whether the install finished with any failed task. */
export function recordInstallOutcome(results: InstallTask[] | undefined): void {
  installFailed = results?.some((t) => t.status === 'failed') ?? false;
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
  shell-configurator --help       show this help
  shell-configurator --version    print the version
  shell-configurator --dry-run    preview changes without installing
  shell-configurator --restore    restore configs from their newest backup

Options:
  -h, --help       Show this help and exit
  -v, --version    Print the version and exit
  -d, --dry-run    Generate config in-memory and show a summary; installs nothing
  --no-install     Alias for --dry-run
  --restore        Copy the newest .bak-* snapshot back over the shared and
                   per-shell configs created by earlier wizard runs

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
  -o <file>            Write the TOML here instead of stdout
  --export <file>      Write the state card here instead of TOML
  --import <file>      Start from a saved state card instead of flags

apply options (a headless install from a state card):
  --state <file>       The state card describing the install (also: --import)
  --dry-run            Print the plan and generated config; change nothing
`);
}

/** Restore the shared and per-shell configs from their newest backups. */
export function runRestore(): void {
  const restored = restoreConfigBackups();
  if (restored.length === 0) {
    process.stdout.write('Nothing to restore — no ShellConfigurator backups found.\n');
    return;
  }
  process.stdout.write('Restored configs from their newest backups:\n');
  for (const r of restored) {
    process.stdout.write(`  ${r.what}: ${r.restoredTo} (from ${r.restoredFrom})\n`);
  }
}

export function handleCliArgs(): boolean {
  const args = process.argv.slice(2);
  for (const arg of args) {
    if (arg === '--version' || arg === '-v') {
      process.stdout.write(`${VERSION}\n`);
      return true;
    }
    if (arg === '--help' || arg === '-h') {
      printHelp();
      return true;
    }
    if (arg === '--restore' || arg === '--undo') {
      runRestore();
      return true;
    }
  }
  return false;
}

/** Extract the --dry-run / --no-install flag from argv. */
export function hasDryRunFlag(): boolean {
  const args = process.argv.slice(2);
  return args.includes('--dry-run') || args.includes('--no-install') || args.includes('-d');
}

/**
 * Runs a headless subcommand (`generate` or `apply`) to completion, returning
 * true when argv targeted one so the Ink wizard is skipped entirely. Errors
 * propagate for the caller's fatal handler — headless runs never render.
 */
export async function runHeadlessCommand(argv: string[]): Promise<boolean> {
  const flags = parseCliArgs(argv);
  if (flags.subcommand === 'generate') {
    runGenerate(flags);
    return true;
  }
  if (flags.subcommand === 'apply') {
    await runApply(flags);
    return true;
  }
  return false;
}

process.on('uncaughtException', (err) => reportFatal('ShellConfigurator crashed', err));
process.on('unhandledRejection', (err) => reportFatal('ShellConfigurator crashed', err));

async function main(): Promise<void> {
  // Global flags first (--version/--help/--restore), then headless subcommands;
  // whichever consumes the args keeps the process from starting Ink.
  if (handleCliArgs()) return;
  if (await runHeadlessCommand(process.argv.slice(2))) return;

  const app = render(
    <ErrorBoundary onError={(err) => reportFatal('ShellConfigurator hit a render error', err)}>
      <App dryRun={hasDryRunFlag()} onInstallOutcome={recordInstallOutcome} />
    </ErrorBoundary>
  );

  await app.waitUntilExit();
  applyInstallOutcomeExitCode();
  restoreTerminal();
}

main().catch((err) => reportFatal('ShellConfigurator exited abnormally', err));
