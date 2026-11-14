/**
 * Coordinates who owns the terminal.
 *
 * Interactive children (sudo, chsh) write straight to the TTY that Ink is drawing
 * on. While one is running the UI must render nothing, or Ink's next frame paints
 * over the password prompt. Screens subscribe here and render null while suspended.
 */

type SuspendListener = (suspended: boolean) => void;

const listeners = new Set<SuspendListener>();
let depth = 0;
/** Raw mode is only re-armed for a UI that had it: headless runs never do. */
let rawBeforeSuspend = false;
let stoppedRead: StdinHandle | null = null;

export function isUiSuspended(): boolean {
  return depth > 0;
}

function notify(): void {
  const suspended = isUiSuspended();
  for (const listener of listeners) listener(suspended);
}

export function subscribeToUiSuspension(listener: SuspendListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Returns the TTY to canonical mode while a child owns it (raw mode would break
 * password/confirmation input), and re-arms it afterwards for Ink.
 */
function setRawModeStandard(enabled: boolean): void {
  try {
    if (process.stdin.isTTY && process.stdin.setRawMode) {
      process.stdin.setRawMode(enabled);
    }
  } catch {
    // Not a TTY (pipelines, tests) or already in the requested mode — nothing to do.
  }
}

interface StdinHandle {
  reading?: boolean;
  readStop?: () => number;
  readStart?: () => number;
}

/** Node keeps reading a TTY after its input listeners are gone; only stopping the handle hands the input to the child. */
function stopReadingStdin(): void {
  try {
    const handle = (process.stdin as unknown as { _handle?: StdinHandle })._handle;
    if (!process.stdin.isTTY || !handle?.reading || !handle.readStop || !handle.readStart) return;
    handle.reading = false;
    handle.readStop();
    stoppedRead = handle;
  } catch {
    // No handle to stop: nothing is reading.
  }
}

function restartReadingStdin(): void {
  const handle = stoppedRead;
  stoppedRead = null;
  if (!handle || handle.reading) return;
  try {
    handle.reading = true;
    handle.readStart?.();
  } catch {
    // The terminal is gone; there is nothing left to read.
  }
}

/** Hands the terminal to a child process. Nestable; resume the same number of times. */
export function suspendUi(): void {
  depth += 1;
  if (depth === 1) {
    rawBeforeSuspend = process.stdin.isTTY === true && process.stdin.isRaw === true;
    setRawModeStandard(false);
    stopReadingStdin();
    notify();
  }
}

export function resumeUi(): void {
  if (depth === 0) return;
  depth -= 1;
  if (depth === 0) {
    restartReadingStdin();
    if (rawBeforeSuspend) setRawModeStandard(true);
    notify();
  }
}

export const SHOW_CURSOR = '\u001B[?25h';

/** Returns the terminal to normal mode after a child process or raw-mode UI. */
export function restoreTty(): void {
  setRawModeStandard(false);
  try {
    if (process.stdout.isTTY) process.stdout.write(SHOW_CURSOR);
  } catch {
    // Stream already gone; nothing to restore.
  }
}

/** Test-only: drops listeners and clears the depth so tests cannot leak state. */
export function resetUiSuspension(): void {
  if (process.env.VITEST !== 'true') return;
  listeners.clear();
  depth = 0;
  rawBeforeSuspend = false;
  stoppedRead = null;
}
