/**
 * Extracts a human-readable message from an unknown thrown value so every error
 * path reports the same thing. `String(err)` renders `"Error"` for a bare
 * `new Error()`, while `err.message` renders `""` — neither is helpful on its
 * own, so use this everywhere a catch slot reports a failure.
 */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
