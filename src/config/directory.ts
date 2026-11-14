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

/** Backslash-escapes the editor syntax's own characters inside a folder name. */
function escapePart(value: string): string {
  return value.replace(/[\\,=]/g, (c) => `\\${c}`);
}

/**
 * Renders substitutions into the compact editor syntax: `from=to, from=to`.
 * A `,`, `=` or `\` inside a name is backslash-escaped so it parses back.
 */
export function formatSubstitutions(substitutions: readonly DirectorySubstitution[]): string {
  return substitutions.map(({ from, to }) => `${escapePart(from)}=${escapePart(to)}`).join(', ');
}

/** Splits on `separator` where it is not backslash-escaped, keeping the escapes. */
function splitUnescaped(text: string, separator: string, limit = Infinity): string[] {
  const parts: string[] = [];
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '\\' && i + 1 < text.length) {
      current += c + text[i + 1];
      i++;
    } else if (c === separator && parts.length < limit - 1) {
      parts.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  parts.push(current);
  return parts;
}

function unescapePart(value: string): string {
  return value.replace(/\\(.)/g, '$1');
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
  // A repeated source keeps its last target; a TOML table could not hold both.
  const parsed = new Map<string, DirectorySubstitution>();

  for (const rawPair of splitUnescaped(text, ',')) {
    const pair = rawPair.trim();
    if (!pair) continue;

    const [rawFrom, rawTo] = splitUnescaped(pair, '=', 2);
    if (rawTo === undefined) throw new Error(`Missing '=' in "${pair}"`);

    const from = unescapePart(rawFrom!.trim());
    const to = unescapePart(rawTo.trim());
    if (!from) throw new Error('A substitution needs a folder name before the =');

    parsed.set(from, { from, to });
  }

  return [...parsed.values()];
}
