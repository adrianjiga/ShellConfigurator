import { cleanup, render } from 'ink-testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstallingScreen } from '../../screens/InstallingScreen.tsx';
import type { InstallTaskDeps } from '../../services/installTasks.ts';
import type { InstallTask, WizardState } from '../../types.ts';
import { DEFAULT_STATE } from '../../types.ts';
import { flush, waitFor } from '../helpers/wait.ts';

const mocks = vi.hoisted(() => ({
  buildTaskList: vi.fn<(state: WizardState) => InstallTask[]>(),
  runInstallTasks:
    vi.fn<
      (
        state: WizardState,
        deps: InstallTaskDeps,
        onUpdate: (id: string, patch: Partial<InstallTask>) => void,
        signal?: AbortSignal
      ) => Promise<InstallTask[]>
    >(),
  killActiveCommand: vi.fn<() => void>(),
  subscribeToUiSuspension: vi.fn<(listener: (suspended: boolean) => void) => () => void>(),
  isUiSuspended: vi.fn<() => boolean>(),
}));

vi.mock('../../services/exec.ts', () => ({
  killActiveCommand: () => mocks.killActiveCommand(),
}));

vi.mock('../../services/installTasks.ts', () => ({
  buildTaskList: (state: WizardState): InstallTask[] => mocks.buildTaskList(state),
  runInstallTasks: (
    state: WizardState,
    deps: InstallTaskDeps,
    onUpdate: (id: string, patch: Partial<InstallTask>) => void,
    signal?: AbortSignal
  ): Promise<InstallTask[]> => mocks.runInstallTasks(state, deps, onUpdate, signal),
  DEFAULT_INSTALL_TASK_DEPS: {},
}));

vi.mock('../../services/tty.ts', () => ({
  subscribeToUiSuspension: (listener: (suspended: boolean) => void) =>
    mocks.subscribeToUiSuspension(listener),
  isUiSuspended: () => mocks.isUiSuspended(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  mocks.buildTaskList.mockReturnValue([]);
  mocks.isUiSuspended.mockReturnValue(false);
});

function setup() {
  const onNext = vi.fn();
  const instance = render(<InstallingScreen state={{ ...DEFAULT_STATE }} onNext={onNext} />);
  return { instance, onNext };
}

/** A positive task fixture exercising every status, error, and note branch. */
function statusFixture(): InstallTask[] {
  return [
    { id: 'starship', label: 'Install Starship', status: 'running' },
    {
      id: 'rc_zsh',
      label: 'Configure zsh',
      status: 'failed',
      error: 'Unknown shell',
      note: 'hidden',
    },
    { id: 'config', label: 'Write config', status: 'done', note: 'shared config saved' },
    { id: 'font', label: 'Install Nerd Font', status: 'skipped' },
    { id: 'shell_zsh', label: 'Set default shell', status: 'pending' },
  ];
}

describe('InstallingScreen', () => {
  it('renders the task list with an icon per status', async () => {
    mocks.buildTaskList.mockReturnValue(statusFixture());
    const { instance } = setup();
    await flush();

    const frame = instance.lastFrame();
    expect(frame).toContain('[~]');
    expect(frame).toContain('[✗]');
    expect(frame).toContain('[✓]');
    expect(frame).toContain('[–]');
    expect(frame).toContain('[ ]');
    expect(frame).toContain('Install Starship');
    expect(frame).toContain('Configure zsh');
  });

  it('shows an error and hides its note, and shows a clean note', async () => {
    mocks.buildTaskList.mockReturnValue(statusFixture());
    const { instance } = setup();
    await flush();

    const frame = instance.lastFrame();
    expect(frame).toContain('Unknown shell');
    expect(frame).not.toContain('hidden');
    expect(frame).toContain('shared config saved');
  });

  it('cancels the run on c', async () => {
    let signal: AbortSignal | undefined;
    mocks.buildTaskList.mockReturnValue(statusFixture());
    mocks.runInstallTasks.mockImplementation(
      (
        _state: WizardState,
        _deps: InstallTaskDeps,
        _onUpdate: (id: string, patch: Partial<InstallTask>) => void,
        abortSignal?: AbortSignal
      ) => {
        signal = abortSignal;
        return new Promise<InstallTask[]>(() => {});
      }
    );
    const { instance } = setup();
    await flush();

    instance.stdin.write('c');
    await flush();

    expect(instance.lastFrame()).toContain('Cancelling');
    expect(mocks.killActiveCommand).toHaveBeenCalled();
    expect(signal).toBeDefined();
  });

  it('cancels the run on ctrl-c', async () => {
    mocks.buildTaskList.mockReturnValue(statusFixture());
    mocks.runInstallTasks.mockReturnValue(new Promise<InstallTask[]>(() => {}));
    const { instance } = setup();
    await flush();

    instance.stdin.write('\u0003');
    await flush();

    expect(instance.lastFrame()).toContain('Cancelling');
    expect(mocks.killActiveCommand).toHaveBeenCalled();
  });

  it('advances with the results once every task has finished', async () => {
    const results: InstallTask[] = [
      { id: 'starship', label: 'Install Starship', status: 'done' },
      { id: 'rc_zsh', label: 'Configure zsh', status: 'failed', error: 'Unknown shell' },
    ];
    mocks.buildTaskList.mockReturnValue(results);
    mocks.runInstallTasks.mockResolvedValue(results);
    const { instance, onNext } = setup();
    await flush();

    await waitFor(() => instance.lastFrame()?.includes('All done'));
    expect(instance.lastFrame()).toContain('All done');
    expect(instance.lastFrame()).toContain('Unknown shell');

    await waitFor(() => onNext.mock.calls.length > 0);
    expect(onNext).toHaveBeenCalledWith({ installResults: results });
  });

  it('renders nothing while an interactive child owns the terminal', async () => {
    mocks.isUiSuspended.mockReturnValue(true);
    const { instance } = setup();
    await flush();

    expect(instance.lastFrame() ?? '').toBe('');
    expect(mocks.subscribeToUiSuspension).toHaveBeenCalled();
  });
});
