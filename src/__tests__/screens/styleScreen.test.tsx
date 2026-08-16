import { describe, it, expect, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { render, cleanup } from 'ink-testing-library';
import { StyleScreen } from '../../screens/StyleScreen.tsx';
import { DEFAULT_STATE } from '../../types.ts';

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
  it('renders character and color sections', async () => {
    const { instance } = setup();
    await flush();
    expect(instance.lastFrame()).toContain('Prompt character');
    expect(instance.lastFrame()).toContain('Color scheme');
    expect(instance.lastFrame()).toContain('❯ Arrow');
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
      colorScheme: 'default',
    });
  });

  it('switches focus with Tab and adjusts the color scheme', async () => {
    const { instance, onUpdate } = setup();
    await flush();

    instance.stdin.write('\t'); // char → color
    await flush();
    instance.stdin.write('\u001B[B'); // default → pastel
    await flush();

    expect(onUpdate).toHaveBeenCalledWith({
      characterSymbol: 'arrow',
      colorScheme: 'pastel',
    });
  });

  it('confirms the live selections with Enter', async () => {
    const { instance, onNext } = setup();
    await flush();

    instance.stdin.write('\u001B[B'); // lambda
    await flush();
    instance.stdin.write('\t'); // → color
    await flush();
    instance.stdin.write('\u001B[B'); // pastel
    await flush();
    instance.stdin.write('\r');
    await flush();

    expect(onNext).toHaveBeenCalledWith({
      characterSymbol: 'lambda',
      colorScheme: 'pastel',
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
