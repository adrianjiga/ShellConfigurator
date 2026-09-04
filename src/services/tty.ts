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
 * Toggles the terminal's raw mode. Ink leaves the terminal in raw mode for the
 * whole process; if a child inherited that it could not read a password or
 * confirmations correctly (echo is off, input isn't line-buffered). Before
 * handing the TTY to a child the terminal must be returned to canonical mode,
 * and re-armed afterwards so Ink can resume drawing.
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

/** Hands the terminal to a child process. Nestable; resume the same number of times. */
export function suspendUi(): void {
  depth += 1;
  if (depth === 1) {
    setRawModeStandard(false);
    notify();
  }
}

export function resumeUi(): void {
  if (depth === 0) return;
  depth -= 1;
  if (depth === 0) {
    setRawModeStandard(true);
    notify();
  }
}

/** Test helper: drops all listeners and clears the suspension depth. */
export function resetUiSuspension(): void {
  listeners.clear();
  depth = 0;
}
