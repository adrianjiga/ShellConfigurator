import { describe, it, expect } from 'vitest';
import { getNextStep, getPrevStep } from '../stepMachine.ts';
import { DEFAULT_STATE, NO_NERD_FONT } from '../types.ts';

function stateWith(step: Parameters<typeof getNextStep>[0]['step'], overrides: object = {}) {
  return { ...DEFAULT_STATE, step, ...overrides };
}

describe('getNextStep', () => {
  it('advances to the next step in order', () => {
    const next = getNextStep(stateWith('welcome'));
    expect(next.step).toBe('fontcheck');
  });

  it('returns the state unchanged when already on the last step', () => {
    const state = stateWith('done');
    expect(getNextStep(state)).toBe(state);
  });

  it('applies the update and advances', () => {
    const next = getNextStep(stateWith('welcome'), { starshipInstalled: true });
    expect(next.step).toBe('fontcheck');
    expect(next.starshipInstalled).toBe(true);
  });

  it('routes to font_select when the user wants to install a font', () => {
    const next = getNextStep(stateWith('fontcheck', { nerdFontToInstall: { kind: 'select' } }));
    expect(next.step).toBe('font_select');
  });

  it('skips font_select when the user does not want to install a font', () => {
    const next = getNextStep(stateWith('fontcheck', { nerdFontToInstall: NO_NERD_FONT }));
    expect(next.step).toBe('preset');
  });

  it('advances from font_select to preset', () => {
    const next = getNextStep(
      stateWith('font_select', {
        nerdFontToInstall: { kind: 'install' as const, id: 'JetBrainsMono' },
      })
    );
    expect(next.step).toBe('preset');
  });

  it('returns the state unchanged when skip lands beyond the last step', () => {
    // Step 'done' is the final step; there is no skip to make it work.
    const state = stateWith('done', { nerdFontToInstall: NO_NERD_FONT });
    expect(getNextStep(state)).toBe(state);
  });
});

describe('getPrevStep', () => {
  it('moves back to the previous step', () => {
    const prev = getPrevStep(stateWith('fontcheck'));
    expect(prev.step).toBe('welcome');
  });

  it('returns the state unchanged when already on the first step', () => {
    const state = stateWith('welcome');
    expect(getPrevStep(state)).toBe(state);
  });

  it('skips font_select when going back if it was never intended to be visited', () => {
    const prev = getPrevStep(stateWith('preset', { nerdFontToInstall: NO_NERD_FONT }));
    expect(prev.step).toBe('fontcheck');
  });

  it('shows font_select when going back after choosing to install a font', () => {
    const prev = getPrevStep(
      stateWith('preset', { nerdFontToInstall: { kind: 'install' as const, id: 'FiraCode' } })
    );
    expect(prev.step).toBe('font_select');
  });

  it('moves from font_select back to fontcheck', () => {
    const prev = getPrevStep(stateWith('font_select', { nerdFontToInstall: NO_NERD_FONT }));
    expect(prev.step).toBe('fontcheck');
  });
});

describe('terminal steps', () => {
  it('does not walk back from done into installing', () => {
    const state = { ...DEFAULT_STATE, step: 'done' as const };
    expect(getPrevStep(state).step).toBe('done');
  });

  it('does not walk back out of installing', () => {
    const state = { ...DEFAULT_STATE, step: 'installing' as const };
    expect(getPrevStep(state).step).toBe('installing');
  });
});
