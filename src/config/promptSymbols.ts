import type { CharacterSymbol } from '../types.ts';

/**
 * The characters a prompt can end with, as the user sees them on screen.
 *
 * Starship's format strings treat `$` and `\` specially, so the generator must
 * escape them before writing a symbol into the config; the preview renders the
 * symbols as-is. Both derive from this one table so the two never drift.
 */
export const CHARACTER_SYMBOLS: Record<CharacterSymbol, { success: string; error: string }> = {
  arrow: { success: '❯', error: '❯' },
  lambda: { success: 'λ', error: 'λ' },
  dollar: { success: '$', error: '$' },
};

/**
 * Powerline separators, U+E0B0 and U+E0B2. These live in the Nerd Font private use
 * area, so a powerline prompt is only ever generated when a Nerd Font is present.
 */
export const SEPARATOR_RIGHT = '\ue0b0';
export const SEPARATOR_LEFT = '\ue0b2';
