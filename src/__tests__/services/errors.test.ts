import { describe, expect, it } from 'vitest';
import { errorMessage } from '../../services/errors.ts';

describe('errorMessage', () => {
  it('returns the message of an Error', () => {
    expect(errorMessage(new Error('disk full'))).toBe('disk full');
  });

  it('falls back to the error name when the message is empty', () => {
    expect(errorMessage(new Error())).toBe('Error');
    expect(errorMessage(new TypeError(''))).toBe('TypeError');
  });

  it('stringifies a non-Error value', () => {
    expect(errorMessage('plain')).toBe('plain');
    expect(errorMessage(42)).toBe('42');
  });
});
