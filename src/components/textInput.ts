import type { Key } from 'ink';

/**
 * The text after one key of typing: Backspace/Delete drop the last character and
 * printable input is appended, minus any pasted line break. Null when the key is
 * not an edit (a control or meta combo, or nothing printable).
 */
export function editedText(
  current: string,
  char: string,
  key: Pick<Key, 'backspace' | 'delete' | 'ctrl' | 'meta'>
): string | null {
  if (key.backspace || key.delete) return current.slice(0, -1);
  const text = char.replace(/[\r\n]/g, '');
  return text && !key.ctrl && !key.meta ? current + text : null;
}
