import { constants } from 'node:os';

export const CANCEL_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;

export type CancelSignal = (typeof CANCEL_SIGNALS)[number];

/** The exit code a shell reports for a process ended by `signal`. */
export function signalExitCode(signal: CancelSignal): number {
  return 128 + constants.signals[signal];
}

/**
 * Cancels `controller` on Ctrl+C, a closed terminal or a kill, so the run stops
 * after the step that is running and still records what it changed. A second
 * signal exits at once; the next run then finishes recording it. Returns the
 * signal that cancelled the run (if any) and removes the handlers when called.
 */
export function cancelOnSignals(
  controller: AbortController,
  onCancel: (signal: CancelSignal) => void = () => {}
): () => CancelSignal | null {
  let received: CancelSignal | null = null;
  const handlers = CANCEL_SIGNALS.map((signal) => {
    const handler = () => {
      if (received) process.exit(signalExitCode(signal));
      received = signal;
      onCancel(signal);
      controller.abort();
    };
    process.on(signal, handler);
    return [signal, handler] as const;
  });
  return () => {
    for (const [signal, handler] of handlers) process.off(signal, handler);
    return received;
  };
}
