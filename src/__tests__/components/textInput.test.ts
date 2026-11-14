import { describe, expect, it } from 'vitest';
import { editedText } from '../../components/textInput.ts';

const plain = { backspace: false, delete: false, ctrl: false, meta: false };

describe('editedText', () => {
  it('appends typed text', () => {
    expect(editedText('no', 'de', plain)).toBe('node');
  });

  it('drops the last character on Backspace or Delete', () => {
    expect(editedText('node', '', { ...plain, backspace: true })).toBe('nod');
    expect(editedText('node', '', { ...plain, delete: true })).toBe('nod');
  });

  it('drops a pasted line break', () => {
    expect(editedText('', 'a\r\nb\n', plain)).toBe('ab');
  });

  it('is not an edit for a control or meta combo, or a bare line break', () => {
    expect(editedText('x', 'a', { ...plain, ctrl: true })).toBeNull();
    expect(editedText('x', 'a', { ...plain, meta: true })).toBeNull();
    expect(editedText('x', '\n', plain)).toBeNull();
  });
});
