import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
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

const { mockRecordRun } = vi.hoisted(() => ({
  mockRecordRun: vi.fn(),
}));

vi.mock('../services/detector.ts', async () => {
  const actual =
    await vi.importActual<typeof import('../services/detector.ts')>('../services/detector.ts');
  return {
    ...actual,
    detectInstalledShellsAsync: vi.fn().mockResolvedValue(['zsh']),
    detectPackageManagerAsync: vi.fn().mockResolvedValue('apt'),
    detectTerminalAsync: vi.fn().mockResolvedValue(null),
    detectContainerAsync: vi.fn().mockResolvedValue(false),
  };
});

vi.mock('../services/history.ts', async () => {
  const actual =
    await vi.importActual<typeof import('../services/history.ts')>('../services/history.ts');
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
vi.mock('../services/installTasks.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/installTasks.ts')>()),
  runInstallTasks: mockRunInstallTasks,
}));

vi.mock('../services/doctor.ts', () => ({
  runDoctor: mockRunDoctor,
  formatDoctorReport: mockFormatDoctorReport,
}));

vi.mock('../services/repair.ts', () => ({
  DEFAULT_REPAIR_DEPS: {},
  runRepair: mockRunRepair,
  formatRepairReport: mockFormatRepairReport,
}));

import {
  applyInstallOutcomeExitCode,
  assertWizardTerminal,
  crash,
  isEntryPoint,
  recordInstallOutcome,
  reportFatal,
} from '../index.tsx';
import { CliRunError, CliUsageError } from '../services/errors.ts';
import { DEFAULT_STATE, type InstallTask } from '../types.ts';

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
    mockRecordRun.mockReset();
    // Reset installFailed so later exit-code assertions are not poisoned.
    recordInstallOutcome(undefined);
  });

  it('records a run snapshot when results come back with the state', () => {
    recordInstallOutcome(done, {
      ...DEFAULT_STATE,
      preset: 'pure-prompt',
      selectedShells: ['zsh'],
      runId: 'run-5',
    });

    expect(mockRecordRun).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'install',
        runId: 'run-5',
        state: expect.objectContaining({ preset: 'pure-prompt', selectedShells: ['zsh'] }),
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

    expect(mockRecordRun).toHaveBeenCalledWith(expect.objectContaining({ exitCode: 1 }));
  });

  it('does not record history without a final state', () => {
    recordInstallOutcome(done);

    expect(mockRecordRun).not.toHaveBeenCalled();
  });

  it('warns instead of dying when the history write fails', () => {
    mockRecordRun.mockImplementation(() => {
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

describe('index crash handler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = 0;
  });

  it('exits with 1 after reporting an uncaught error', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as never);

    crash('ShellConfigurator crashed', new Error('boom'));

    expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('Error: boom'));
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('exits with 2 after reporting a CLI usage error', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true as never);

    crash('ShellConfigurator crashed', new CliUsageError('Unknown preset: nope'));

    expect(exit).toHaveBeenCalledWith(2);
  });
});

describe('assertWizardTerminal', () => {
  it.each([
    [{ isTTY: false }, { isTTY: true }],
    [{ isTTY: true }, {}],
  ])('refuses to start the wizard without a terminal (%o, %o)', (stdin, stdout) => {
    expect(() => assertWizardTerminal(stdin, stdout)).toThrow(
      new CliUsageError(
        'The wizard needs a terminal: its input and output cannot be redirected. To set up without one, run shell-configurator apply --shells <id,...> (see --help).'
      )
    );
  });

  it('lets the wizard start on a terminal', () => {
    expect(() => assertWizardTerminal({ isTTY: true }, { isTTY: true })).not.toThrow();
  });
});

describe('isEntryPoint', () => {
  it('starts the program only when this file is the one being run, also through a symlink', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shellconf-entry-'));
    try {
      const self = fileURLToPath(new URL('../index.tsx', import.meta.url));
      const link = path.join(dir, 'shell-configurator');
      fs.symlinkSync(self, link);

      expect(isEntryPoint(self)).toBe(true);
      expect(isEntryPoint(link)).toBe(true);
      expect(isEntryPoint(path.join(dir, 'other.js'))).toBe(false);
      expect(isEntryPoint(undefined)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
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

  it('shows the home folder as ~ in a crash it reports', () => {
    reportFatal('prefix', `EISDIR: ${path.join(os.homedir(), '.cache', 'x')}`);
    expect(stderrWrite).toHaveBeenCalledWith(
      `\nprefix: EISDIR: ${path.join('~', '.cache', 'x')}\n`
    );
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

  it('reports a run failure cleanly and exits 1', () => {
    reportFatal('prefix', new CliRunError("Could not write TOML to 'x': EACCES"));
    expect(stderrWrite).toHaveBeenCalledWith(
      "\nshell-configurator: Could not write TOML to 'x': EACCES\n"
    );
    expect(stderrWrite).not.toHaveBeenCalledWith(
      expect.stringContaining('prefix:') as unknown as string
    );
    expect(process.exitCode).toBe(1);
  });
});
