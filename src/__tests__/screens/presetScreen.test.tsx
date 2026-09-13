import { cleanup, render } from 'ink-testing-library';
import { Component, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PRESETS } from '../../config/presets.ts';
import { PresetScreen } from '../../screens/PresetScreen.tsx';
import { DEFAULT_STATE } from '../../types.ts';
import { pressEsc } from '../helpers/ink.ts';
import { flush } from '../helpers/wait.ts';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function setup(hasNerdFont = false) {
  const onNext = vi.fn();
  const onBack = vi.fn();
  const instance = render(
    <PresetScreen state={{ ...DEFAULT_STATE, hasNerdFont }} onNext={onNext} onBack={onBack} />
  );
  return { instance, onNext, onBack };
}

/**
 * Ink wraps every tree in its own ErrorBoundary, which swallows a render-phase
 * throw into an error screen. This inner boundary (rendered *above* the screen)
 * catches that throw first so the test can assert on it.
 */
interface CaptureBoundaryProps {
  children: ReactNode;
  onError: (error: Error) => void;
}

class CaptureBoundary extends Component<CaptureBoundaryProps, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error) {
    this.props.onError(error);
  }

  override render() {
    return this.state.error ? null : this.props.children;
  }
}

describe('PresetScreen', () => {
  it('shows the first preset highlighted with its description', async () => {
    const { instance } = setup();
    await flush();

    const frame = instance.lastFrame();
    expect(frame).toContain('Custom (start from scratch)');
    expect(frame).toContain('Choose each option manually');
  });

  it('hides Nerd Font presets and explains why when there is no Nerd Font', async () => {
    const { instance } = setup(false);
    await flush();

    const frame = instance.lastFrame();
    // The notice wraps mid-sentence in the 100-col frame.
    expect(frame).toContain('hidden (no Nerd Font detected)');
    expect(frame).not.toContain('Nerd Font Symbols');
    expect(frame).not.toContain('★');
  });

  it('flags Nerd Font presets with ★ when a Nerd Font is installed', async () => {
    const { instance } = setup(true);
    await flush();

    const frame = instance.lastFrame();
    expect(frame).toContain('★ = requires Nerd Font');
    expect(frame).toContain('Nerd Font Symbols ★');
  });

  it('swaps the description as the highlight moves with Down', async () => {
    const { instance } = setup(false);
    await flush();
    expect(instance.lastFrame()).toContain('Choose each option manually');

    instance.stdin.write('\u001B[B');
    await flush();

    const frame = instance.lastFrame();
    expect(frame).not.toContain('Choose each option manually');
    expect(frame).toContain('Pure Unicode/text symbols in base ANSI colours');
  });

  it('commits the highlighted preset on Enter', async () => {
    const { instance, onNext } = setup(false);
    await flush();

    // No Nerd Font is the second preset; one Down, then Enter.
    instance.stdin.write('\u001B[B');
    await flush();
    instance.stdin.write('\r');
    await flush();

    expect(onNext).toHaveBeenCalledWith({
      preset: 'no-nerd-font',
      leftModules: PRESETS.find((p) => p.id === 'no-nerd-font')!.leftModules,
      rightModules: ['cmd_duration'],
      palette: 'terminal',
      powerline: false,
    });
  });

  it('commits a Nerd Font preset when one is installed', async () => {
    const { instance, onNext } = setup(true);
    await flush();

    // Nerd Font Symbols is the second item; one Down then Enter.
    instance.stdin.write('\u001B[B');
    await flush();
    instance.stdin.write('\r');
    await flush();

    expect(onNext).toHaveBeenCalledWith({
      preset: 'nerd-font-symbols',
      leftModules: PRESETS.find((p) => p.id === 'nerd-font-symbols')!.leftModules,
      rightModules: ['nodejs', 'python', 'rust', 'cmd_duration'],
      palette: 'vivid',
      powerline: false,
    });
  });

  it('backs out on Escape', async () => {
    const { instance, onNext, onBack } = setup(false);
    await flush();

    await pressEsc(instance.stdin);

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onNext).not.toHaveBeenCalled();
  });

  it('throws when no preset is compatible', async () => {
    const saved = [...PRESETS];
    PRESETS.splice(0, PRESETS.length);
    try {
      const onError = vi.fn();
      render(
        <CaptureBoundary onError={onError}>
          <PresetScreen state={{ ...DEFAULT_STATE }} onNext={vi.fn()} onBack={vi.fn()} />
        </CaptureBoundary>
      );
      await flush();

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
      expect((onError.mock.calls[0][0] as Error).message).toBe('No compatible presets available');
    } finally {
      PRESETS.push(...saved);
    }
  });
});
