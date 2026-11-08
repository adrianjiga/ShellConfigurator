import { cleanup, render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PALETTES } from '../../config/palettes.ts';
import { StyleScreen } from '../../screens/StyleScreen.tsx';
import { DEFAULT_STATE } from '../../types.ts';
import { pressEsc } from '../helpers/ink.ts';
import { flush } from '../helpers/wait.ts';

const savedNoColor = process.env.NO_COLOR;

afterEach(() => {
  cleanup();
  if (savedNoColor === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = savedNoColor;
});

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
  it('renders the character, palette, segment style, and extras sections', async () => {
    const { instance } = setup();
    await flush();
    expect(instance.lastFrame()).toContain('Prompt character');
    expect(instance.lastFrame()).toContain('Colour palette');
    expect(instance.lastFrame()).toContain('Segment style');
    expect(instance.lastFrame()).toContain('Wrapped-line marker');
    expect(instance.lastFrame()).toContain('Prompt extras');
    expect(instance.lastFrame()).toContain('❯ Arrow');
    expect(instance.lastFrame()).toContain('Blank line before prompt');
    expect(instance.lastFrame()).toContain('Vim mode symbol');
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
      continuationPrompt: 'dot',
      addNewline: true,
      vimMode: false,
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
      continuationPrompt: 'dot',
      addNewline: true,
      vimMode: false,
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
      continuationPrompt: 'dot',
      addNewline: true,
      vimMode: false,
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
      continuationPrompt: 'dot',
      addNewline: true,
      vimMode: false,
    });
  });

  it('wraps focus back to the character section after the last Tab', async () => {
    const { instance, onUpdate } = setup();
    await flush();

    for (let i = 0; i < 5; i++) {
      instance.stdin.write('\t');
      await flush();
    }
    instance.stdin.write('\u001B[B'); // arrow → lambda
    await flush();

    expect(onUpdate).toHaveBeenCalledWith({
      characterSymbol: 'lambda',
      palette: 'default',
      powerline: false,
      continuationPrompt: 'dot',
      addNewline: true,
      vimMode: false,
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
      continuationPrompt: 'dot',
      addNewline: true,
      vimMode: false,
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
      continuationPrompt: 'dot',
      addNewline: true,
      vimMode: false,
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
      continuationPrompt: 'dot',
      addNewline: true,
      vimMode: false,
    });

    instance.stdin.write('\u001B[A'); // powerline → plain
    await flush();
    expect(onUpdate).toHaveBeenLastCalledWith({
      characterSymbol: 'arrow',
      palette: 'default',
      powerline: false,
      continuationPrompt: 'dot',
      addNewline: true,
      vimMode: false,
    });
  });

  it('changes the wrapped-line marker on a third Tab and pushes a live update', async () => {
    const { instance, onUpdate } = setup();
    await flush();

    instance.stdin.write('\t'); // → palette
    await flush();
    instance.stdin.write('\t'); // → segment style
    await flush();
    instance.stdin.write('\t'); // → wrapped-line marker
    await flush();
    instance.stdin.write('\u001B[B'); // dot → arrow
    await flush();

    expect(onUpdate).toHaveBeenLastCalledWith({
      characterSymbol: 'arrow',
      palette: 'default',
      powerline: false,
      continuationPrompt: 'arrow',
      addNewline: true,
      vimMode: false,
    });
  });

  it('clamps the wrapped-line marker at both ends', async () => {
    const { instance, onUpdate } = setup({ continuationPrompt: 'none' });
    await flush();

    for (let i = 0; i < 3; i++) {
      instance.stdin.write('\t'); // → wrapped-line marker
      await flush();
    }

    instance.stdin.write('\u001B[B'); // none is already last; stays there
    await flush();
    expect(onUpdate).not.toHaveBeenCalled();

    instance.stdin.write('\u001B[A'); // none → arrow
    await flush();
    expect(onUpdate).toHaveBeenLastCalledWith({
      characterSymbol: 'arrow',
      palette: 'default',
      powerline: false,
      continuationPrompt: 'arrow',
      addNewline: true,
      vimMode: false,
    });
  });

  it('toggles the blank line and vim mode in the extras section', async () => {
    const { instance, onUpdate } = setup();
    await flush();

    for (let i = 0; i < 4; i++) {
      instance.stdin.write('\t'); // → prompt extras
      await flush();
    }

    instance.stdin.write(' '); // blank line on → off
    await flush();
    expect(onUpdate).toHaveBeenLastCalledWith({
      characterSymbol: 'arrow',
      palette: 'default',
      powerline: false,
      continuationPrompt: 'dot',
      addNewline: false,
      vimMode: false,
    });

    instance.stdin.write('\u001B[B'); // move to vim mode
    await flush();
    instance.stdin.write(' '); // vim mode off → on
    await flush();
    expect(onUpdate).toHaveBeenLastCalledWith({
      characterSymbol: 'arrow',
      palette: 'default',
      powerline: false,
      continuationPrompt: 'dot',
      addNewline: false,
      vimMode: true,
    });
  });

  it('clamps the extras cursor at both ends', async () => {
    const { instance, onUpdate } = setup();
    await flush();

    for (let i = 0; i < 4; i++) {
      instance.stdin.write('\t'); // → prompt extras
      await flush();
    }

    instance.stdin.write('\u001B[A'); // first row; stays there
    await flush();
    instance.stdin.write(' '); // toggles addNewline
    await flush();
    expect(onUpdate).toHaveBeenLastCalledWith({
      characterSymbol: 'arrow',
      palette: 'default',
      powerline: false,
      continuationPrompt: 'dot',
      addNewline: false,
      vimMode: false,
    });

    instance.stdin.write('\u001B[B');
    await flush();
    instance.stdin.write('\u001B[B'); // last row; stays there
    await flush();
    instance.stdin.write(' '); // toggles vimMode, not addNewline again
    await flush();
    expect(onUpdate).toHaveBeenLastCalledWith({
      characterSymbol: 'arrow',
      palette: 'default',
      powerline: false,
      continuationPrompt: 'dot',
      addNewline: false,
      vimMode: true,
    });
  });

  it('confirms the style extras with Enter', async () => {
    const { instance, onNext } = setup();
    await flush();

    for (let i = 0; i < 4; i++) {
      instance.stdin.write('\t'); // → prompt extras
      await flush();
    }
    instance.stdin.write(' ');
    await flush();
    instance.stdin.write('\r');
    await flush();

    expect(onNext).toHaveBeenCalledWith({
      characterSymbol: 'arrow',
      palette: 'default',
      powerline: false,
      continuationPrompt: 'dot',
      addNewline: false,
      vimMode: false,
    });
  });

  it('shows a swatch of each palette’s own colours when colour is on', async () => {
    delete process.env.NO_COLOR;
    const { instance } = setup();
    await flush();

    const paletteLine = (instance.lastFrame() ?? '')
      .split('\n')
      .find((line) => line.includes('Default'));
    expect(paletteLine).toBeDefined();
    expect(paletteLine!).toContain('●');
  });

  it('hides the palette swatches but keeps the names when NO_COLOR is set', async () => {
    process.env.NO_COLOR = '1';
    const { instance } = setup();
    await flush();

    const paletteLine = (instance.lastFrame() ?? '')
      .split('\n')
      .find((line) => line.includes('Default'));
    expect(paletteLine).toBeDefined();
    expect(paletteLine!).not.toContain('●');
  });

  it('calls onBack on Escape', async () => {
    const { instance, onBack } = setup();
    await flush();
    await pressEsc(instance.stdin);
    expect(onBack).toHaveBeenCalled();
  });
});
