/**
 * Extracts a human-readable message from an unknown thrown value so every error
 * path reports the same thing. `String(err)` renders `"Error"` for a bare
 * `new Error()`, while `err.message` renders `""` — neither is helpful on its
 * own, so use this everywhere a catch slot reports a failure.
 */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * A mistake in the user-supplied headless flags or state card — a typo'd
 * --preset, an unknown palette, a torn card. Rendered as a bare message with
 * no stack trace, and a conventional exit code 2 for CLI misuse.
 */
export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliUsageError';
  }
}
