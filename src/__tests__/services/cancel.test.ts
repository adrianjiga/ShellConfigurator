import { afterEach, describe, expect, it, vi } from 'vitest';

const { restoreTty } = vi.hoisted(() => ({ restoreTty: vi.fn() }));
vi.mock('../../services/tty.ts', () => ({ restoreTty }));

import { CANCEL_SIGNALS, cancelOnSignals, signalExitCode } from '../../services/cancel.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cancelOnSignals', () => {
  it.each(CANCEL_SIGNALS)('cancels the run on %s and says which signal did it', (signal) => {
    const controller = new AbortController();
    const onCancel = vi.fn();
    const { stop } = cancelOnSignals(controller, onCancel);

    process.emit(signal);

    expect(controller.signal.aborted).toBe(true);
    expect(onCancel).toHaveBeenCalledWith(signal);
    expect(stop()).toBe(signal);
  });

  it('removes its handlers when stopped', () => {
    const before = process.listenerCount('SIGTERM');
    const { stop } = cancelOnSignals(new AbortController());
    expect(process.listenerCount('SIGTERM')).toBe(before + 1);

    expect(stop()).toBeNull();
    expect(process.listenerCount('SIGTERM')).toBe(before);
  });

  it('exits at once on a second signal', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const { stop } = cancelOnSignals(new AbortController());

    process.emit('SIGINT');
    expect(exit).not.toHaveBeenCalled();
    process.emit('SIGINT');
    stop();

    expect(exit).toHaveBeenCalledWith(130);
    expect(restoreTty).toHaveBeenCalledBefore(exit);
  });
});

describe('cancelOnSignals().cancel', () => {
  it('counts a Ctrl+C key as the first signal, so the next one exits', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const controller = new AbortController();
    const signals = cancelOnSignals(controller);

    signals.cancel();
    expect(controller.signal.aborted).toBe(true);
    expect(signals.cancelled()).toBe(true);
    expect(exit).not.toHaveBeenCalled();

    process.emit('SIGINT');
    signals.stop();
    expect(exit).toHaveBeenCalledWith(130);
  });
});

describe('signalExitCode', () => {
  it('is 128 plus the signal number', () => {
    expect(signalExitCode('SIGINT')).toBe(130);
    expect(signalExitCode('SIGTERM')).toBe(143);
    expect(signalExitCode('SIGHUP')).toBe(129);
  });
});
