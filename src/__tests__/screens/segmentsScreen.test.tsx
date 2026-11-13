import { cleanup, render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SegmentsScreen } from '../../screens/SegmentsScreen.tsx';
import { DEFAULT_STATE, type WizardState } from '../../types.ts';
import { pressEsc } from '../helpers/ink.ts';
import { flush } from '../helpers/wait.ts';

afterEach(cleanup);

const DOWN = '\u001B[B';
const SHIFT_DOWN = '\u001B[1;2B';
const SHIFT_UP = '\u001B[1;2A';
const BACKSPACE = '\u007F';

function setup(overrides: Partial<WizardState> = {}, side: 'left' | 'right' = 'left') {
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
    <SegmentsScreen side={side} state={state} onNext={onNext} onUpdate={onUpdate} onBack={onBack} />
  );
  return { instance, onNext, onUpdate, onBack, state };
}

async function press(instance: ReturnType<typeof render>, ...keys: string[]) {
  for (const key of keys) {
    instance.stdin.write(key);
    await flush();
  }
}

describe('SegmentsScreen', () => {
  it('renders the configurable modules without character', async () => {
    const { instance } = setup();
    await flush();
    expect(instance.lastFrame()).toContain('Username');
    expect(instance.lastFrame()).not.toContain('Prompt character');
  });

  it('shows selected modules in prompt order, then the available ones', async () => {
    const { instance } = setup();
    await flush();
    const frame = instance.lastFrame() ?? '';
    expect(frame.indexOf('Prompt order')).toBeLessThan(frame.indexOf('1. Directory'));
    expect(frame.indexOf('1. Directory')).toBeLessThan(frame.indexOf('2. Git Branch'));
    expect(frame.indexOf('2. Git Branch')).toBeLessThan(frame.indexOf('Available'));
    expect(frame.indexOf('Available')).toBeLessThan(frame.indexOf('Username'));
  });

  it('renders the active description on its own indented line, not inline', async () => {
    const { instance } = setup();
    await flush();
    // Cursor starts on the first selected module: directory.
    const lines = (instance.lastFrame() ?? '').split('\n');
    const toggleLine = lines.find((l) => l.includes('Directory'));
    const descriptionLine = lines.find((l) => l.includes('Current directory path'));
    expect(toggleLine).toBeTruthy();
    expect(descriptionLine).toBeTruthy();
    // The description is indented one column past the checkbox marker, in the
    // same margin-based convention ShellScreen uses (margin 4).
    expect(descriptionLine!.indexOf('Current directory')).toBe(toggleLine!.indexOf('[✓]') + 2);
    // And it sits on its own line, never on the toggle/label line.
    expect(descriptionLine).not.toContain('[✓]');
  });

  it('does not call onUpdate on initial mount', async () => {
    const { onUpdate } = setup();
    await flush();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('takes a module off the right side when it is picked on the left', async () => {
    const { instance, onUpdate } = setup({ rightModules: ['username', 'time'] });
    await flush();
    await press(instance, DOWN, DOWN, ' ');
    expect(onUpdate).toHaveBeenLastCalledWith({
      leftModules: ['directory', 'git_branch', 'username', 'character'],
      rightModules: ['time'],
    });
  });

  it('appends a newly enabled module to the end of the prompt order', async () => {
    const { instance, onUpdate } = setup();
    await flush();
    // directory, git_branch, username
    await press(instance, DOWN, DOWN, ' ');
    expect(onUpdate).toHaveBeenCalledWith({
      leftModules: ['directory', 'git_branch', 'username', 'character'],
      rightModules: [],
    });
  });

  it('removes a selected module and pushes the remaining order', async () => {
    const { instance, onUpdate } = setup();
    await flush();
    await press(instance, ' ');
    expect(onUpdate).toHaveBeenCalledWith({
      leftModules: ['git_branch', 'character'],
      rightModules: [],
    });
  });

  it('moves the cursor with the down arrow and toggles the next module', async () => {
    const { instance, onUpdate } = setup();
    await flush();
    await press(instance, DOWN, ' ');
    expect(onUpdate).toHaveBeenCalledWith({
      leftModules: ['directory', 'character'],
      rightModules: [],
    });
  });

  it('saves on Enter with character always appended', async () => {
    const { instance, onNext } = setup();
    await flush();
    await press(instance, '\r');
    expect(onNext).toHaveBeenCalledWith({
      leftModules: ['directory', 'git_branch', 'character'],
      rightModules: [],
    });
  });

  it('calls onBack on Escape when there is no search text', async () => {
    const { instance, onBack } = setup();
    await flush();
    await pressEsc(instance.stdin);
    expect(onBack).toHaveBeenCalled();
  });

  it('filters the list by label', async () => {
    const { instance } = setup();
    await flush();
    await press(instance, 'g', 'i', 't');
    const frame = instance.lastFrame() ?? '';
    expect(frame).toContain('Git Branch');
    expect(frame).toContain('Git Status');
    expect(frame).not.toContain('Username');
  });

  it('filters by description too', async () => {
    const { instance } = setup();
    await flush();
    await press(instance, 'v', 'e', 'r', 's', 'i', 'o', 'n');
    const frame = instance.lastFrame() ?? '';
    expect(frame).toContain('Node.js');
    expect(frame).toContain('Python');
    expect(frame).not.toContain('Directory');
  });

  it('deletes filter text with backspace', async () => {
    const { instance } = setup();
    await flush();
    await press(instance, 'g', 'i', 't', BACKSPACE, BACKSPACE, BACKSPACE);
    expect(instance.lastFrame()).toContain('Username');
  });

  it('clears the filter on the first Escape and leaves on the second', async () => {
    const { instance, onBack } = setup();
    await flush();
    await press(instance, 'g', 'i', 't');
    expect(instance.lastFrame()).not.toContain('Username');

    await pressEsc(instance.stdin);
    expect(onBack).not.toHaveBeenCalled();
    expect(instance.lastFrame()).toContain('Username');

    await pressEsc(instance.stdin);
    expect(onBack).toHaveBeenCalled();
  });

  it('shows a message when nothing matches the filter', async () => {
    const { instance } = setup();
    await flush();
    await press(instance, 'z', 'z', 'z');
    expect(instance.lastFrame()).toContain('No modules match');
  });

  it('reorders the prompt with Shift+Down', async () => {
    const { instance, onUpdate } = setup();
    await flush();
    await press(instance, SHIFT_DOWN);
    expect(onUpdate).toHaveBeenCalledWith({
      leftModules: ['git_branch', 'directory', 'character'],
      rightModules: [],
    });
  });

  it('reorders the prompt with Shift+Up', async () => {
    const { instance, onUpdate } = setup();
    await flush();
    await press(instance, DOWN, SHIFT_UP);
    expect(onUpdate).toHaveBeenCalledWith({
      leftModules: ['git_branch', 'directory', 'character'],
      rightModules: [],
    });
  });

  it('clamps reordering at the top and bottom of the selected list', async () => {
    const { instance, onUpdate } = setup();
    await flush();
    await press(instance, SHIFT_UP);
    expect(onUpdate).not.toHaveBeenCalled();

    await press(instance, DOWN, SHIFT_DOWN);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('ignores reorder keys on an available module', async () => {
    const { instance, onUpdate } = setup();
    await flush();
    await press(instance, DOWN, DOWN, SHIFT_DOWN);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('reorders the underlying list while a filter is active', async () => {
    const { instance, onUpdate } = setup({
      leftModules: ['directory', 'git_branch', 'git_status', 'character'],
    });
    await flush();
    await press(instance, 'g', 'i', 't');
    // Filtered selected rows are git_branch then git_status.
    await press(instance, SHIFT_DOWN);
    expect(onUpdate).toHaveBeenCalledWith({
      leftModules: ['directory', 'git_status', 'git_branch', 'character'],
      rightModules: [],
    });
  });

  it('toggles a row from a filtered list', async () => {
    const { instance, onUpdate } = setup({
      leftModules: ['directory', 'git_branch', 'git_status', 'character'],
    });
    await flush();
    await press(instance, 'g', 'i', 't');
    await press(instance, ' ');
    expect(onUpdate).toHaveBeenCalledWith({
      leftModules: ['directory', 'git_status', 'character'],
      rightModules: [],
    });
  });

  it('marks modules already on the left as unavailable on the right', async () => {
    const { instance, onUpdate } = setup({ leftModules: ['directory', 'character'] }, 'right');
    await flush();
    const frame = instance.lastFrame() ?? '';
    expect(frame).toContain('[–]');
    expect(frame).toContain('already on the left');

    // Rows: username, hostname, directory (taken) — toggling it is a no-op.
    await press(instance, DOWN, DOWN, ' ');
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('shows right-side selections in prompt order', async () => {
    const { instance } = setup({ rightModules: ['nodejs', 'python'] }, 'right');
    await flush();
    const frame = instance.lastFrame() ?? '';
    expect(frame.indexOf('1. Node.js')).toBeLessThan(frame.indexOf('2. Python'));
  });
});

describe('SegmentsScreen filter', () => {
  it('moves the cursor to the first match when the filter changes', async () => {
    const { instance } = setup();
    await flush();
    // Many modules match "o", so a clamped cursor would stay on the fourth row.
    await press(instance, DOWN, DOWN, DOWN, 'o');
    expect(instance.lastFrame()).toMatch(/›.*Directory/);
  });

  it('does not leave the screen on ← while a filter is typed', async () => {
    const { instance, onBack } = setup();
    await flush();
    await press(instance, 'g', '\u001B[D');
    expect(onBack).not.toHaveBeenCalled();
    expect(instance.lastFrame()).toContain('Filter: g');
  });
});
