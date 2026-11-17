import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
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

vi.mock('../../../app.tsx', () => ({
  App: () => null,
}));

const { mockRecordRun } = vi.hoisted(() => ({
  mockRecordRun: vi.fn(),
}));

vi.mock('../../../services/detector.ts', async () => {
  const actual = await vi.importActual<typeof import('../../../services/detector.ts')>(
    '../../../services/detector.ts'
  );
  return {
    ...actual,
    detectInstalledShellsAsync: vi.fn().mockResolvedValue(['zsh']),
    detectPackageManagerAsync: vi.fn().mockResolvedValue('apt'),
    detectTerminalAsync: vi.fn().mockResolvedValue(null),
    detectContainerAsync: vi.fn().mockResolvedValue(false),
  };
});

vi.mock('../../../services/history.ts', async () => {
  const actual = await vi.importActual<typeof import('../../../services/history.ts')>(
    '../../../services/history.ts'
  );
  return {
    ...actual,
    recordRun: mockRecordRun,
    recordRunSafely: (options: Parameters<typeof actual.recordRun>[0]) =>
      actual.recordRunSafely(options, mockRecordRun),
  };
});

const { mockRunDoctor, mockFormatDoctorReport, mockRunRepair, mockFormatRepairReport } = vi.hoisted(
  () => ({
    mockRunDoctor: vi.fn(),
    mockFormatDoctorReport: vi.fn(),
    mockRunRepair: vi.fn(),
    mockFormatRepairReport: vi.fn(),
  })
);

const { mockRunInstallTasks } = vi.hoisted(() => ({
  mockRunInstallTasks: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../../services/installTasks.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/installTasks.ts')>()),
  runInstallTasks: mockRunInstallTasks,
}));

vi.mock('../../../services/doctor.ts', () => ({
  runDoctor: mockRunDoctor,
  formatDoctorReport: mockFormatDoctorReport,
}));

vi.mock('../../../services/repair.ts', () => ({
  DEFAULT_REPAIR_DEPS: {},
  runRepair: mockRunRepair,
  formatRepairReport: mockFormatRepairReport,
}));

import { runUninstallCommand, type UninstallIo } from '../../../cli/commands/uninstall.ts';
import { runGlobalFlags, runHeadlessCommand } from '../../../cli/route.ts';
import { parseCliArgs } from '../../../services/args.ts';
import { CliUsageError } from '../../../services/errors.ts';
import { captureRun } from '../../../services/runCapture.ts';
import type { UninstallDeps } from '../../../services/uninstall.ts';
import type { ShellId } from '../../../types.ts';

let scratchHome: string;

beforeEach(() => {
  scratchHome = fs.mkdtempSync(path.join(os.tmpdir(), 'shellconf-index-home-'));
  vi.stubEnv('HOME', scratchHome);
  vi.stubEnv('XDG_STATE_HOME', undefined);
  vi.stubEnv('XDG_CONFIG_HOME', undefined);
  vi.stubEnv('ZDOTDIR', undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(scratchHome, { recursive: true, force: true });
});

describe('index uninstall command', () => {
  let stdoutWrite: ReturnType<typeof vi.spyOn>;
  const savedExitCode = process.exitCode;

  beforeEach(() => {
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true as never);
    mockRecordRun.mockClear();
  });

  afterEach(() => {
    stdoutWrite.mockRestore();
    process.exitCode = savedExitCode;
  });

  function fakeIo(
    overrides: Partial<UninstallIo> = {},
    deps: Partial<UninstallDeps> = {}
  ): UninstallIo & { deps: UninstallDeps } {
    return {
      confirm: vi.fn().mockResolvedValue(true),
      isTerminal: () => true,
      deps: {
        hasManagedRcBlock: (id: ShellId) => id === 'zsh',
        hasShellConfig: (id: ShellId) => id === 'zsh',
        bashLoginBlockFiles: () => [],
        removeBashLoginBlock: () => ({ removed: true }),
        startsStarship: () => false,
        removeManagedRcBlocks: vi.fn(() => ({ removed: true })),
        removeShellConfigFile: vi.fn(() => ({ removed: true })),
        detectPackageManager: vi.fn().mockResolvedValue('brew'),
        plannedStarshipRemoval: vi.fn(async () => ({ kind: 'absent' as const })),
        removeStarship: vi.fn(),
        forgetStarshipVersion: vi.fn(),
        installedFontFiles: vi.fn().mockResolvedValue([]),
        removeFontFiles: vi.fn(),
        terminalFontFamily: () => null,
        ...deps,
      },
      ...overrides,
    };
  }

  const output = () => stdoutWrite.mock.calls.map((c: unknown[]) => String(c[0])).join('');

  it('shows the plan and removes nothing when the user says no', async () => {
    const io = fakeIo({ confirm: vi.fn().mockResolvedValue(false) });

    await runUninstallCommand(parseCliArgs(['uninstall']), 'uninstall', io);

    expect(io.confirm).toHaveBeenCalled();
    expect(output()).toContain('PLANNED Zsh rc');
    expect(output()).toContain('Nothing was changed.');
    expect(io.deps.removeManagedRcBlocks).not.toHaveBeenCalled();
    expect(mockRecordRun).not.toHaveBeenCalled();
  });

  it('removes everything once confirmed, records the run and points at rollback', async () => {
    vi.mocked(captureRun).mockImplementationOnce(async (_files, run) => ({
      result: await run(false),
      runId: 'run-9',
      uncaptured: false,
    }));
    const io = fakeIo();

    await runUninstallCommand(parseCliArgs(['uninstall']), 'uninstall', io);

    expect(io.deps.removeManagedRcBlocks).toHaveBeenCalledWith('zsh');
    expect(io.deps.removeShellConfigFile).toHaveBeenCalledWith('zsh');
    expect(output()).toContain('REMOVED Zsh config');
    expect(output()).toContain('Undo it with: shell-configurator rollback');
    expect(output()).not.toContain('could not be recorded');
    expect(mockRecordRun).toHaveBeenCalledWith({
      kind: 'uninstall',
      command: 'uninstall',
      exitCode: 0,
      runId: 'run-9',
    });
  });

  it('says rollback cannot bring back a removed Starship or font', async () => {
    vi.mocked(captureRun).mockImplementationOnce(async (_files, run) => ({
      result: await run(false),
      runId: 'run-9',
      uncaptured: false,
    }));
    const io = fakeIo(
      {},
      {
        plannedStarshipRemoval: vi.fn(async () => ({
          kind: 'script' as const,
          path: '/h/.local/bin/starship',
        })),
        installedFontFiles: vi.fn().mockResolvedValue(['/f/A.ttf']),
      }
    );

    await runUninstallCommand(
      parseCliArgs(['uninstall', '--starship', '--font', 'Hack', '--yes']),
      'uninstall',
      io
    );

    expect(output()).toContain(
      'Rollback only puts files back: reinstall Hack and Starship with shell-configurator apply or doctor --fix.'
    );
  });

  it('warns when the run could not be recorded after it ran, too', async () => {
    vi.mocked(captureRun).mockImplementationOnce(async (_files, run) => ({
      result: await run(false),
      runId: null,
      uncaptured: true,
    }));
    const io = fakeIo();

    await runUninstallCommand(parseCliArgs(['uninstall', '--yes']), 'uninstall --yes', io);

    expect(io.deps.removeShellConfigFile).toHaveBeenCalledWith('zsh');
    expect(output()).toContain('This run could not be recorded, so rollback cannot undo it.');
  });

  it('does not claim the recording failed when the run changed no file it tracks', async () => {
    vi.mocked(captureRun).mockImplementationOnce(async (_files, run) => ({
      result: await run(false),
      runId: null,
      uncaptured: false,
    }));
    const io = fakeIo(
      {},
      {
        hasManagedRcBlock: vi.fn(() => false),
        hasShellConfig: vi.fn(() => false),
        plannedStarshipRemoval: vi.fn(async () => ({
          kind: 'script' as const,
          path: '/h/.local/bin/starship',
        })),
      }
    );

    await runUninstallCommand(
      parseCliArgs(['uninstall', '--starship', '--yes']),
      'uninstall --starship --yes',
      io
    );

    expect(io.deps.removeStarship).toHaveBeenCalled();
    expect(output()).not.toContain('could not be recorded');
  });

  it('keeps the per-shell configs when the run could not be captured', async () => {
    vi.mocked(captureRun).mockImplementationOnce(async (_files, run) => ({
      result: await run(true),
      runId: null,
      uncaptured: true,
    }));
    const io = fakeIo();

    await runUninstallCommand(parseCliArgs(['uninstall', '--yes']), 'uninstall --yes', io);

    expect(io.deps.removeManagedRcBlocks).toHaveBeenCalledWith('zsh');
    expect(io.deps.removeShellConfigFile).not.toHaveBeenCalled();
    expect(output()).toContain('left in place: rollback could not record this run');
  });

  it('says rollback cannot undo a run that could not be captured, and where the originals are', async () => {
    vi.mocked(captureRun).mockImplementationOnce(async (_files, run) => ({
      result: await run(true),
      runId: null,
      uncaptured: true,
    }));
    const io = fakeIo();

    await runUninstallCommand(parseCliArgs(['uninstall']), 'uninstall', io);

    expect(output()).toContain('This run could not be recorded, so rollback cannot undo it.');
    expect(output()).toContain(
      'has its content from then beside it as <file>.pre-shell-configurator'
    );
    expect(output()).toContain('that copy predates any later edit');
    expect(output()).not.toContain('Undo it with');
  });

  it('goes ahead without asking under --yes', async () => {
    const io = fakeIo({ isTerminal: () => false });
    await runUninstallCommand(parseCliArgs(['uninstall', '-y']), 'uninstall -y', io);
    expect(io.confirm).not.toHaveBeenCalled();
    expect(io.deps.removeManagedRcBlocks).toHaveBeenCalled();
  });

  it('refuses to change files off a terminal without --yes', async () => {
    const io = fakeIo({ isTerminal: () => false });
    await expect(runUninstallCommand(parseCliArgs(['uninstall']), 'uninstall', io)).rejects.toThrow(
      CliUsageError
    );
    expect(io.deps.removeManagedRcBlocks).not.toHaveBeenCalled();
  });

  it('refuses --json without --yes rather than mixing a prompt into the JSON', async () => {
    await expect(
      runUninstallCommand(parseCliArgs(['uninstall', '--json']), 'uninstall --json', fakeIo())
    ).rejects.toThrow(/pass --yes/);
  });

  it('only prints the plan in a dry run, without asking', async () => {
    const io = fakeIo();
    await runUninstallCommand(parseCliArgs(['uninstall', '--dry-run']), 'uninstall --dry-run', io);
    expect(io.confirm).not.toHaveBeenCalled();
    expect(io.deps.removeManagedRcBlocks).not.toHaveBeenCalled();
    expect(output()).toContain('dry run');
    expect(mockRecordRun).not.toHaveBeenCalled();
  });

  it('does not ask when there is nothing to remove', async () => {
    const io = fakeIo({}, { hasManagedRcBlock: () => false, hasShellConfig: () => false });
    await runUninstallCommand(parseCliArgs(['uninstall']), 'uninstall', io);
    expect(io.confirm).not.toHaveBeenCalled();
    expect(output()).toContain('Nothing to uninstall.');
  });

  it('prints the report as JSON and exits non-zero when a step fails', async () => {
    const io = fakeIo(
      {},
      {
        removeManagedRcBlocks: vi.fn(() => {
          throw new Error('read-only');
        }),
      }
    );

    await runUninstallCommand(parseCliArgs(['uninstall', '--json', '--yes']), 'uninstall', io);

    expect(JSON.parse(output()).actions[0]).toMatchObject({
      status: 'failed',
      detail: 'read-only',
    });
    expect(process.exitCode).toBe(1);
    expect(mockRecordRun).toHaveBeenCalledWith(expect.objectContaining({ exitCode: 1 }));
  });

  it('passes --shells, --font and --starship through to the plan', async () => {
    const io = fakeIo();
    await runUninstallCommand(
      parseCliArgs([
        'uninstall',
        '--dry-run',
        '--shells',
        'zsh,zsh',
        '--font',
        'Hack',
        '--starship',
      ]),
      'uninstall',
      io
    );
    expect(io.deps.installedFontFiles).toHaveBeenCalledWith('Hack');
    expect(io.deps.plannedStarshipRemoval).toHaveBeenCalledWith('brew');
    expect(output().match(/Zsh rc/g)).toHaveLength(1);
  });

  it.each([
    [['--preset', 'pure-prompt'], /--preset cannot be used with uninstall/],
    [['--state', 'card.json'], /--state cannot be used with uninstall/],
    [['--fix'], /--fix cannot be used with uninstall/],
    [['--include-warnings'], /--include-warnings only applies to doctor --fix/],
  ])('refuses %o before running', async (args, message) => {
    await expect(
      runHeadlessCommand(parseCliArgs(['uninstall', ...args]), 'uninstall')
    ).rejects.toThrow(message);
  });

  it.each([
    [['--font', 'none'], /not none/],
    [['--font', 'Comic'], /Unknown Nerd Font/],
    [['--shells', 'tcsh'], /Unknown shell id/],
  ])('rejects %o', async (args, message) => {
    await expect(
      runUninstallCommand(parseCliArgs(['uninstall', ...args]), 'uninstall', fakeIo())
    ).rejects.toThrow(message);
  });

  it.each([
    [['apply', '--shells', 'zsh', '--export', 'card.json', '-o', 'out.toml'], '--output, --export'],
    [['generate', '--json'], '--json'],
    [['apply', '--shells', 'zsh', '--fix'], '--fix'],
    [['doctor', '--dry-run'], '--dry-run without --fix'],
    [['completions', 'bash', '--json'], '--json'],
  ])('refuses %j instead of ignoring %s', async (argv, flags) => {
    const subcommand = argv[0];
    await expect(runHeadlessCommand(parseCliArgs(argv), '')).rejects.toThrow(
      new CliUsageError(`${flags} cannot be used with ${subcommand}.`)
    );
  });

  it('rejects --yes and --starship outside uninstall', async () => {
    await expect(runHeadlessCommand(parseCliArgs(['doctor', '--yes']), '')).rejects.toThrow(
      '--yes only applies to doctor --fix, uninstall and rollback.'
    );
    await expect(runHeadlessCommand(parseCliArgs(['doctor', '--starship']), '')).rejects.toThrow(
      '--starship only applies to uninstall.'
    );
  });

  it('documents uninstall in the help text', () => {
    runGlobalFlags(parseCliArgs(['--help']));
    expect(output()).toContain('shell-configurator uninstall');
    expect(output()).toContain('-y, --yes');
  });
});
