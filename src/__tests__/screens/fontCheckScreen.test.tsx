import { cleanup, render } from 'ink-testing-library';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FontCheckScreen } from '../../screens/FontCheckScreen.tsx';
import { DEFAULT_STATE, NO_NERD_FONT } from '../../types.ts';
import { pressEsc } from '../helpers/ink.ts';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function setup() {
  const onNext = vi.fn();
  const onBack = vi.fn();
  const instance = render(
    <FontCheckScreen state={{ ...DEFAULT_STATE }} onNext={onNext} onBack={onBack} />
  );
  return { instance, onNext, onBack };
}

async function flush() {
  await act(async () => {});
}

describe('FontCheckScreen', () => {
  it('renders the font check question and the icon samples', async () => {
    const { instance } = setup();

    expect(instance.lastFrame()).toContain('Nerd Font check');
    expect(instance.lastFrame()).toContain('folder icon');
    expect(instance.lastFrame()).toContain('git branch icon');
    expect(instance.lastFrame()).toContain('Yes, I already have one');
    expect(instance.lastFrame()).toContain('No, install one for me');
    expect(instance.lastFrame()).toContain('No, use text symbols only');
  });

  it('answers with a font installed and does not flag one for install', async () => {
    const { instance, onNext } = setup();
    await flush();

    instance.stdin.write('\r');
    await flush();

    expect(onNext).toHaveBeenCalledWith({ hasNerdFont: true, nerdFontToInstall: NO_NERD_FONT });
  });

  it('asks for a font and routes to the font picker step', async () => {
    const { instance, onNext } = setup();
    await flush();

    instance.stdin.write('\u001B[B'); // have -> install
    await flush();
    instance.stdin.write('\r');
    await flush();

    expect(onNext).toHaveBeenCalledWith({
      hasNerdFont: true,
      nerdFontToInstall: { kind: 'select' },
    });
  });

  it('answers without a font and keeps text symbols', async () => {
    const { instance, onNext } = setup();
    await flush();

    instance.stdin.write('\u001B[B'); // have -> install
    await flush();
    instance.stdin.write('\u001B[B'); // install -> none
    await flush();
    instance.stdin.write('\r');
    await flush();

    expect(onNext).toHaveBeenCalledWith({ hasNerdFont: false, nerdFontToInstall: NO_NERD_FONT });
  });

  it('goes back on escape', async () => {
    const { instance, onBack } = setup();
    await flush();

    await pressEsc(instance.stdin);

    expect(onBack).toHaveBeenCalled();
  });
});
