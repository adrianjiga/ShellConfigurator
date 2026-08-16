#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { App } from './app.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';

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

process.on('uncaughtException', (err) => reportFatal('ShellConfigurator crashed', err));
process.on('unhandledRejection', (err) => reportFatal('ShellConfigurator crashed', err));

const app = render(
  <ErrorBoundary onError={(err) => reportFatal('ShellConfigurator hit a render error', err)}>
    <App />
  </ErrorBoundary>
);

app
  .waitUntilExit()
  .then(restoreTerminal)
  .catch((err) => reportFatal('ShellConfigurator exited abnormally', err));
