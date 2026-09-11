#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { render } from 'ink';
import { App } from './app.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { restoreConfigBackups } from './generators/shellRc.ts';
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

process.on('uncaughtException', (err) => reportFatal('ShellConfigurator crashed', err));
process.on('unhandledRejection', (err) => reportFatal('ShellConfigurator crashed', err));

if (handleCliArgs()) {
  process.exit(0);
}

const app = render(
  <ErrorBoundary onError={(err) => reportFatal('ShellConfigurator hit a render error', err)}>
    <App dryRun={hasDryRunFlag()} onInstallOutcome={recordInstallOutcome} />
  </ErrorBoundary>
);

app
  .waitUntilExit()
  .then(() => {
    applyInstallOutcomeExitCode();
    restoreTerminal();
  })
  .catch((err) => reportFatal('ShellConfigurator exited abnormally', err));
