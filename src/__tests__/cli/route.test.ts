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

const { mockRecordRun } = vi.hoisted(() => ({
  mockRecordRun: vi.fn(),
}));

vi.mock('../../services/detector.ts', async () => {
  const actual = await vi.importActual<typeof import('../../services/detector.ts')>(
    '../../services/detector.ts'
  );
  return {
    ...actual,
    detectInstalledShellsAsync: vi.fn().mockResolvedValue(['zsh']),
    detectPackageManagerAsync: vi.fn().mockResolvedValue('apt'),
    detectTerminalAsync: vi.fn().mockResolvedValue(null),
    detectContainerAsync: vi.fn().mockResolvedValue(false),
  };
});

vi.mock('../../services/history.ts', async () => {
  const actual = await vi.importActual<typeof import('../../services/history.ts')>(
    '../../services/history.ts'
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
vi.mock('../../services/installTasks.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/installTasks.ts')>()),
  runInstallTasks: mockRunInstallTasks,
}));

vi.mock('../../services/doctor.ts', () => ({
  runDoctor: mockRunDoctor,
  formatDoctorReport: mockFormatDoctorReport,
}));

vi.mock('../../services/repair.ts', () => ({
  DEFAULT_REPAIR_DEPS: {},
  runRepair: mockRunRepair,
  formatRepairReport: mockFormatRepairReport,
}));

import { render } from 'ink';
import { runRepairCommand } from '../../cli/commands/doctor.ts';
import type { PromptIo } from '../../cli/prompt.ts';
import { routeCli, runGlobalFlags, runHeadlessCommand } from '../../cli/route.ts';
import { parseCliArgs } from '../../services/args.ts';
import { CliUsageError } from '../../services/errors.ts';
import { CapturedRunError, captureRun } from '../../services/runCapture.ts';
import { serializeState } from '../../services/state.ts';
import { DEFAULT_STATE } from '../../types.ts';

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

describe('index CLI handling', () => {
  let stdoutWrite: ReturnType<typeof vi.spyOn>;
  let stderrWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true as never);
    stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as never);
  });

  afterEach(() => {
    stdoutWrite.mockRestore();
    stderrWrite.mockRestore();
    vi.mocked(render).mockClear();
  });

  it.each(['--version', '-v'])('prints version for %s', (flag) => {
    expect(runGlobalFlags(parseCliArgs([flag]))).toBe(true);
    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringMatching(/^\d+\.\d+\.\d+\n$/));
  });

  it.each(['--help', '-h'])('prints help and exits for %s', (flag) => {
    expect(runGlobalFlags(parseCliArgs([flag]))).toBe(true);
    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
  });

  it('documents the --no-install alias in help', () => {
    runGlobalFlags(parseCliArgs(['--help']));
    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('--no-install'));
  });

  it('documents that flags can precede or follow the subcommand', () => {
    runGlobalFlags(parseCliArgs(['--help']));
    expect(stdoutWrite).toHaveBeenCalledWith(
      expect.stringContaining('before or after the subcommand')
    );
  });

  it('lists every accepted flag in the help text', () => {
    runGlobalFlags(parseCliArgs(['--help']));
    const help = String(stdoutWrite.mock.calls[0]?.[0]);
    expect(help).not.toContain('--restore');
    expect(help).toContain('-o, --output <file>');
    expect(help).toContain('--import, --state <file>');
    expect(help).toContain('--shells is');
  });

  it('rejects unknown flags before the global flags run', () => {
    expect(() => parseCliArgs(['--bogus'])).toThrow("Unknown flag '--bogus'");
    expect(stdoutWrite).not.toHaveBeenCalled();
  });
});

describe('index retired flags', () => {
  it('points --undo at rollback', () => {
    expect(() => parseCliArgs(['--undo'])).toThrow(
      new CliUsageError(
        '--undo is gone: shell-configurator rollback undoes the last run, rc lines included.'
      )
    );
  });

  it('points --restore at rollback', () => {
    expect(() => parseCliArgs(['--restore'])).toThrow(
      new CliUsageError(
        '--restore is gone: shell-configurator rollback undoes the last run, rc lines included. .bak-* copies from older versions stay where they are; copy one back by hand if you need it.'
      )
    );
  });
});

describe('index routeCli', () => {
  let stdoutWrite: ReturnType<typeof vi.spyOn>;
  let stderrWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true as never);
    stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as never);
  });

  afterEach(() => {
    stdoutWrite.mockRestore();
    stderrWrite.mockRestore();
  });

  it('rejects a mistyped flag instead of letting a global flag win', async () => {
    await expect(routeCli(['--bogus', '--help'])).rejects.toThrow("Unknown flag '--bogus'");
    expect(stdoutWrite).not.toHaveBeenCalledWith(expect.stringContaining('Usage:'));
  });

  it('routes a headless subcommand to completion', async () => {
    const { handled } = await routeCli(['generate', '--preset', 'pure-prompt']);

    expect(handled).toBe(true);
    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('format'));
  });

  it('leaves a plain run to the interactive wizard', async () => {
    expect((await routeCli([])).handled).toBe(false);
    expect((await routeCli(['--dry-run'])).handled).toBe(false);
  });
});

describe('index headless routing', () => {
  let stdoutWrite: ReturnType<typeof vi.spyOn>;

  /** Routes argv the same way main() does: parse once, then dispatch. */
  function route(argv: string[]): ReturnType<typeof runHeadlessCommand> {
    return runHeadlessCommand(parseCliArgs(argv), argv.join(' '));
  }

  beforeEach(() => {
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true as never);
    mockRecordRun.mockReset();
  });

  afterEach(() => {
    stdoutWrite.mockRestore();
    vi.clearAllMocks();
  });

  it('dispatches generate and prints the TOML', async () => {
    const routed = await route(['generate', '--preset', 'pure-prompt']);

    expect(routed).toBe(true);
    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('format'));
  });

  it('returns false for a plain global flag, leaving it for the wizard', async () => {
    expect(await route(['--help'])).toBe(false);
  });

  it('rejects adopt flags that lack the apply subcommand instead of dropping them', async () => {
    await expect(route(['--adopt'])).rejects.toThrow(/require the apply subcommand/);
    await expect(route(['--import-url', 'https://example.com/starship.toml'])).rejects.toThrow(
      /require the apply subcommand/
    );
  });

  it('rejects headless flags that lack a subcommand instead of dropping them', async () => {
    await expect(route(['--preset', 'pure', '-o', 'x.toml'])).rejects.toThrow(
      /--preset, --output require a subcommand/
    );
    await expect(route(['--json'])).rejects.toThrow(/--json require a subcommand/);
    await expect(route(['--shells', 'zsh'])).rejects.toThrow(/--shells require a subcommand/);
    await expect(route(['--state', 'card.json'])).rejects.toThrow(/--state require a subcommand/);
  });

  it('surfaces a bogus flag as a CliUsageError', async () => {
    await expect(route(['apply', '--shells', 'zsh', '--preset', 'nope'])).rejects.toThrow(
      CliUsageError
    );
    await expect(route(['apply', '--shells', 'zsh', '--preset', 'nope'])).rejects.toThrow(
      /preset \(--preset\)/
    );
    await expect(route(['generate', '--palette', 'nope'])).rejects.toThrow(/palette/);
  });

  it('surfaces a missing state card as a CliUsageError', async () => {
    await expect(route(['generate', '--state', '/no/such/card.json'])).rejects.toThrow(
      /Could not read state card/
    );
  });

  it('refuses a bare apply before it ever installs', async () => {
    await expect(route(['apply'])).rejects.toThrow(/at least one shell/);
    expect(mockRunInstallTasks).not.toHaveBeenCalled();
    expect(mockRecordRun).not.toHaveBeenCalled();
  });

  it('runs an apply dry-run through the router and prints the plan', async () => {
    const routed = await route(['apply', '--dry-run', '--shells', 'zsh']);

    expect(routed).toBe(true);
    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('dry run'));
    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Targets: zsh'));
    expect(mockRecordRun).not.toHaveBeenCalled();
  });

  it('accepts equals-syntax through the router', async () => {
    const routed = await route(['generate', '--preset=pure-prompt']);

    expect(routed).toBe(true);
    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('format'));
  });

  it('runs doctor and prints the human report', async () => {
    process.exitCode = undefined;
    mockRunDoctor.mockResolvedValue({ ok: true, findings: [] });
    mockFormatDoctorReport.mockReturnValue('HEALTHY\n');

    const routed = await route(['doctor']);

    expect(routed).toBe(true);
    expect(mockRunDoctor).toHaveBeenCalledWith(null);
    expect(stdoutWrite).toHaveBeenCalledWith('HEALTHY\n');
    expect(process.exitCode).toBeUndefined();
  });

  it('warns when doctor gets config flags without --state', async () => {
    mockRunDoctor.mockResolvedValue({ ok: true, findings: [] });
    mockFormatDoctorReport.mockReturnValue('HEALTHY\n');
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as never);

    await route(['doctor', '--shells', 'zsh']);

    expect(stderrWrite).toHaveBeenCalledWith(
      expect.stringContaining('--shells is ignored by doctor without --state')
    );
    stderrWrite.mockRestore();
  });

  it('warns when doctor --fix gets config flags without --state', async () => {
    mockRunRepair.mockResolvedValue({ ok: true, actions: [] });
    mockFormatRepairReport.mockReturnValue('REPAIRED\n');
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as never);

    await route(['doctor', '--fix', '--font', 'none']);

    expect(stderrWrite).toHaveBeenCalledWith(
      expect.stringContaining('--font is ignored by doctor --fix without --state')
    );
    stderrWrite.mockRestore();
  });

  it('prints the doctor report as JSON with --json', async () => {
    const report = { ok: true, findings: [{ id: 'starship', title: 'Starship', status: 'pass' }] };
    mockRunDoctor.mockResolvedValue(report);

    await route(['doctor', '--json']);

    expect(stdoutWrite).toHaveBeenCalledWith(`${JSON.stringify(report, null, 2)}\n`);
    expect(mockFormatDoctorReport).not.toHaveBeenCalled();
  });

  it('checks and fixes against a --state card', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shellconf-index-'));
    try {
      const card = path.join(dir, 'card.json');
      fs.writeFileSync(card, serializeState({ ...DEFAULT_STATE, selectedShells: ['fish'] }));
      mockRunDoctor.mockResolvedValue({ ok: true, findings: [] });
      mockFormatDoctorReport.mockReturnValue('HEALTHY\n');
      mockRunRepair.mockResolvedValue({ ok: true, actions: [] });
      mockFormatRepairReport.mockReturnValue('REPAIRED\n');

      await route(['doctor', '--state', card]);
      await route(['doctor', '--fix', '--state', card]);

      expect(mockRunDoctor.mock.calls[0]![0]).toMatchObject({ selectedShells: ['fish'] });
      expect(mockRunRepair.mock.calls[0]![0]).toMatchObject({ selectedShells: ['fish'] });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prints the repair report as JSON with --json', async () => {
    const report = { ok: true, actions: [], dryRun: false };
    mockRunRepair.mockResolvedValue(report);

    await route(['doctor', '--fix', '--json']);

    expect(stdoutWrite).toHaveBeenCalledWith(`${JSON.stringify(report, null, 2)}\n`);
    expect(mockFormatRepairReport).not.toHaveBeenCalled();
  });

  it('sets a non-zero exit code when a doctor check fails', async () => {
    process.exitCode = 0;
    mockRunDoctor.mockResolvedValue({ ok: false, findings: [] });
    mockFormatDoctorReport.mockReturnValue('FAILED\n');

    await route(['doctor']);

    expect(process.exitCode).toBe(1);
  });

  it('runs doctor --fix and prints the repair report', async () => {
    mockRunRepair.mockResolvedValue({ ok: true, actions: [] });
    mockFormatRepairReport.mockReturnValue('REPAIRED\n');

    const routed = await route(['doctor', '--fix']);

    expect(routed).toBe(true);
    expect(mockRunRepair).toHaveBeenCalledOnce();
    expect(mockRunRepair).toHaveBeenCalledWith(
      null,
      {},
      { includeWarnings: undefined, dryRun: true }
    );
    expect(stdoutWrite).toHaveBeenCalledWith('REPAIRED\n');
    expect(mockRunDoctor).not.toHaveBeenCalled();
  });

  it('passes --dry-run through to repair so nothing is applied', async () => {
    mockRunRepair.mockResolvedValue({ ok: true, actions: [], dryRun: true });
    mockFormatRepairReport.mockReturnValue('PLANNED\n');

    const routed = await route(['doctor', '--fix', '--dry-run']);

    expect(routed).toBe(true);
    expect(mockRunRepair).toHaveBeenCalledOnce();
    expect(mockRunRepair).toHaveBeenCalledWith(
      null,
      {},
      { includeWarnings: undefined, dryRun: true }
    );
    expect(stdoutWrite).toHaveBeenCalledWith('PLANNED\n');
  });

  it('passes --include-warnings through to doctor --fix', async () => {
    mockRunRepair.mockResolvedValue({ ok: true, actions: [], dryRun: false });
    mockFormatRepairReport.mockReturnValue('');

    await route(['doctor', '--fix', '--include-warnings']);

    for (const call of mockRunRepair.mock.calls) {
      expect(call[2]).toMatchObject({ includeWarnings: true });
    }
    expect(mockRunRepair).toHaveBeenCalledOnce();
  });

  it('rejects --include-warnings without --fix', async () => {
    await expect(route(['doctor', '--include-warnings'])).rejects.toThrow(
      '--include-warnings only applies to doctor --fix'
    );
  });

  it('reports a repair with nothing to fix as a real run, not a dry run', async () => {
    mockRunRepair.mockResolvedValue({ ok: true, actions: [], dryRun: true });
    mockFormatRepairReport.mockImplementation((report) => `REPORT ${report.dryRun}\n`);

    await route(['doctor', '--fix']);

    expect(stdoutWrite).toHaveBeenCalledWith('REPORT false\n');
  });

  it('sets a non-zero exit code when a repair still fails a check', async () => {
    process.exitCode = 0;
    mockRunRepair.mockResolvedValue({ ok: false, actions: [] });
    mockFormatRepairReport.mockReturnValue('STILL BROKEN\n');

    await route(['doctor', '--fix']);

    expect(process.exitCode).toBe(1);
  });

  describe('when there is something to fix', () => {
    const output = () => stdoutWrite.mock.calls.map((c: unknown[]) => String(c[0])).join('');
    const planned = {
      ok: false,
      dryRun: true,
      before: { ok: false, findings: [] },
      actions: [{ findingId: 'shell:bash', title: 'Bash', status: 'planned', detail: 'add lines' }],
    };
    const done = { ok: true, dryRun: false, actions: [{ ...planned.actions[0], status: 'fixed' }] };

    function io(overrides: Partial<PromptIo> = {}): PromptIo {
      return { confirm: vi.fn().mockResolvedValue(true), isTerminal: () => true, ...overrides };
    }

    beforeEach(() => {
      mockRecordRun.mockReset();
      mockRunRepair.mockImplementation(async (_state, _deps, options) =>
        options.dryRun ? planned : done
      );
      mockFormatRepairReport.mockImplementation((report) => `REPORT ${report.dryRun}\n`);
    });

    it('shows the plan and changes nothing when the user says no', async () => {
      const ask = io({ confirm: vi.fn().mockResolvedValue(false) });

      await runRepairCommand(parseCliArgs(['doctor', '--fix']), 'doctor --fix', ask);

      expect(ask.confirm).toHaveBeenCalled();
      expect(output()).toContain('REPORT true');
      expect(output()).toContain('Nothing was changed.');
      expect(mockRunRepair).toHaveBeenCalledOnce();
      expect(mockRecordRun).not.toHaveBeenCalled();
    });

    it('refuses off a terminal without --yes', async () => {
      await expect(
        runRepairCommand(
          parseCliArgs(['doctor', '--fix']),
          'doctor --fix',
          io({ isTerminal: () => false })
        )
      ).rejects.toThrow('doctor --fix changes files and may install software; pass --yes');
      expect(mockRunRepair).toHaveBeenCalledOnce();
    });

    it('still records a repair that throws partway, so rollback can undo it', async () => {
      vi.mocked(captureRun).mockRejectedValueOnce(
        new CapturedRunError('run-3', new Error('starship install broke'))
      );

      await expect(
        runRepairCommand(parseCliArgs(['doctor', '--fix', '--yes']), 'doctor --fix --yes', io())
      ).rejects.toThrow('starship install broke');
      expect(mockRecordRun).toHaveBeenCalledWith({
        kind: 'repair',
        command: 'doctor --fix --yes',
        exitCode: 1,
        runId: 'run-3',
      });
    });

    it('applies the fixes inside a captured run, records it and points at rollback', async () => {
      vi.mocked(captureRun).mockImplementationOnce(async (_files, run) => ({
        result: await run(false),
        runId: 'run-7',
        uncaptured: false,
      }));
      const ask = io();

      await runRepairCommand(parseCliArgs(['doctor', '--fix', '--yes']), 'doctor --fix --yes', ask);

      expect(ask.confirm).not.toHaveBeenCalled();
      expect(captureRun).toHaveBeenCalled();
      expect(mockRunRepair).toHaveBeenLastCalledWith(
        null,
        {},
        {
          includeWarnings: undefined,
          before: planned.before,
        }
      );
      expect(output()).toContain('REPORT false');
      expect(output()).toContain('Undo it with: shell-configurator rollback');
      expect(mockRecordRun).toHaveBeenCalledWith({
        kind: 'repair',
        command: 'doctor --fix --yes',
        exitCode: 0,
        runId: 'run-7',
      });
    });
  });
});
