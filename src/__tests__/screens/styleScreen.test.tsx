import { cleanup, render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PALETTES } from '../../config/palettes.ts';
import { StyleScreen } from '../../screens/StyleScreen.tsx';
import { DEFAULT_STATE } from '../../types.ts';
import { pressEsc } from '../helpers/ink.ts';
import { flush } from '../helpers/wait.ts';

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

  it('wraps focus back to the character section on a third Tab', async () => {
    const { instance, onUpdate } = setup();
    await flush();

    instance.stdin.write('\t'); // char → palette
    await flush();
    instance.stdin.write('\t'); // palette → powerline
    await flush();
    instance.stdin.write('\t'); // powerline → char
    await flush();
    instance.stdin.write('\u001B[B'); // arrow → lambda
    await flush();

    expect(onUpdate).toHaveBeenCalledWith({
      characterSymbol: 'lambda',
      palette: 'default',
      powerline: false,
    });
  });

  it('clamps the character selection at both ends', async () => {
    const { instance, onUpdate } = setup();
    await flush();

    instance.stdin.write('\u001B[A'); // arrow is already first; stays there
    await flush();
    expect(onUpdate).not.toHaveBeenCalled();

    for (let i = 0; i < 3; i++) {
      instance.stdin.write('\u001B[B');
      await flush();
    }
    expect(onUpdate).toHaveBeenLastCalledWith({
      characterSymbol: 'dollar',
      palette: 'default',
      powerline: false,
    });

    instance.stdin.write('\u001B[B'); // dollar is already last; stays there
    await flush();
    expect(onUpdate).toHaveBeenCalledTimes(2); // arrow → lambda → dollar only
  });

  it('clamps the palette selection at the top and bottom', async () => {
    const { instance, onUpdate } = setup();
    await flush();

    instance.stdin.write('\t'); // → palette
    await flush();

    instance.stdin.write('\u001B[A'); // default is already first; stays there
    await flush();
    expect(onUpdate).not.toHaveBeenCalled();

    for (let i = 0; i < PALETTES.length; i++) {
      instance.stdin.write('\u001B[B');
      await flush();
    }
    const last = PALETTES[PALETTES.length - 1]!;
    expect(onUpdate).toHaveBeenLastCalledWith({
      characterSymbol: 'arrow',
      palette: last.id,
      powerline: false,
    });

    instance.stdin.write('\u001B[B'); // last palette; stays there
    await flush();
    expect(onUpdate).toHaveBeenCalledTimes(PALETTES.length - 1); // one call per move
  });

  it('clamps the segment style at the top and can toggle it either way', async () => {
    const { instance, onUpdate } = setup();
    await flush();

    instance.stdin.write('\t'); // → palette
    await flush();
    instance.stdin.write('\t'); // → powerline
    await flush();

    instance.stdin.write('\u001B[A'); // plain is already first; stays there
    await flush();
    expect(onUpdate).not.toHaveBeenCalled();

    instance.stdin.write('\u001B[B'); // plain → powerline
    await flush();
    instance.stdin.write('\u001B[B'); // powerline is last; stays there
    await flush();
    expect(onUpdate).toHaveBeenLastCalledWith({
      characterSymbol: 'arrow',
      palette: 'default',
      powerline: true,
    });

    instance.stdin.write('\u001B[A'); // powerline → plain
    await flush();
    expect(onUpdate).toHaveBeenLastCalledWith({
      characterSymbol: 'arrow',
      palette: 'default',
      powerline: false,
    });
  });

  it('calls onBack on Escape', async () => {
    const { instance, onBack } = setup();
    await flush();
    await pressEsc(instance.stdin);
    expect(onBack).toHaveBeenCalled();
  });
});
