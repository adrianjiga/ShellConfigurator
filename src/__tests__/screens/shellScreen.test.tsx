import { describe, it, expect, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { render, cleanup } from 'ink-testing-library';
import { ShellScreen } from '../../screens/ShellScreen.tsx';
import { DEFAULT_STATE } from '../../types.ts';
import { detectInstalledShellsAsync } from '../../services/detector.ts';

vi.mock('../../services/detector.ts', () => ({
  detectInstalledShellsAsync: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function setup() {
  const state = { ...DEFAULT_STATE, selectedShells: [], installedShells: [] };
  const onNext = vi.fn();
  const onUpdate = vi.fn();
  const onBack = vi.fn();
  const instance = render(
    <ShellScreen state={state} onNext={onNext} onUpdate={onUpdate} onBack={onBack} />
  );
  return { instance, onNext, onUpdate, onBack, state };
}

async function flush() {
  await act(async () => {});
}

describe('ShellScreen', () => {
  it('blocks Enter while shell detection is in progress', async () => {
    vi.mocked(detectInstalledShellsAsync).mockReturnValue(new Promise(() => {}));
    const { instance, onNext } = setup();
    await flush();

    instance.stdin.write('\r');
    await flush();
    expect(onNext).not.toHaveBeenCalled();
    expect(instance.lastFrame()).toContain('Detecting installed shells');
  });

  it('blocks Enter when no shell is selected', async () => {
    vi.mocked(detectInstalledShellsAsync).mockResolvedValue(['zsh']);
    const { instance, onNext } = setup();
    await flush();
    await flush();

    instance.stdin.write('\r');
    await flush();
    expect(onNext).not.toHaveBeenCalled();
    expect(instance.lastFrame()).toContain('Select at least one shell to continue.');
  });

  it('confirms a selected shell with its detection result', async () => {
    vi.mocked(detectInstalledShellsAsync).mockResolvedValue(['zsh']);
    const { instance, onNext } = setup();
    await flush();
    await flush();

    instance.stdin.write(' '); // toggle zsh (cursor 0)
    await flush();
    instance.stdin.write('\r');
    await flush();

    expect(onNext).toHaveBeenCalledWith({
      selectedShells: ['zsh'],
      installedShells: ['zsh'],
      setDefaultShell: null,
    });
  });

  it('sets the default shell with D and confirms it', async () => {
    vi.mocked(detectInstalledShellsAsync).mockResolvedValue(['zsh', 'bash']);
    const { instance, onNext } = setup();
    await flush();
    await flush();

    instance.stdin.write(' '); // select zsh
    await flush();
    instance.stdin.write('d'); // make it the login shell
    await flush();
    expect(instance.lastFrame()).toContain('[will set as login shell]');

    instance.stdin.write('\r');
    await flush();
    expect(onNext).toHaveBeenCalledWith({
      selectedShells: ['zsh'],
      installedShells: ['zsh', 'bash'],
      setDefaultShell: 'zsh',
    });
  });

  it('clears the default shell when the selected shell is deselected', async () => {
    vi.mocked(detectInstalledShellsAsync).mockResolvedValue(['zsh']);
    const { instance, onNext } = setup();
    await flush();
    await flush();

    instance.stdin.write(' '); // select zsh
    await flush();
    instance.stdin.write('d'); // default zsh
    await flush();
    instance.stdin.write(' '); // deselect zsh
    await flush();
    expect(instance.lastFrame()).not.toContain('[will set as login shell]');
    expect(instance.lastFrame()).toContain('Select at least one shell to continue.');

    instance.stdin.write('\r');
    await flush();
    expect(onNext).not.toHaveBeenCalled();
  });

  it('navigates with arrow keys and reports installed shells to the parent', async () => {
    vi.mocked(detectInstalledShellsAsync).mockResolvedValue(['zsh']);
    const { instance, onUpdate } = setup();
    await flush();
    await flush();

    instance.stdin.write('\u001B[B'); // down → bash
    await flush();
    instance.stdin.write(' ');
    await flush();

    expect(onUpdate).toHaveBeenCalledWith({ installedShells: ['zsh'] });
    expect(instance.lastFrame()).toContain('› [✓] Bash');
  });

  it('calls onBack on Escape', async () => {
    vi.mocked(detectInstalledShellsAsync).mockResolvedValue(['zsh']);
    const { instance, onBack } = setup();
    await flush();
    await flush();

    instance.stdin.write('\u001B');
    await flush();
    expect(onBack).toHaveBeenCalled();
  });
});
