import { cleanup, render } from 'ink-testing-library';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstallingScreen, setAdvanceDelayForTests } from '../../screens/InstallingScreen.tsx';
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
  subscribeToUiSuspension: vi.fn<(listener: (suspended: boolean) => void) => () => void>(),
  isUiSuspended: vi.fn<() => boolean>(),
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
  setAdvanceDelayForTests(0);
});

/** Keeps the run pending and hands back the abort signal it was given. */
function captureSignal(): { current?: AbortSignal } {
  const captured: { current?: AbortSignal } = {};
  mocks.runInstallTasks.mockImplementation((_state, _deps, _onUpdate, abortSignal) => {
    captured.current = abortSignal;
    return new Promise<InstallTask[]>(() => {});
  });
  return captured;
}

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
    expect(signal?.aborted).toBe(true);
  });

  it('cancels the run on ctrl-c', async () => {
    mocks.buildTaskList.mockReturnValue(statusFixture());
    const signal = captureSignal();
    const { instance } = setup();
    await flush();

    instance.stdin.write('\u0003');
    await flush();

    expect(instance.lastFrame()).toContain('Cancelling');
    expect(signal.current?.aborted).toBe(true);
  });

  it('cancels the run on an uppercase C', async () => {
    mocks.buildTaskList.mockReturnValue(statusFixture());
    const signal = captureSignal();
    const { instance } = setup();
    await flush();

    instance.stdin.write('C');
    await flush();

    expect(instance.lastFrame()).toContain('Cancelling');
    expect(signal.current?.aborted).toBe(true);
  });

  it('does not advance after an unmount while the run is still finishing', async () => {
    mocks.buildTaskList.mockReturnValue(statusFixture());
    let resolveRun: (tasks: InstallTask[]) => void = () => {};
    mocks.runInstallTasks.mockImplementation(
      () => new Promise<InstallTask[]>((resolve) => (resolveRun = resolve))
    );
    const { instance, onNext } = setup();
    await flush();

    instance.unmount();
    resolveRun([{ id: 'starship', label: 'Install Starship', status: 'done' }]);
    await new Promise((r) => setTimeout(r, 0));

    expect(onNext).not.toHaveBeenCalled();
  });

  it('aborts the chain on unmount', async () => {
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

    instance.unmount();

    expect(signal?.aborted).toBe(true);
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

    // One step failed, so the finish line must not claim success.
    await waitFor(() => instance.lastFrame()?.includes('Finished with errors'));
    expect(instance.lastFrame()).not.toContain('All done');
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

describe('InstallingScreen SIGINT', () => {
  it('cancels the run when Ctrl+C reaches the process as SIGINT', async () => {
    mocks.buildTaskList.mockReturnValue(statusFixture());
    const signal = captureSignal();
    setup();
    await flush();

    process.emit('SIGINT');
    await flush();

    expect(signal.current?.aborted).toBe(true);
  });

  it('stops listening for SIGINT once the screen is gone', async () => {
    mocks.buildTaskList.mockReturnValue(statusFixture());
    captureSignal();
    const ours = () =>
      process.listeners('SIGINT').filter((l) => l.toString().includes('setCancelling'));
    const { instance } = setup();
    await flush();
    expect(ours()).toHaveLength(1);
    instance.unmount();
    await flush();
    expect(ours()).toHaveLength(0);
  });
});

describe('InstallingScreen when the chain throws', () => {
  it('reports every step as failed and moves on instead of hanging', async () => {
    mocks.buildTaskList.mockReturnValue(statusFixture());
    mocks.runInstallTasks.mockRejectedValue(new Error('chain broke'));
    const { onNext } = setup();
    await waitFor(() => onNext.mock.calls.length > 0);

    const results = onNext.mock.calls[0]![0].installResults as InstallTask[];
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((t) => t.status === 'failed' && t.error === 'chain broke')).toBe(true);
  });
});

describe('InstallingScreen under StrictMode', () => {
  it('still finishes when React mounts the effect twice', async () => {
    mocks.buildTaskList.mockReturnValue(statusFixture());
    mocks.runInstallTasks.mockImplementation(async (_s, _d, _u, signal) =>
      signal?.aborted ? [] : [{ id: 'starship', label: 'Starship', status: 'done' }]
    );
    const onNext = vi.fn();
    render(
      <StrictMode>
        <InstallingScreen state={{ ...DEFAULT_STATE }} onNext={onNext} />
      </StrictMode>
    );
    await waitFor(() => onNext.mock.calls.length > 0);
    expect(onNext).toHaveBeenCalledWith({
      installResults: [{ id: 'starship', label: 'Starship', status: 'done' }],
    });
  });
});

describe('InstallingScreen finish line', () => {
  it('does not say all done when a step failed', async () => {
    setAdvanceDelayForTests(10_000);
    mocks.buildTaskList.mockReturnValue([{ id: 'starship', label: 'Starship', status: 'pending' }]);
    mocks.runInstallTasks.mockImplementation(async (_s, _d, onUpdate) => {
      onUpdate('starship', { status: 'failed', error: 'boom' });
      return [{ id: 'starship', label: 'Starship', status: 'failed', error: 'boom' }];
    });
    const { instance } = setup();
    await flush();
    await flush();
    expect(instance.lastFrame()).toContain('Finished with errors');
    expect(instance.lastFrame()).not.toContain('All done');
    setAdvanceDelayForTests(0);
  });
});

describe('InstallingScreen after the run', () => {
  it('ignores c once every step has finished', async () => {
    setAdvanceDelayForTests(10_000);
    const done: InstallTask[] = [{ id: 'starship', label: 'Starship', status: 'done' }];
    mocks.buildTaskList.mockReturnValue(done);
    mocks.runInstallTasks.mockResolvedValue(done);
    const { instance } = setup();
    await flush();
    await flush();
    instance.stdin.write('c');
    await flush();
    expect(instance.lastFrame()).not.toContain('Cancelling');
    setAdvanceDelayForTests(0);
  });
});

describe('InstallingScreen prompt notice', () => {
  it('only mentions password prompts when a step can ask for one', async () => {
    mocks.buildTaskList.mockReturnValue([
      { id: 'config', label: 'Write config files', status: 'pending' },
    ]);
    mocks.runInstallTasks.mockReturnValue(new Promise<InstallTask[]>(() => {}));
    const quiet = setup();
    await flush();
    expect(quiet.instance.lastFrame()).not.toContain('Password prompts');
    cleanup();

    mocks.buildTaskList.mockReturnValue([{ id: 'chsh', label: 'Set zsh', status: 'pending' }]);
    const loud = setup();
    await flush();
    expect(loud.instance.lastFrame()).toContain('Password prompts');
  });
});
