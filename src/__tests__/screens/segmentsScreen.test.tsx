import { cleanup, render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SegmentsScreen } from '../../screens/SegmentsScreen.tsx';
import { DEFAULT_STATE, type WizardState } from '../../types.ts';
import { pressEsc } from '../helpers/ink.ts';
import { flush } from '../helpers/wait.ts';

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

describe('SegmentsScreen', () => {
  it('renders the configurable modules without character', async () => {
    const { instance } = setup();
    await flush();
    expect(instance.lastFrame()).toContain('Username');
    expect(instance.lastFrame()).not.toContain('Prompt character');
  });

  it('renders the active description on its own indented line, not inline', async () => {
    const { instance } = setup();
    await flush();
    // Cursor starts at index 0 = username.
    const lines = (instance.lastFrame() ?? '').split('\n');
    const toggleLine = lines.find((l) => l.includes('Username'));
    const descriptionLine = lines.find((l) => l.includes('Current user (shown when SSH or root)'));
    expect(toggleLine).toBeTruthy();
    expect(descriptionLine).toBeTruthy();
    // The description is indented one column past the toggle marker, in the
    // same margin-based convention ShellScreen uses (margin 4).
    expect(descriptionLine!.indexOf('Current user')).toBe(toggleLine!.indexOf('[ ]') + 2);
    // And it sits on its own line, never on the toggle/label line.
    expect(descriptionLine).not.toContain('[✓]');
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
    await pressEsc(instance.stdin);
    expect(onBack).toHaveBeenCalled();
  });
});
