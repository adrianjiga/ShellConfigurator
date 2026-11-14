import { describe, expect, it } from 'vitest';
import { starshipTooOld } from '../../services/starshipVersion.ts';

describe('starshipTooOld', () => {
  it.each([
    ['starship 1.19.9', true],
    ['starship 0.58.0', true],
    ['starship 1.20', false],
    ['starship 1.20.0', false],
    ['1.27.0', false],
    ['starship 2.0.0', false],
    ['unknown', false],
    [null, false],
  ])('%s → %s', (version, old) => {
    expect(starshipTooOld(version)).toBe(old);
  });
});
