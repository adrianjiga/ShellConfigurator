import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('ink', async () => {
  const actual = await vi.importActual<typeof import('ink')>('ink');
  return {
    ...actual,
    render: vi.fn().mockReturnValue({
      waitUntilExit: () => Promise.resolve(),
    }),
  };
});

vi.mock('../app.tsx', () => ({
  App: () => null,
}));

const { mockRestoreConfigBackups } = vi.hoisted(() => ({
  mockRestoreConfigBackups: vi.fn(),
}));

const { mockAppendHistory, mockWriteSnapshot } = vi.hoisted(() => ({
  mockAppendHistory: vi.fn(),
  mockWriteSnapshot: vi.fn<(state: WizardState, timestamp: string) => string>(() => 'snap-abc123'),
}));

vi.mock('../services/detector.ts', async () => {
  const actual =
    await vi.importActual<typeof import('../services/detector.ts')>('../services/detector.ts');
  return {
    ...actual,
    detectInstalledShellsAsync: vi.fn().mockResolvedValue(['zsh']),
    detectPackageManagerAsync: vi.fn().mockResolvedValue('apt'),
  };
});

vi.mock('../generators/shellRc.ts', async () => {
  const actual = await vi.importActual<typeof import('../generators/shellRc.ts')>(
    '../generators/shellRc.ts'
  );
  return {
    ...actual,
    restoreConfigBackups: mockRestoreConfigBackups,
  };
});

vi.mock('../services/history.ts', async () => {
  const actual =
    await vi.importActual<typeof import('../services/history.ts')>('../services/history.ts');
  return {
    ...actual,
    appendHistory: mockAppendHistory,
    writeSnapshot: mockWriteSnapshot,
  };
});

import { render } from 'ink';
import {
  applyInstallOutcomeExitCode,
  handleCliArgs,
  hasDryRunFlag,
  recordInstallOutcome,
  reportFatal,
  restoreTerminal,
  runHeadlessCommand,
} from '../index.tsx';
import { CliUsageError } from '../services/errors.ts';
import { DEFAULT_STATE, type InstallTask, type WizardState } from '../types.ts';

describe('index CLI handling', () => {
  const originalArgv = process.argv.slice();
  const originalExitCode = process.exitCode;

  let stdoutWrite: ReturnType<typeof vi.spyOn>;
  let stderrWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true as never);
    stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as never);
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    stdoutWrite.mockRestore();
    stderrWrite.mockRestore();
    vi.mocked(render).mockClear();
  });

  it.each(['--version', '-v'])('prints version for %s', (flag) => {
    process.argv = ['node', 'index.tsx', flag];
    const result = handleCliArgs();
    expect(result).toBe(true);
    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringMatching(/^\d+\.\d+\.\d+\n$/));
  });

  it.each(['--help', '-h'])('prints help and exits for %s', (flag) => {
    process.argv = ['node', 'index.tsx', flag];
    const result = handleCliArgs();
    expect(result).toBe(true);
    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
  });

  it('documents the --no-install alias in help', () => {
    process.argv = ['node', 'index.tsx', '--help'];
    handleCliArgs();
    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('--no-install'));
  });

  it('does not consume args when unknown flags are passed', () => {
    process.argv = ['node', 'index.tsx', '--bogus'];
    const result = handleCliArgs();
    expect(result).toBe(false);
    expect(stdoutWrite).not.toHaveBeenCalled();
  });

  it('treats non-flag args as not a flag request', () => {
    process.argv = ['node', 'index.tsx', 'somefile'];
    const result = handleCliArgs();
    expect(result).toBe(false);
  });
});

describe('index restore flag', () => {
  const originalArgv = process.argv.slice();
  const originalExitCode = process.exitCode;

  let stdoutWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true as never);
    mockRestoreConfigBackups.mockReset();
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    stdoutWrite.mockRestore();
  });

  it('prints the restored configs for --restore', () => {
    const backup = '/home/u/.config/starship.toml.bak-2026-09-09T09-30-00-000Z';
    const backup2 = '/home/u/.config/starship/zsh.toml.bak-2026-09-08T10-00-00-000Z';
    mockRestoreConfigBackups.mockReturnValue([
      { what: 'shared', restoredTo: '/home/u/.config/starship.toml', restoredFrom: backup },
      { what: 'zsh', restoredTo: '/home/u/.config/starship/zsh.toml', restoredFrom: backup2 },
    ]);
    process.argv = ['node', 'index.tsx', '--restore'];

    const result = handleCliArgs();

    expect(result).toBe(true);
    expect(stdoutWrite).toHaveBeenCalledWith(
      expect.stringContaining('shared: /home/u/.config/starship.toml')
    );
    expect(stdoutWrite).toHaveBeenCalledWith(
      expect.stringContaining('zsh: /home/u/.config/starship/zsh.toml')
    );
  });

  it('accepts --undo as an alias for --restore', () => {
    mockRestoreConfigBackups.mockReturnValue([]);
    process.argv = ['node', 'index.tsx', '--undo'];

    expect(handleCliArgs()).toBe(true);
    expect(mockRestoreConfigBackups).toHaveBeenCalled();
  });

  it('reports when there is nothing to restore', () => {
    mockRestoreConfigBackups.mockReturnValue([]);
    process.argv = ['node', 'index.tsx', '--restore'];

    handleCliArgs();

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Nothing to restore'));
  });
});

describe('hasDryRunFlag', () => {
  const originalArgv = process.argv.slice();

  afterEach(() => {
    process.argv = originalArgv;
  });

  it('returns true when --dry-run is present', () => {
    process.argv = ['node', 'index.tsx', '--dry-run'];
    expect(hasDryRunFlag()).toBe(true);
  });

  it('returns true when --no-install is present', () => {
    process.argv = ['node', 'index.tsx', '--no-install'];
    expect(hasDryRunFlag()).toBe(true);
  });

  it('returns true when -d is present', () => {
    process.argv = ['node', 'index.tsx', '-d'];
    expect(hasDryRunFlag()).toBe(true);
  });

  it('returns false when neither flag is present', () => {
    process.argv = ['node', 'index.tsx'];
    expect(hasDryRunFlag()).toBe(false);
  });

  it('returns false when --version is passed', () => {
    process.argv = ['node', 'index.tsx', '--version'];
    expect(hasDryRunFlag()).toBe(false);
  });
});

describe('index restoreTerminal', () => {
  let setRawMode: ReturnType<typeof vi.fn>;
  let stdoutWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setRawMode = vi.fn();
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stdin, 'setRawMode', {
      value: setRawMode,
      configurable: true,
    });
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('disables raw mode on a TTY stdin', () => {
    restoreTerminal();
    expect(setRawMode).toHaveBeenCalledWith(false);
  });

  it('shows the cursor again', () => {
    restoreTerminal();
    expect(stdoutWrite).toHaveBeenCalledWith('\u001B[?25h');
  });

  it('does not throw when stdin has no setRawMode', () => {
    Object.defineProperty(process.stdin, 'setRawMode', { value: undefined, configurable: true });
    expect(() => restoreTerminal()).not.toThrow();
  });

  it('swallows write errors', () => {
    process.stdout.write = (() => {
      throw new Error('EPIPE');
    }) as typeof process.stdout.write;
    expect(() => restoreTerminal()).not.toThrow();
  });
});

describe('index install-outcome exit code', () => {
  afterEach(() => {
    process.exitCode = 0;
  });

  it('leaves the exit code alone when every task succeeded', () => {
    recordInstallOutcome([{ id: 'config', label: 'Copy config', status: 'done' } as InstallTask]);
    applyInstallOutcomeExitCode();
    expect(process.exitCode ?? 0).toBe(0);
  });

  it('applies exit code 1 when a task failed', () => {
    recordInstallOutcome([{ id: 'config', label: 'Copy config', status: 'failed' } as InstallTask]);
    applyInstallOutcomeExitCode();
    expect(process.exitCode).toBe(1);
  });

  it('treats missing results as success', () => {
    recordInstallOutcome(undefined);
    applyInstallOutcomeExitCode();
    expect(process.exitCode ?? 0).toBe(0);
  });
});

describe('index wizard history recording', () => {
  const done = [{ id: 'config', label: 'Copy config', status: 'done' } as InstallTask];

  afterEach(() => {
    mockAppendHistory.mockReset();
    mockWriteSnapshot.mockReset();
    // Reset installFailed so later exit-code assertions are not poisoned.
    recordInstallOutcome(undefined);
  });

  it('records a run snapshot when results come back with the state', () => {
    recordInstallOutcome(done, {
      ...DEFAULT_STATE,
      preset: 'pure-prompt',
      selectedShells: ['zsh'],
    });

    expect(mockWriteSnapshot).toHaveBeenCalledTimes(1);
    expect(mockWriteSnapshot.mock.calls.at(-1)?.[0]).toMatchObject({
      preset: 'pure-prompt',
      selectedShells: ['zsh'],
    });
    expect(mockAppendHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 1,
        kind: 'install',
        snapshotId: 'snap-abc123',
        exitCode: 0,
        results: done,
      })
    );
  });

  it('records exit 1 when the run had a failed task', () => {
    recordInstallOutcome(
      [{ id: 'config', label: 'Copy config', status: 'failed' } as InstallTask],
      {
        ...DEFAULT_STATE,
        preset: 'pure-prompt',
        selectedShells: [],
      }
    );

    expect(mockAppendHistory).toHaveBeenCalledWith(expect.objectContaining({ exitCode: 1 }));
  });

  it('does not record history without a final state', () => {
    recordInstallOutcome(done);

    expect(mockWriteSnapshot).not.toHaveBeenCalled();
    expect(mockAppendHistory).not.toHaveBeenCalled();
  });

  it('warns instead of dying when the history write fails', () => {
    mockWriteSnapshot.mockImplementation(() => {
      throw new Error('disk full');
    });
    const warn = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as never);

    expect(() =>
      recordInstallOutcome(done, { ...DEFAULT_STATE, preset: 'pure-prompt', selectedShells: [] })
    ).not.toThrow();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not record this run'));
    warn.mockRestore();
  });
});

describe('index headless routing', () => {
  let stdoutWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true as never);
    mockAppendHistory.mockReset();
  });

  afterEach(() => {
    stdoutWrite.mockRestore();
    vi.clearAllMocks();
  });

  it('dispatches generate and prints the TOML', async () => {
    const routed = await runHeadlessCommand(['generate', '--preset', 'pure-prompt']);

    expect(routed).toBe(true);
    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('format'));
  });

  it('returns false for a plain global flag, leaving it for the wizard', async () => {
    expect(await runHeadlessCommand(['--help'])).toBe(false);
    expect(await runHeadlessCommand(['--bogus'])).toBe(false);
  });

  it('surfaces a bogus flag as a CliUsageError', async () => {
    await expect(runHeadlessCommand(['apply', '--preset', 'nope'])).rejects.toThrow(CliUsageError);
    await expect(runHeadlessCommand(['generate', '--palette', 'nope'])).rejects.toThrow(/palette/);
  });

  it('surfaces a missing state card as a CliUsageError', async () => {
    await expect(runHeadlessCommand(['generate', '--state', '/no/such/card.json'])).rejects.toThrow(
      /Could not read state card/
    );
  });

  it('refuses a bare apply before it ever installs', async () => {
    await expect(runHeadlessCommand(['apply'])).rejects.toThrow(/at least one shell/);
    expect(mockAppendHistory).not.toHaveBeenCalled();
  });

  it('runs an apply dry-run through the router and prints the plan', async () => {
    const routed = await runHeadlessCommand(['apply', '--dry-run', '--shells', 'zsh']);

    expect(routed).toBe(true);
    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('dry run'));
    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Targets: zsh'));
    expect(mockAppendHistory).not.toHaveBeenCalled();
  });

  it('accepts equals-syntax through the router', async () => {
    const routed = await runHeadlessCommand(['generate', '--preset=pure-prompt']);

    expect(routed).toBe(true);
    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('format'));
  });
});

describe('index reportFatal', () => {
  let stderrWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as never);
    process.exitCode = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = 0;
  });

  it('writes an Error stack and sets exit code 1', () => {
    const err = new Error('boom');
    reportFatal('ShellConfigurator crashed', err);
    expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('ShellConfigurator crashed'));
    expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('Error: boom'));
    expect(process.exitCode).toBe(1);
  });

  it('stringifies non-Error values', () => {
    reportFatal('prefix', 'some string');
    expect(stderrWrite).toHaveBeenCalledWith('\nprefix: some string\n');
    expect(process.exitCode).toBe(1);
  });

  it('reports CLI misuse cleanly and exits 2', () => {
    reportFatal('prefix', new CliUsageError('Unknown preset: nope'));
    expect(stderrWrite).toHaveBeenCalledWith('\nshell-configurator: Unknown preset: nope\n');
    expect(stderrWrite).not.toHaveBeenCalledWith(
      expect.stringContaining('prefix:') as unknown as string
    );
    expect(process.exitCode).toBe(2);
  });
});
