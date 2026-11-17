import * as fs from 'node:fs';
import { expect, vi } from 'vitest';

export function expectBefore(text: string, first: string, second: string): void {
  expect(text.indexOf(first)).toBeGreaterThanOrEqual(0);
  expect(text.indexOf(second)).toBeGreaterThan(text.indexOf(first));
}

/** The content of the module's last atomic write (the temp-file write). */
export function lastWrittenContent(): string {
  return vi.mocked(fs.writeFileSync).mock.calls.at(-1)?.[1] as string;
}
