import { cleanup, render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReviewScreen } from '../../screens/ReviewScreen.tsx';
import { DEFAULT_STATE } from '../../types.ts';
import { pressEsc } from '../helpers/ink.ts';
import { flush } from '../helpers/wait.ts';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function setup(overrides: Partial<typeof DEFAULT_STATE> = {}) {
  const state = {
    ...DEFAULT_STATE,
    selectedShells: ['zsh'] as typeof DEFAULT_STATE.selectedShells,
    installedShells: ['zsh'] as typeof DEFAULT_STATE.installedShells,
    ...overrides,
  };
  const onNext = vi.fn();
  const onBack = vi.fn();
  const instance = render(<ReviewScreen state={state} onNext={onNext} onBack={onBack} />);
  return { instance, onNext, onBack, state };
}

describe('ReviewScreen', () => {
  it('lists the install plan and the config to write for the selected shells', async () => {
    const { instance } = setup();
    await flush();

    const frame = instance.lastFrame();
    expect(frame).toContain('Review your configuration');
    expect(frame).toContain('This run will');
    expect(frame).toContain('Starship');
    expect(frame).toContain('Write config files');
    expect(frame).toContain('Configure zsh');

    expect(frame).toContain('Configuration to write');
    // The per-shell config path, the rc export, and the generated TOML. Assert on
    // space-free tokens because ink wraps long lines at the narrow test terminal.
    expect(frame).toContain('starship/zsh.toml (Zsh)');
    expect(frame).toContain('STARSHIP_CONFIG="');
    expect(frame).toContain('eval "$(starship init zsh)"');
    expect(frame).toContain('$directory$git_branch$git_status');
  });

  it('does not list a starship task when the user chose to skip it', async () => {
    const { instance } = setup({ skipStarshipInstall: true });
    await flush();

    // "Starship prompt wizard" is the header, so match the task bullet specifically.
    expect(instance.lastFrame()).not.toContain('• Starship');
  });

  it('lists a missing shell as something the run will install', async () => {
    const { instance } = setup({ installedShells: [] });
    await flush();

    expect(instance.lastFrame()).toContain('Install zsh');
  });

  it('shows the manual setup command for shells without an rc file', async () => {
    const { instance } = setup({ selectedShells: ['nushell'] });
    await flush();

    const frame = instance.lastFrame();
    expect(frame).toContain('starship/nushell.toml (Nushell)');
    // Space-free tokens: the nushell init command is long and gets wrapped.
    expect(frame).toContain('vendor/autoload');
    expect(frame).toContain('$env.STARSHIP_CONFIG');
  });

  it('lists a chosen Nerd Font as part of the install plan', async () => {
    const { instance } = setup({ nerdFontToInstall: { kind: 'install', id: 'JetBrainsMono' } });
    await flush();

    expect(instance.lastFrame()).toContain('Nerd Font (JetBrains Mono)');
  });

  it('confirms with Enter', async () => {
    const { instance, onNext } = setup();
    await flush();

    instance.stdin.write('\r');
    await flush();
    expect(onNext).toHaveBeenCalled();
  });

  it('confirms with Space as well', async () => {
    const { instance, onNext } = setup();
    await flush();

    instance.stdin.write(' ');
    await flush();
    expect(onNext).toHaveBeenCalled();
  });

  it('goes back with Esc', async () => {
    const { instance, onBack } = setup();
    await flush();

    await pressEsc(instance.stdin);
    expect(onBack).toHaveBeenCalled();
  });

  it('warns that nothing will be applied in dry-run mode', async () => {
    const { instance } = setup({ dryRun: true });
    await flush();

    expect(instance.lastFrame()).toContain('--dry-run');
  });
});
