import { cleanup, render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FontSelectScreen } from '../../screens/FontSelectScreen.tsx';
import { DEFAULT_STATE } from '../../types.ts';
import { pressEsc } from '../helpers/ink.ts';
import { flush } from '../helpers/wait.ts';

vi.mock('../../services/installer.ts', () => ({
  NERD_FONTS: [
    { id: 'JetBrainsMono', label: 'JetBrains Mono' },
    { id: 'FiraCode', label: 'Fira Code' },
  ],
  getNerdFontsDir: () => '/tmp/test-fonts',
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function setup() {
  const onNext = vi.fn();
  const onBack = vi.fn();
  const instance = render(
    <FontSelectScreen state={{ ...DEFAULT_STATE }} onNext={onNext} onBack={onBack} />
  );
  return { instance, onNext, onBack };
}

describe('FontSelectScreen', () => {
  it('renders the font choices and install destination', async () => {
    const { instance } = setup();

    expect(instance.lastFrame()).toContain('Choose a Nerd Font to install');
    expect(instance.lastFrame()).toContain('JetBrains Mono');
    expect(instance.lastFrame()).toContain('Fira Code');
    expect(instance.lastFrame()).toContain('/tmp/test-fonts');
  });

  it('selects a font with Enter and flags it for install', async () => {
    const { instance, onNext } = setup();
    await flush();

    instance.stdin.write('\r');
    await flush();

    expect(onNext).toHaveBeenCalledWith({
      nerdFontToInstall: { kind: 'install', id: 'JetBrainsMono' },
      hasNerdFont: true,
    });
  });

  it('goes back on escape', async () => {
    const { instance, onBack } = setup();
    await flush();

    await pressEsc(instance.stdin);

    expect(onBack).toHaveBeenCalled();
  });
});
