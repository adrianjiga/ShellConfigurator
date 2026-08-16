import { describe, it, expect, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { render, cleanup } from 'ink-testing-library';
import { StyleScreen } from '../../screens/StyleScreen.tsx';
import { DEFAULT_STATE } from '../../types.ts';
import { PALETTES } from '../../config/palettes.ts';

afterEach(cleanup);

function setup(overrides = {}) {
  const state = { ...DEFAULT_STATE, ...overrides };
  const onNext = vi.fn();
  const onUpdate = vi.fn();
  const onBack = vi.fn();
  const instance = render(
    <StyleScreen state={state} onNext={onNext} onUpdate={onUpdate} onBack={onBack} />
  );
  return { instance, onNext, onUpdate, onBack, state };
}

async function flush() {
  await act(async () => {});
}

describe('StyleScreen', () => {
  it('renders the character, palette, and segment style sections', async () => {
    const { instance } = setup();
    await flush();
    expect(instance.lastFrame()).toContain('Prompt character');
    expect(instance.lastFrame()).toContain('Colour palette');
    expect(instance.lastFrame()).toContain('Segment style');
    expect(instance.lastFrame()).toContain('❯ Arrow');
  });

  it('lists every palette, so each preset has one of its own', async () => {
    const { instance } = setup();
    await flush();
    for (const palette of PALETTES) {
      expect(instance.lastFrame()).toContain(palette.label);
    }
  });

  it('does not push updates on initial mount', async () => {
    const { onUpdate } = setup();
    await flush();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('moves the character with the down arrow and pushes a live update', async () => {
    const { instance, onUpdate } = setup();
    await flush();

    instance.stdin.write('\u001B[B'); // arrow → lambda
    await flush();

    expect(onUpdate).toHaveBeenCalledWith({
      characterSymbol: 'lambda',
      palette: 'default',
      powerline: false,
    });
  });

  it('switches focus with Tab and adjusts the palette', async () => {
    const { instance, onUpdate } = setup();
    await flush();

    instance.stdin.write('\t'); // char → palette
    await flush();
    instance.stdin.write('\u001B[B'); // default → vivid
    await flush();

    expect(onUpdate).toHaveBeenCalledWith({
      characterSymbol: 'arrow',
      palette: 'vivid',
      powerline: false,
    });
  });

  it('reaches the segment style section on a second Tab and toggles powerline', async () => {
    const { instance, onUpdate } = setup();
    await flush();

    instance.stdin.write('\t'); // char → palette
    await flush();
    instance.stdin.write('\t'); // palette → segment style
    await flush();
    instance.stdin.write('\u001B[B'); // plain → powerline
    await flush();

    expect(onUpdate).toHaveBeenCalledWith({
      characterSymbol: 'arrow',
      palette: 'default',
      powerline: true,
    });
  });

  it('warns that powerline needs a Nerd Font when none was detected', async () => {
    const { instance } = setup({ hasNerdFont: false, powerline: true });
    await flush();
    expect(instance.lastFrame()).toContain('need a Nerd Font');
  });

  it('confirms the live selections with Enter', async () => {
    const { instance, onNext } = setup();
    await flush();

    instance.stdin.write('\u001B[B'); // lambda
    await flush();
    instance.stdin.write('\t'); // → palette
    await flush();
    instance.stdin.write('\u001B[B'); // vivid
    await flush();
    instance.stdin.write('\r');
    await flush();

    expect(onNext).toHaveBeenCalledWith({
      characterSymbol: 'lambda',
      palette: 'vivid',
      powerline: false,
    });
  });

  it('calls onBack on Escape', async () => {
    const { instance, onBack } = setup();
    await flush();
    instance.stdin.write('\u001B');
    await flush();
    expect(onBack).toHaveBeenCalled();
  });
});
