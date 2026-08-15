import { describe, it, expect } from 'vitest';
import { getNextStep, getPrevStep } from '../stepMachine.js';
import { DEFAULT_STATE, FONT_SELECT_SENTINEL } from '../types.js';

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
    const next = getNextStep(stateWith('fontcheck', { nerdFontToInstall: FONT_SELECT_SENTINEL }));
    expect(next.step).toBe('font_select');
  });

  it('skips font_select when the user does not want to install a font', () => {
    const next = getNextStep(stateWith('fontcheck', { nerdFontToInstall: null }));
    expect(next.step).toBe('preset');
  });

  it('advances from font_select to preset', () => {
    const next = getNextStep(stateWith('font_select', { nerdFontToInstall: 'JetBrainsMono' }));
    expect(next.step).toBe('preset');
  });

  it('returns the state unchanged when skip lands beyond the last step', () => {
    // Step 'done' is the final step; there is no skip to make it work.
    const state = stateWith('done', { nerdFontToInstall: null });
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
    const prev = getPrevStep(stateWith('preset', { nerdFontToInstall: null }));
    expect(prev.step).toBe('fontcheck');
  });

  it('shows font_select when going back after choosing to install a font', () => {
    const prev = getPrevStep(stateWith('preset', { nerdFontToInstall: 'FiraCode' }));
    expect(prev.step).toBe('font_select');
  });

  it('moves from font_select back to fontcheck', () => {
    const prev = getPrevStep(stateWith('font_select', { nerdFontToInstall: FONT_SELECT_SENTINEL }));
    expect(prev.step).toBe('fontcheck');
  });
});
