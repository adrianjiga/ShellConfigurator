import { constants } from 'node:os';
import { restoreTty } from './tty.ts';

export const CANCEL_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;

export type CancelSignal = (typeof CANCEL_SIGNALS)[number];

export function signalExitCode(signal: CancelSignal): number {
  return 128 + constants.signals[signal];
}

export interface SignalCancel {
  stop: () => CancelSignal | null;
  cancel: () => void;
  cancelled: () => boolean;
}

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
