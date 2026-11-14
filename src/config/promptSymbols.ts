import type { CharacterSymbol, ContinuationPrompt } from '../types.ts';

/**
 * The characters a prompt can end with, as the user sees them on screen.
 *
 * Starship's format strings treat `$` and `\` specially, so the generator must
 * escape them before writing a symbol into the config; the preview renders the
 * symbols as-is. Both derive from this one table so the two never drift.
 */
export const CHARACTER_SYMBOLS: Record<
  CharacterSymbol,
  { success: string; error: string; vim: string; vimStyle: string }
> = {
  // Vim normal mode: the arrow turns around; λ and $ keep their glyph, inverted.
  arrow: { success: '❯', error: '❯', vim: '❮', vimStyle: 'bold ok' },
  lambda: { success: 'λ', error: 'λ', vim: 'λ', vimStyle: 'bold inverted ok' },
  dollar: { success: '$', error: '$', vim: '$', vimStyle: 'bold inverted ok' },
};

/**
 * Starship format strings for the marker at the start of a wrapped input line.
 *
 * `none` is the empty string, which starship accepts and renders as no marker.
 * The default matches starship's own `'[∙](bright-black) '`.
 */
export const CONTINUATION_PROMPTS: Record<ContinuationPrompt, string> = {
  dot: '[∙](bright-black) ',
  arrow: '[❯](bright-black) ',
  none: '',
};

/** Nerd Font glyphs used by the font-check examples and matching module configs. */
export const NERD_FONT_SYMBOLS = {
  directory: ' ',
  gitBranch: ' ',
  nodejs: ' ',
  python: ' ',
  rust: ' ',
} as const;

/**
 * Powerline separators, U+E0B0 and U+E0B2. These live in the Nerd Font private use
 * area, so a powerline prompt is only ever generated when a Nerd Font is present.
 */
export const SEPARATOR_RIGHT = '\ue0b0';
export const SEPARATOR_LEFT = '\ue0b2';
