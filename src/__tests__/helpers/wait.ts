import { act } from 'react';

/** Flushes pending React state updates so the latest frame is rendered. */
export async function flush() {
  await act(async () => {});
}

/**
 * Polls until `check` passes, so an intentional delay (e.g. the install screen's
 * 1.2s advance pause) never blocks a test.
 */
export async function waitFor(check: () => unknown, what = 'condition'): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 5000) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${what}`);
}
