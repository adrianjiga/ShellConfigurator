#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { render } from 'ink';
import { App } from './app.tsx';
import { routeCli } from './cli/route.ts';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { CliRunError, CliUsageError } from './services/errors.ts';
import { recordRunSafely } from './services/history.ts';
import { redactPersonal } from './services/redact.ts';
import { restoreTty } from './services/tty.ts';
import type { InstallTask, WizardState } from './types.ts';

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

/** Reports the crash and exits immediately, so a dead process cannot hang on Ink's stdin. */
export function crash(prefix: string, err: unknown): void {
  reportFatal(prefix, err);
  process.exit(process.exitCode ?? 1);
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

export async function main(): Promise<void> {
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
