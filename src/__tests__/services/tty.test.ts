import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isUiSuspended,
  resetUiSuspension,
  restoreTty,
  resumeUi,
  SHOW_CURSOR,
  subscribeToUiSuspension,
  suspendUi,
} from '../../services/tty.ts';

beforeEach(() => resetUiSuspension());
afterEach(() => resetUiSuspension());

describe('suspendUi / resumeUi', () => {
  it('notifies and disables raw mode on the first suspend', () => {
    const setRawMode = vi.fn();
    const realStdin = process.stdin;
    Object.defineProperty(process, 'stdin', {
      configurable: true,
      value: { isTTY: true, setRawMode },
    });

    try {
      const notified: boolean[] = [];
      subscribeToUiSuspension((suspended) => notified.push(suspended));

      suspendUi();

      expect(isUiSuspended()).toBe(true);
      expect(notified).toEqual([true]);
      expect(setRawMode).toHaveBeenCalledWith(false);
    } finally {
      Object.defineProperty(process, 'stdin', { configurable: true, value: realStdin });
    }
  });

  it('does not re-notify while already suspended (nested suspends)', () => {
    const notified: boolean[] = [];
    subscribeToUiSuspension((suspended) => notified.push(suspended));

    suspendUi();
    suspendUi();

    expect(notified).toEqual([true]);
    expect(isUiSuspended()).toBe(true);
  });

  it('resumes and re-arms raw mode only when the last suspend is released', () => {
    const setRawMode = vi.fn();
    const realStdin = process.stdin;
    Object.defineProperty(process, 'stdin', {
      configurable: true,
      value: { isTTY: true, isRaw: true, setRawMode },
    });

    try {
      const notified: boolean[] = [];
      subscribeToUiSuspension((suspended) => notified.push(suspended));

      suspendUi();
      suspendUi();
      resumeUi();

      expect(isUiSuspended()).toBe(true);
      expect(notified).toEqual([true]);
      expect(setRawMode).not.toHaveBeenCalledWith(true);

      resumeUi();

      expect(isUiSuspended()).toBe(false);
      expect(notified).toEqual([true, false]);
      expect(setRawMode).toHaveBeenLastCalledWith(true);
    } finally {
      Object.defineProperty(process, 'stdin', { configurable: true, value: realStdin });
    }
  });

  it('leaves a terminal that was not in raw mode out of it after resuming', () => {
    const setRawMode = vi.fn();
    const realStdin = process.stdin;
    Object.defineProperty(process, 'stdin', {
      configurable: true,
      value: { isTTY: true, isRaw: false, setRawMode },
    });

    try {
      suspendUi();
      resumeUi();

      expect(setRawMode).not.toHaveBeenCalledWith(true);
    } finally {
      Object.defineProperty(process, 'stdin', { configurable: true, value: realStdin });
    }
  });

  it('is a no-op when there is nothing suspended', () => {
    const notified: boolean[] = [];
    subscribeToUiSuspension((suspended) => notified.push(suspended));

    resumeUi();

    expect(notified).toEqual([]);
    expect(isUiSuspended()).toBe(false);
  });

  it('tolerates a setRawMode that throws (not a TTY race)', () => {
    Object.defineProperty(process, 'stdin', {
      configurable: true,
      value: {
        isTTY: true,
        setRawMode: vi.fn(() => {
          throw new Error('bad fd');
        }),
      },
    });

    expect(() => {
      suspendUi();
      resumeUi();
    }).not.toThrow();
  });
});

describe('subscribeToUiSuspension', () => {
  it('unsubscribes when the returned function is called', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToUiSuspension(listener);

    suspendUi();
    unsubscribe();
    resumeUi();

    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('resetUiSuspension', () => {
  it('clears listeners and depth (test-only)', () => {
    const listener = vi.fn();
    subscribeToUiSuspension(listener);
    suspendUi();
    expect(listener).toHaveBeenCalledTimes(1);

    resetUiSuspension();

    expect(isUiSuspended()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    resumeUi();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does nothing outside vitest so prod code cannot blank the suspension state', () => {
    const previous = process.env.VITEST;
    process.env.VITEST = 'false';
    try {
      const listener = vi.fn();
      subscribeToUiSuspension(listener);
      suspendUi();

      resetUiSuspension();

      expect(isUiSuspended()).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.VITEST;
      else process.env.VITEST = previous;
      resetUiSuspension();
    }
  });
});

describe('restoreTty', () => {
  const stdinTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  const stdinRaw = Object.getOwnPropertyDescriptor(process.stdin, 'setRawMode');
  const stdoutTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
  let setRawMode: ReturnType<typeof vi.fn>;
  let stdoutWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setRawMode = vi.fn();
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stdin, 'setRawMode', { value: setRawMode, configurable: true });
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true as never);
  });

  afterEach(() => {
    stdoutWrite.mockRestore();
    for (const [target, key, descriptor] of [
      [process.stdin, 'isTTY', stdinTTY],
      [process.stdin, 'setRawMode', stdinRaw],
      [process.stdout, 'isTTY', stdoutTTY],
    ] as const) {
      if (descriptor) Object.defineProperty(target, key, descriptor);
      else delete (target as unknown as Record<string, unknown>)[key];
    }
  });

  it('disables raw mode on a TTY stdin', () => {
    restoreTty();
    expect(setRawMode).toHaveBeenCalledWith(false);
  });

  it('shows the cursor again on a TTY stdout', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    restoreTty();
    expect(stdoutWrite).toHaveBeenCalledWith(SHOW_CURSOR);
  });

  it('writes no escape codes when stdout is a pipe', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    restoreTty();
    expect(stdoutWrite).not.toHaveBeenCalled();
  });

  it('does not throw when stdin has no setRawMode', () => {
    Object.defineProperty(process.stdin, 'setRawMode', { value: undefined, configurable: true });
    expect(() => restoreTty()).not.toThrow();
  });

  it('swallows write errors', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    stdoutWrite.mockImplementation(() => {
      throw new Error('EPIPE');
    });
    expect(() => restoreTty()).not.toThrow();
  });
});
