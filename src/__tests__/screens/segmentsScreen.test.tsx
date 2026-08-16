import { describe, it, expect, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { render, cleanup } from 'ink-testing-library';
import { SegmentsScreen } from '../../screens/SegmentsScreen.tsx';
import { DEFAULT_STATE, WizardState } from '../../types.ts';

afterEach(cleanup);

function setup(overrides: Partial<WizardState> = {}) {
  const state: WizardState = {
    ...DEFAULT_STATE,
    leftModules: ['directory', 'git_branch', 'character'],
    rightModules: [],
    ...overrides,
  };
  const onNext = vi.fn();
  const onUpdate = vi.fn();
  const onBack = vi.fn();
  const instance = render(
    <SegmentsScreen side="left" state={state} onNext={onNext} onUpdate={onUpdate} onBack={onBack} />
  );
  return { instance, onNext, onUpdate, onBack, state };
}

// Flush Ink's render + useInput effect re-subscription deterministically.
async function flush() {
  await act(async () => {});
}

describe('SegmentsScreen', () => {
  it('renders the configurable modules without character', async () => {
    const { instance } = setup();
    await flush();
    expect(instance.lastFrame()).toContain('Username');
    expect(instance.lastFrame()).not.toContain('Prompt character');
  });

  it('does not call onUpdate on initial mount', async () => {
    const { onUpdate } = setup();
    await flush();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('toggles a module and pushes the ordered list to the parent', async () => {
    const { instance, onUpdate } = setup();
    await flush();
    // Cursor starts at index 0 = username
    instance.stdin.write(' ');
    await flush();
    expect(onUpdate).toHaveBeenCalledWith({
      leftModules: ['username', 'directory', 'git_branch', 'character'],
    });
  });

  it('moves the cursor with the down arrow and toggles the next module', async () => {
    const { instance, onUpdate } = setup();
    await flush();
    instance.stdin.write('\u001B[B'); // down → hostname
    await flush();
    instance.stdin.write(' ');
    await flush();
    expect(onUpdate).toHaveBeenCalledWith({
      leftModules: ['hostname', 'directory', 'git_branch', 'character'],
    });
  });

  it('untoggles a module that was enabled by default', async () => {
    const { instance, onUpdate } = setup();
    await flush();
    // directory is at index 2 (username, hostname, directory, ...)
    instance.stdin.write('\u001B[B');
    await flush();
    instance.stdin.write('\u001B[B');
    await flush();
    instance.stdin.write(' ');
    await flush();
    expect(onUpdate).toHaveBeenCalledWith({
      leftModules: ['git_branch', 'character'],
    });
  });

  it('saves on Enter with character always appended', async () => {
    const { instance, onNext } = setup();
    await flush();
    instance.stdin.write('\r');
    await flush();
    expect(onNext).toHaveBeenCalledWith({
      leftModules: ['directory', 'git_branch', 'character'],
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
