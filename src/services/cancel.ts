import { constants } from 'node:os';
import { restoreTty } from './tty.ts';

export const CANCEL_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;

export type CancelSignal = (typeof CANCEL_SIGNALS)[number];

/** The exit code a shell reports for a process ended by `signal`. */
export function signalExitCode(signal: CancelSignal): number {
  return 128 + constants.signals[signal];
}

export interface SignalCancel {
  /** Removes the handlers; the signal that cancelled the run, if any. */
  stop: () => CancelSignal | null;
  /** Cancels as SIGINT would, for a Ctrl+C read as a key: a second one exits. */
  cancel: () => void;
  cancelled: () => boolean;
}

/**
 * Cancels `controller` on Ctrl+C, a closed terminal or a kill, so the run stops
 * after the step that is running and still records what it changed. A second
 * signal exits at once; the next run then finishes recording it.
 */
export function cancelOnSignals(
  controller: AbortController,
  onCancel: (signal: CancelSignal) => void = () => {}
): SignalCancel {
  let received: CancelSignal | null = null;
  const receive = (signal: CancelSignal) => {
    if (received) {
      restoreTty();
      process.exit(signalExitCode(signal));
    }
    received = signal;
    onCancel(signal);
    controller.abort();
  };
  const handlers = CANCEL_SIGNALS.map((signal) => {
    const handler = () => receive(signal);
    process.on(signal, handler);
    return [signal, handler] as const;
  });
  return {
    stop: () => {
      for (const [signal, handler] of handlers) process.off(signal, handler);
      return received;
    },
    cancel: () => receive('SIGINT'),
    cancelled: () => received !== null,
  };
}
