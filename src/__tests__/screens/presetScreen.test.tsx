import { cleanup, render } from 'ink-testing-library';
import { Component, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PRESETS, type PresetDef } from '../../config/presets.ts';
import { PresetScreen } from '../../screens/PresetScreen.tsx';
import { DEFAULT_STATE, type WizardState } from '../../types.ts';
import { pressEsc } from '../helpers/ink.ts';
import { flush } from '../helpers/wait.ts';

afterEach(cleanup);

/**
 * Reaches an error the way the boundary would in production: without it, Ink's
 * own error boundary swallows the throw and unmounts the app, so the rendered
 * frame is not a reliable place to assert on it.
 */
class CaptureBoundary extends Component<
  { onError: (error: Error) => void; children: ReactNode },
  { error: Error | null }
> {
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  state: { error: Error | null } = { error: null };
  componentDidCatch(error: Error) {
    this.props.onError(error);
  }
  render() {
    return this.state.error ? null : this.props.children;
  }
}

function setup(overrides: Partial<WizardState> = {}) {
  const state: WizardState = { ...DEFAULT_STATE, ...overrides };
  const onNext = vi.fn();
  const onBack = vi.fn();
  const instance = render(<PresetScreen state={state} onNext={onNext} onBack={onBack} />);
  return { instance, onNext, onBack };
}

const DOWN = '\u001B[B';
const ENTER = '\r';

describe('PresetScreen', () => {
  it('renders the compatible presets with descriptions', async () => {
    const { instance, onBack } = setup();
    await flush();

    const frame = instance.lastFrame() ?? '';
    expect(frame).toContain('Choose a starting preset');
    expect(frame).toContain('Custom (start from scratch)');
    expect(frame).toContain('No Nerd Font');
    // The first (highlighted) preset's description sits below the list.
    expect(frame).toContain('Choose each option manually');
    expect(onBack).not.toHaveBeenCalled();
  });

  it('hides Nerd Font presets and their marker when no font is installed', async () => {
    const { instance } = setup();
    await flush();

    const frame = instance.lastFrame() ?? '';
    // A real Nerd-Font-only preset must not be offered without one.
    expect(frame).not.toContain('Nerd Font Symbols');
    expect(frame).not.toContain('Tokyo Night');
    expect(frame).not.toContain('Gruvbox Rainbow');
    // No ★ suffixes are shown, and the yellow notice explains why. (The notice
    // wraps across two columns, so assert on the fragment that stays on a line.)
    expect(frame).not.toContain('★');
    expect(frame).toContain('hidden (no Nerd Font detected)');
  });

  it('shows Nerd Font presets with a ★ marker when one is installed', async () => {
    const { instance } = setup({ hasNerdFont: true });
    await flush();

    const frame = instance.lastFrame() ?? '';
    expect(frame).toContain('Nerd Font Symbols ★');
    expect(frame).toContain('★ = requires Nerd Font');
    expect(frame).not.toContain('Nerd Font presets hidden (no Nerd Font detected)');
  });

  it('swaps the description when the highlight moves', async () => {
    const { instance } = setup();
    await flush();
    expect(instance.lastFrame()).toContain('Choose each option manually');

    instance.stdin.write(DOWN); // custom → no-nerd-font
    await flush();

    const frame = instance.lastFrame() ?? '';
    expect(frame).toContain('Pure Unicode/text symbols in base ANSI colours');
    expect(frame).not.toContain('Choose each option manually');
  });

  it('commits the selected preset to the wizard state', async () => {
    const { instance, onNext } = setup();
    await flush();

    instance.stdin.write(DOWN); // custom → no-nerd-font
    await flush();
    instance.stdin.write(ENTER);
    await flush();

    expect(onNext).toHaveBeenCalledWith({
      preset: 'no-nerd-font',
      leftModules: ['directory', 'git_branch', 'git_status', 'character'],
      rightModules: ['cmd_duration'],
      palette: 'terminal',
      powerline: false,
    });
  });

  it('commits a Nerd Font preset when the user has one', async () => {
    const { instance, onNext } = setup({ hasNerdFont: true });
    await flush();

    instance.stdin.write(DOWN); // custom → nerd-font-symbols
    await flush();
    instance.stdin.write(ENTER);
    await flush();

    expect(onNext).toHaveBeenCalledWith({
      preset: 'nerd-font-symbols',
      leftModules: ['username', 'hostname', 'directory', 'git_branch', 'git_status', 'character'],
      rightModules: ['nodejs', 'python', 'rust', 'cmd_duration'],
      palette: 'vivid',
      powerline: false,
    });
  });

  it('calls onBack on Escape', async () => {
    const { instance, onBack } = setup();
    await flush();
    await pressEsc(instance.stdin);
    expect(onBack).toHaveBeenCalled();
  });

  it('throws when no preset is compatible with the font state', async () => {
    const original = [...PRESETS];
    (PRESETS as PresetDef[]).splice(0, PRESETS.length);
    const errors: Error[] = [];
    try {
      render(
        <CaptureBoundary onError={(e) => errors.push(e)}>
          <PresetScreen state={{ ...DEFAULT_STATE }} onNext={vi.fn()} onBack={vi.fn()} />
        </CaptureBoundary>
      );
      await flush();
      expect(errors).toHaveLength(1);
      expect(errors[0]!.message).toBe('No compatible presets available');
    } finally {
      (PRESETS as PresetDef[]).splice(0, PRESETS.length, ...original);
    }
  });
});
