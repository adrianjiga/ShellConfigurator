import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

const { mockExecFileSync, mockSpawn } = vi.hoisted(() => ({
  mockExecFileSync: vi.fn(),
  mockSpawn: vi.fn(),
}));

vi.mock('child_process', () => ({
  execFileSync: mockExecFileSync,
  spawn: mockSpawn,
  execFile: Object.assign(vi.fn(), {
    [Symbol.for('nodejs.util.promisify.custom')]: vi.fn(),
  }),
}));

import {
  commandExists,
  commandPath,
  runCommand,
  killActiveCommand,
  CommandCancelledError,
} from '../../services/exec.ts';
import { isUiSuspended, resetUiSuspension } from '../../services/tty.ts';

interface SpawnOutcome {
  status?: number | null;
  signal?: string | null;
  error?: Error;
  /** Never settles, so the command stays in flight. */
  hang?: boolean;
}

function childFor(outcome: SpawnOutcome) {
  const child = new EventEmitter() as EventEmitter & { kill: ReturnType<typeof vi.fn> };
  child.kill = vi.fn(() => child.emit('close', null, 'SIGTERM'));
  if (!outcome.hang) {
    setImmediate(() => {
      if (outcome.error) child.emit('error', outcome.error);
      else child.emit('close', outcome.status ?? 0, outcome.signal ?? null);
    });
  }
  return child;
}

function spawnOutcome(outcome: SpawnOutcome) {
  mockSpawn.mockImplementation(() => childFor(outcome));
}

beforeEach(() => {
  vi.clearAllMocks();
  resetUiSuspension();
  mockExecFileSync.mockReturnValue('');
  spawnOutcome({ status: 0 });
});

afterEach(() => resetUiSuspension());

describe('commandExists', () => {
  it('passes the command as an argument rather than splicing it into the script', () => {
    commandExists('curl');

    expect(mockExecFileSync).toHaveBeenCalledWith(
      'sh',
      ['-c', 'command -v "$1"', 'sh', 'curl'],
      expect.anything()
    );
  });

  it('does not let a crafted name become shell syntax', () => {
    commandExists('curl; rm -rf /');

    const args = mockExecFileSync.mock.calls[0]?.[1] as string[];
    // The dangerous text is data in $1, never part of the script itself.
    expect(args[1]).toBe('command -v "$1"');
    expect(args[3]).toBe('curl; rm -rf /');
  });

  it('reports false when the lookup fails', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('not found');
    });
    expect(commandExists('nope')).toBe(false);
  });
});

describe('commandPath', () => {
  it('returns the trimmed path', () => {
    mockExecFileSync.mockReturnValue('/usr/bin/zsh\n');
    expect(commandPath('zsh')).toBe('/usr/bin/zsh');
  });

  it('returns null when the command is absent', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('not found');
    });
    expect(commandPath('zsh')).toBeNull();
  });
});

describe('runCommand', () => {
  it('rejects an empty command', async () => {
    await expect(runCommand([])).rejects.toThrow('Empty command');
  });

  it('resolves on a clean exit', async () => {
    await expect(runCommand(['true'])).resolves.toBeUndefined();
  });

  it('rejects on a non-zero exit', async () => {
    spawnOutcome({ status: 3 });
    await expect(runCommand(['false'])).rejects.toThrow('exit code 3');
  });

  it('rejects when killed by a signal', async () => {
    spawnOutcome({ signal: 'SIGKILL', status: null });
    await expect(runCommand(['sleep'])).rejects.toThrow('killed by signal SIGKILL');
  });

  it('rejects when the child cannot start', async () => {
    spawnOutcome({ error: new Error('spawn ENOENT') });
    await expect(runCommand(['nope'])).rejects.toThrow('spawn ENOENT');
  });

  it('suspends the UI while the child runs and resumes afterwards', async () => {
    let duringRun = false;
    mockSpawn.mockImplementation(() => {
      // Sampled synchronously inside spawn, i.e. while the child owns the TTY.
      duringRun = isUiSuspended();
      return childFor({ status: 0 });
    });

    await runCommand(['sudo', 'apt-get', 'install', 'zsh']);

    expect(duringRun).toBe(true);
    expect(isUiSuspended()).toBe(false);
  });

  it('resumes the UI even when the command fails', async () => {
    spawnOutcome({ status: 1 });
    await expect(runCommand(['false'])).rejects.toThrow();
    expect(isUiSuspended()).toBe(false);
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(runCommand(['sleep'], { signal: controller.signal })).rejects.toBeInstanceOf(
      CommandCancelledError
    );
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('kills the child when the signal aborts mid-run', async () => {
    spawnOutcome({ hang: true });
    const controller = new AbortController();
    const promise = runCommand(['sleep', '100'], { signal: controller.signal });

    controller.abort();

    await expect(promise).rejects.toBeInstanceOf(CommandCancelledError);
    expect(isUiSuspended()).toBe(false);
  });

  it('killActiveCommand terminates the running child', async () => {
    spawnOutcome({ hang: true });
    const promise = runCommand(['sleep', '100']);
    // Let spawn register before killing.
    await new Promise((r) => setImmediate(r));

    killActiveCommand();

    await expect(promise).rejects.toThrow('killed by signal SIGTERM');
  });
});
