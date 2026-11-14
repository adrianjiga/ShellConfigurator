import { cleanup, render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PALETTES } from '../../config/palettes.ts';
import { StyleScreen } from '../../screens/StyleScreen.tsx';
import { DEFAULT_STATE, type WizardState } from '../../types.ts';
import { press, pressEsc } from '../helpers/ink.ts';
import { flush } from '../helpers/wait.ts';

const savedNoColor = process.env.NO_COLOR;

afterEach(() => {
  cleanup();
  if (savedNoColor === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = savedNoColor;
});

/** The full selection the screen pushes: the defaults plus what a test changed. */
function selection(changes: Partial<WizardState> = {}): Partial<WizardState> {
  return {
    characterSymbol: 'arrow',
    palette: 'default',
    powerline: false,
    continuationPrompt: 'dot',
    addNewline: true,
    vimMode: false,
    directoryTruncationLength: 3,
    directorySubstitutions: [],
    ...changes,
  };
}

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
    expect(instance.lastFrame()).toContain('Prompt extras: blank line');
    expect(instance.lastFrame()).toContain('❯ Arrow');
    // Only the focused section lists its options.
    expect(instance.lastFrame()).not.toContain('Blank line before prompt');
    await press(instance.stdin, '\t', 4);
    expect(instance.lastFrame()).toContain('Blank line before prompt');
    expect(instance.lastFrame()).toContain('Vim mode symbol');
    expect(instance.lastFrame()).toContain('Prompt character: ❯ Arrow');
  });

  it('lists every palette, so each preset has one of its own', async () => {
    const { instance } = setup();
    await flush();
    instance.stdin.write('\t'); // → palette section
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

    expect(onUpdate).toHaveBeenCalledWith(selection({ characterSymbol: 'lambda' }));
  });

  it('switches focus with Tab and adjusts the palette', async () => {
    const { instance, onUpdate } = setup();
    await flush();

    instance.stdin.write('\t'); // char → palette
    await flush();
    instance.stdin.write('\u001B[B'); // default → vivid
    await flush();

    expect(onUpdate).toHaveBeenCalledWith(selection({ palette: 'vivid' }));
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

    expect(onUpdate).toHaveBeenCalledWith(selection({ powerline: true }));
  });

  it('warns that powerline needs a Nerd Font when none was detected', async () => {
    const { instance } = setup({ hasNerdFont: false, powerline: true });
    await flush();
    expect(instance.lastFrame()).toContain('need a Nerd Font');
  });

  it('warns that a text-only preset leaves powerline out', async () => {
    const { instance } = setup({ hasNerdFont: true, preset: 'plain-text', powerline: true });
    await flush();
    expect(instance.lastFrame()).toContain('uses text symbols only');
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

    expect(onNext).toHaveBeenCalledWith(selection({ characterSymbol: 'lambda', palette: 'vivid' }));
  });

  it('wraps focus back to the character section after the last Tab', async () => {
    const { instance, onUpdate } = setup();
    await flush();

    await press(instance.stdin, '\t', 6);
    instance.stdin.write('\u001B[B'); // arrow → lambda
    await flush();

    expect(onUpdate).toHaveBeenCalledWith(selection({ characterSymbol: 'lambda' }));
  });

  it('clamps the character selection at both ends', async () => {
    const { instance, onUpdate } = setup();
    await flush();

    instance.stdin.write('\u001B[A'); // arrow is already first; stays there
    await flush();
    expect(onUpdate).not.toHaveBeenCalled();

    await press(instance.stdin, '\u001B[B', 3);
    expect(onUpdate).toHaveBeenLastCalledWith(selection({ characterSymbol: 'dollar' }));

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

    await press(instance.stdin, '\u001B[B', PALETTES.length);
    const last = PALETTES[PALETTES.length - 1]!;
    expect(onUpdate).toHaveBeenLastCalledWith(selection({ palette: last.id }));

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
    expect(onUpdate).toHaveBeenLastCalledWith(selection({ powerline: true }));

    instance.stdin.write('\u001B[A'); // powerline → plain
    await flush();
    expect(onUpdate).toHaveBeenLastCalledWith(selection());
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

    expect(onUpdate).toHaveBeenLastCalledWith(selection({ continuationPrompt: 'arrow' }));
  });

  it('clamps the wrapped-line marker at both ends', async () => {
    const { instance, onUpdate } = setup({ continuationPrompt: 'none' });
    await flush();

    await press(instance.stdin, '\t', 3); // → wrapped-line marker

    instance.stdin.write('\u001B[B'); // none is already last; stays there
    await flush();
    expect(onUpdate).not.toHaveBeenCalled();

    instance.stdin.write('\u001B[A'); // none → arrow
    await flush();
    expect(onUpdate).toHaveBeenLastCalledWith(selection({ continuationPrompt: 'arrow' }));
  });

  it('toggles the blank line and vim mode in the extras section', async () => {
    const { instance, onUpdate } = setup();
    await flush();

    await press(instance.stdin, '\t', 4); // → prompt extras

    instance.stdin.write(' '); // blank line on → off
    await flush();
    expect(onUpdate).toHaveBeenLastCalledWith(selection({ addNewline: false }));

    instance.stdin.write('\u001B[B'); // move to vim mode
    await flush();
    instance.stdin.write(' '); // vim mode off → on
    await flush();
    expect(onUpdate).toHaveBeenLastCalledWith(selection({ addNewline: false, vimMode: true }));
  });

  it('clamps the extras cursor at both ends', async () => {
    const { instance, onUpdate } = setup();
    await flush();

    await press(instance.stdin, '\t', 4); // → prompt extras

    instance.stdin.write('\u001B[A'); // first row; stays there
    await flush();
    instance.stdin.write(' '); // toggles addNewline
    await flush();
    expect(onUpdate).toHaveBeenLastCalledWith(selection({ addNewline: false }));

    instance.stdin.write('\u001B[B');
    await flush();
    instance.stdin.write('\u001B[B'); // last row; stays there
    await flush();
    instance.stdin.write(' '); // toggles vimMode, not addNewline again
    await flush();
    expect(onUpdate).toHaveBeenLastCalledWith(selection({ addNewline: false, vimMode: true }));
  });

  it('confirms the style extras with Enter', async () => {
    const { instance, onNext } = setup();
    await flush();

    await press(instance.stdin, '\t', 4); // → prompt extras
    instance.stdin.write(' ');
    await flush();
    instance.stdin.write('\r');
    await flush();

    expect(onNext).toHaveBeenCalledWith(selection({ addNewline: false }));
  });

  it('reaches the directory section and adjusts the truncation depth', async () => {
    const { instance, onUpdate } = setup();
    await flush();

    await press(instance.stdin, '\t', 5); // → directory display
    expect(instance.lastFrame()).toContain('Directory display');
    expect(instance.lastFrame()).toContain('Depth: 3 folders');

    instance.stdin.write('\u001B[D'); // 3 → 2
    await flush();
    expect(onUpdate).toHaveBeenLastCalledWith(selection({ directoryTruncationLength: 2 }));
  });

  it('clamps the truncation depth at the full path and the maximum', async () => {
    const { instance, onUpdate } = setup({ directoryTruncationLength: 0 });
    await flush();

    await press(instance.stdin, '\t', 5); // → directory display
    expect(instance.lastFrame()).toContain('Depth: Full path');

    instance.stdin.write('\u001B[D'); // already 0; stays there
    await flush();
    expect(onUpdate).not.toHaveBeenCalled();

    instance.stdin.write('\u001B[C'); // 0 → 1
    await flush();
    expect(onUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ directoryTruncationLength: 1 })
    );

    const { instance: maxInstance, onUpdate: maxUpdate } = setup({
      directoryTruncationLength: 5,
    });
    await flush();
    await press(maxInstance.stdin, '\t', 5);
    expect(maxInstance.lastFrame()).toContain('Depth: 5 folders');

    maxInstance.stdin.write('\u001B[C'); // already 5; stays there
    await flush();
    expect(maxUpdate).not.toHaveBeenCalled();
  });

  it('edits directory substitutions and confirms them with Enter', async () => {
    const { instance, onUpdate } = setup();
    await flush();

    await press(instance.stdin, '\t', 5); // → directory display
    instance.stdin.write('\u001B[B'); // depth row → substitutions row
    await flush();
    instance.stdin.write('\r'); // open the editor
    await flush();
    expect(instance.lastFrame()).toContain('Enter saves');

    for (const char of 'projects=code') {
      instance.stdin.write(char);
      await flush();
    }
    instance.stdin.write('\r'); // save
    await flush();

    expect(onUpdate).toHaveBeenLastCalledWith(
      selection({ directorySubstitutions: [{ from: 'projects', to: 'code' }] })
    );
    expect(instance.lastFrame()).toContain('Substitutions: projects=code');
  });

  it('keeps the substitutions editor open and shows an error on malformed input', async () => {
    const { instance, onUpdate } = setup();
    await flush();

    await press(instance.stdin, '\t', 5);
    instance.stdin.write('\u001B[B');
    await flush();
    instance.stdin.write('\r');
    await flush();

    for (const char of 'broken') {
      instance.stdin.write(char);
      await flush();
    }
    instance.stdin.write('\r'); // save fails
    await flush();

    expect(instance.lastFrame()).toContain('Missing \'=\' in "broken"');
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('cancels the substitutions editor with Escape', async () => {
    const { instance, onUpdate, onBack } = setup();
    await flush();

    await press(instance.stdin, '\t', 5);
    instance.stdin.write('\u001B[B');
    await flush();
    instance.stdin.write('\r');
    await flush();

    instance.stdin.write('x');
    await flush();
    await pressEsc(instance.stdin);

    expect(onBack).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
    expect(instance.lastFrame()).not.toContain('Enter saves');
  });

  it('lets Backspace correct the substitutions draft before saving', async () => {
    const { instance, onUpdate } = setup();
    await flush();

    await press(instance.stdin, '\t', 5);
    await press(instance.stdin, '\u001B[B');
    await press(instance.stdin, '\r');
    for (const char of 'projects=codex') await press(instance.stdin, char);
    await press(instance.stdin, '\u007F');
    await press(instance.stdin, '\r');

    expect(onUpdate).toHaveBeenLastCalledWith(
      selection({ directorySubstitutions: [{ from: 'projects', to: 'code' }] })
    );
  });

  it('closes the editor on the first Escape and leaves on the second', async () => {
    const { instance, onBack } = setup();
    await flush();

    await press(instance.stdin, '\t', 5);
    await press(instance.stdin, '\u001B[B');
    await press(instance.stdin, '\r');
    await pressEsc(instance.stdin);
    expect(onBack).not.toHaveBeenCalled();

    await pressEsc(instance.stdin);
    expect(onBack).toHaveBeenCalled();
  });

  it('confirms the directory settings with Enter', async () => {
    const { instance, onNext } = setup({
      directoryTruncationLength: 1,
      directorySubstitutions: [{ from: 'src', to: 'source' }],
    });
    await flush();

    instance.stdin.write('\r');
    await flush();

    expect(onNext).toHaveBeenCalledWith(
      selection({
        directoryTruncationLength: 1,
        directorySubstitutions: [{ from: 'src', to: 'source' }],
      })
    );
  });

  it('shows a swatch of each palette’s own colours when colour is on', async () => {
    delete process.env.NO_COLOR;
    const { instance } = setup();
    await flush();
    instance.stdin.write('\t'); // → palette section
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
    instance.stdin.write('\t'); // → palette section
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

describe('StyleScreen key bursts', () => {
  it('applies every arrow in a burst that arrives as one chunk', async () => {
    const onUpdate = vi.fn();
    const instance = render(
      <StyleScreen state={DEFAULT_STATE} onNext={vi.fn()} onUpdate={onUpdate} onBack={vi.fn()} />
    );
    await flush();
    instance.stdin.write('\u001B[B\u001B[B');
    await flush();
    expect(onUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ characterSymbol: 'dollar' })
    );
  });
});

describe('StyleScreen section order', () => {
  it('moves back a section on Shift+Tab', async () => {
    const { instance, onUpdate } = setup();
    await flush();
    instance.stdin.write('\u001B[Z'); // Shift+Tab: wraps from the first section to the last
    await flush();
    instance.stdin.write('\u001B[C'); // → raises the directory depth
    await flush();
    expect(onUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ directoryTruncationLength: 4 })
    );
  });
});

describe('StyleScreen substitution editor', () => {
  async function openEditor(instance: ReturnType<typeof setup>['instance']) {
    instance.stdin.write('\u001B[Z'); // back to the directory section
    await flush();
    instance.stdin.write('\u001B[B'); // substitutions row
    await flush();
    instance.stdin.write('\r');
    await flush();
  }

  it('drops line breaks from pasted text', async () => {
    const { instance } = setup();
    await flush();
    await openEditor(instance);
    instance.stdin.write('a=b\nc');
    await flush();
    expect(instance.lastFrame()).toContain('> a=bc');
  });

  it('clears the error once the user edits the text again', async () => {
    const { instance } = setup();
    await flush();
    await openEditor(instance);
    instance.stdin.write('x');
    await flush();
    instance.stdin.write('\r'); // "x" has no '=' → error
    await flush();
    expect(instance.lastFrame()).toContain("Missing '='");

    instance.stdin.write('=');
    await flush();
    expect(instance.lastFrame()).not.toContain("Missing '='");
  });
});

describe('StyleScreen hints', () => {
  it('shows Space only in the extras section', async () => {
    const { instance } = setup();
    await flush();
    expect(instance.lastFrame()).not.toContain('Space');
    await press(instance.stdin, '\t', 4);
    expect(instance.lastFrame()).toContain('Space');
  });
});
