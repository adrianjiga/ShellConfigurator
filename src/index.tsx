#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import React from 'react';
import { render } from 'ink';
import { App } from './app.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';

const VERSION = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
).version as string;

/**
 * Ink puts the terminal in raw mode and hides the cursor; if the process dies
 * without unwinding that, the user's shell is left unusable.
 */
function restoreTerminal(): void {
  try {
    if (process.stdin.isTTY && process.stdin.setRawMode) {
      process.stdin.setRawMode(false);
    }
    // Show cursor again.
    process.stdout.write('\u001B[?25h');
  } catch {
    // Nothing useful to do if even this fails.
  }
}

function reportFatal(prefix: string, err: unknown): void {
  restoreTerminal();
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`\n${prefix}: ${message}\n`);
  process.exitCode = 1;
}

function handleCliArgs(): boolean {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg === '--version' || arg === '-v')) {
    process.stdout.write(`${VERSION}\n`);
    return true;
  }
  return false;
}

process.on('uncaughtException', (err) => reportFatal('ShellConfigurator crashed', err));
process.on('unhandledRejection', (err) => reportFatal('ShellConfigurator crashed', err));

if (handleCliArgs()) {
  process.exit(0);
}

const app = render(
  <ErrorBoundary onError={(err) => reportFatal('ShellConfigurator hit a render error', err)}>
    <App />
  </ErrorBoundary>
);

app
  .waitUntilExit()
  .then(restoreTerminal)
  .catch((err) => reportFatal('ShellConfigurator exited abnormally', err));