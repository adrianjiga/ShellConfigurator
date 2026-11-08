import type { DirectorySubstitution } from '../types.ts';

/** Starship's default; the Style screen starts here. */
export const DEFAULT_TRUNCATION_LENGTH = 3;
/** `0` disables truncation, so the full path is shown. */
export const MIN_TRUNCATION_LENGTH = 0;
/** More than this rarely fits in a prompt; keep the picker short. */
export const MAX_TRUNCATION_LENGTH = 5;

/** Keeps a hand-edited state card or a keypress inside the picker's range. */
export function clampTruncationLength(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TRUNCATION_LENGTH;
  return Math.min(MAX_TRUNCATION_LENGTH, Math.max(MIN_TRUNCATION_LENGTH, Math.round(value)));
}

/** Renders substitutions into the compact editor syntax: `from=to, from=to`. */
export function formatSubstitutions(substitutions: readonly DirectorySubstitution[]): string {
  return substitutions.map(({ from, to }) => `${from}=${to}`).join(', ');
}

/**
 * Parses the compact editor syntax into starship's substitution table.
 *
 * Pairs are comma-separated. A pair needs a non-empty source folder; an empty
 * target is allowed (it hides the folder). Throws with a user-facing message on
 * malformed input so the screen can show it instead of writing a table starship
 * would reject.
 */
export function parseSubstitutions(text: string): DirectorySubstitution[] {
  // A Map keeps the last entry for a repeated source, matching how starship
  // resolves duplicate TOML keys.
  const parsed = new Map<string, DirectorySubstitution>();

  for (const rawPair of text.split(',')) {
    const pair = rawPair.trim();
    if (!pair) continue;

    const equals = pair.indexOf('=');
    if (equals < 0) throw new Error(`Missing '=' in "${pair}"`);

    const from = pair.slice(0, equals).trim();
    const to = pair.slice(equals + 1).trim();
    if (!from) throw new Error('A substitution needs a folder name before the =');

    parsed.set(from, { from, to });
  }

  return [...parsed.values()];
}
