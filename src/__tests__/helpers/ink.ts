import { act } from 'react';
import { flush } from './wait.ts';

// Ink 7 holds a lone Escape ~20ms pending in case more bytes arrive (e.g. a CSI
// sequence), then emits it on a timer. Wait it out so the key event reaches the
// handler before we assert on the result.
export async function pressEsc(stdin: { write: (s: string) => void }) {
  stdin.write('\u001B');
  await new Promise((resolve) => setTimeout(resolve, 30));
  await act(async () => {});
}

/** Sends one key `times` times, letting each render before the next. */
export async function press(stdin: { write: (s: string) => void }, key: string, times = 1) {
  for (let i = 0; i < times; i++) {
    stdin.write(key);
    await flush();
  }
}
