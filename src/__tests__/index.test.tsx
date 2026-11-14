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

const { mockRestoreConfigBackups } = vi.hoisted(() => ({
  mockRestoreConfigBackups: vi.fn(),
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

import { render } from 'ink';
import { getShell } from '../config/shells.ts';
import { getShellConfigPath } from '../generators/shellRc.ts';
import {
  applyInstallOutcomeExitCode,
  assertWizardTerminal,
  crash,
  isEntryPoint,
  type PromptIo,
  recordInstallOutcome,
  reportFatal,
  routeCli,
  runCompletionsCommand,
  runDebugInfoCommand,
  runGlobalFlags,
  runHeadlessCommand,
  runRepairCommand,
  runRollbackCommand,
  runShareCommand,
  runTimingsCommand,
  runUninstallCommand,
  type UninstallIo,
} from '../index.tsx';
import { parseCliArgs } from '../services/args.ts';
import { completionScript } from '../services/completions.ts';
import type { DebugInfoDeps } from '../services/debugInfo.ts';
import { CliRunError, CliUsageError } from '../services/errors.ts';
import { appendHistory, writeSnapshot } from '../services/history.ts';
import { formatListing, listEntries } from '../services/listings.ts';
import { homeDir } from '../services/paths.ts';
import {
  beginRunCapture,
  CapturedRunError,
  captureRun,
  finishRunCapture,
  runDir,
} from '../services/runCapture.ts';
import { serializeState } from '../services/state.ts';
import type { UninstallDeps } from '../services/uninstall.ts';
import { DEFAULT_STATE, type InstallTask, type ShellId } from '../types.ts';
import { restoreEnv } from './helpers/env.ts';

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
    expect(help).toContain('--restore           Copy');
    expect(help).toContain('-o, --output <file>');
    expect(help).toContain('--import, --state <file>');
    expect(help).toContain('--shells is');
  });

  it('rejects unknown flags before the global flags run', () => {
    expect(() => parseCliArgs(['--bogus'])).toThrow("Unknown flag '--bogus'");
    expect(stdoutWrite).not.toHaveBeenCalled();
  });
});

describe('index restore flag', () => {
  let stdoutWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true as never);
    mockRestoreConfigBackups.mockReset();
  });

  afterEach(() => {
    stdoutWrite.mockRestore();
  });

  it('prints the restored configs for --restore', () => {
    const backup = '/home/u/.config/starship.toml.bak-2026-09-09T09-30-00-000Z';
    const backup2 = '/home/u/.config/starship/zsh.toml.bak-2026-09-08T10-00-00-000Z';
    mockRestoreConfigBackups.mockReturnValue({
      restored: [
        { what: 'shared', restoredTo: '/home/u/.config/starship.toml', restoredFrom: backup },
        { what: 'zsh', restoredTo: '/home/u/.config/starship/zsh.toml', restoredFrom: backup2 },
      ],
      failed: [],
    });

    const snapshotId = writeSnapshot({ ...DEFAULT_STATE, selectedShells: ['fish', 'zsh'] });
    appendHistory({ version: 1, timestamp: new Date().toISOString(), kind: 'apply', snapshotId });

    expect(runGlobalFlags(parseCliArgs(['--restore']))).toBe(true);

    expect(mockRestoreConfigBackups).toHaveBeenCalledWith(['fish', 'zsh']);
    expect(stdoutWrite).toHaveBeenCalledWith(
      expect.stringContaining('shared: /home/u/.config/starship.toml')
    );
    expect(stdoutWrite).toHaveBeenCalledWith(
      expect.stringContaining('zsh: /home/u/.config/starship/zsh.toml')
    );
  });

  it('reports partial restore failures instead of claiming success', () => {
    const backup = '/home/u/.config/starship/zsh.toml.bak-2026-09-08T10-00-00-000Z';
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as never);
    const savedExitCode = process.exitCode;
    mockRestoreConfigBackups.mockReturnValue({
      restored: [
        { what: 'shared', restoredTo: '/home/u/.config/starship.toml', restoredFrom: backup },
      ],
      failed: [{ what: 'zsh' as const, restoredFrom: backup, error: 'EACCES: permission denied' }],
    });

    try {
      expect(runGlobalFlags(parseCliArgs(['--restore']))).toBe(true);

      expect(stdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining('shared: /home/u/.config/starship.toml')
      );
      expect(stderrWrite).toHaveBeenCalledWith(
        expect.stringContaining('Could not restore some configs')
      );
      expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('EACCES'));
      expect(process.exitCode).toBe(1);
    } finally {
      stderrWrite.mockRestore();
      process.exitCode = savedExitCode;
    }
  });

  it('points --undo at rollback instead of restoring only the configs', () => {
    expect(() => parseCliArgs(['--undo'])).toThrow(
      new CliUsageError(
        '--undo is gone: shell-configurator rollback undoes the last run, rc lines included. --restore still copies the newest config backups back.'
      )
    );
    expect(mockRestoreConfigBackups).not.toHaveBeenCalled();
  });

  it('reports when there is nothing to restore', () => {
    mockRestoreConfigBackups.mockReturnValue({ restored: [], failed: [] });

    runGlobalFlags(parseCliArgs(['--restore']));

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Nothing to restore'));
  });

  it('prefers --version over --restore regardless of argv order', () => {
    mockRestoreConfigBackups.mockReturnValue({ restored: [], failed: [] });

    expect(runGlobalFlags(parseCliArgs(['--restore', '--version']))).toBe(true);
    expect(runGlobalFlags(parseCliArgs(['--version', '--restore']))).toBe(true);
    expect(mockRestoreConfigBackups).not.toHaveBeenCalled();
    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringMatching(/^\d+\.\d+\.\d+\n$/));
  });

  it('refuses --restore in a dry run instead of restoring', () => {
    mockRestoreConfigBackups.mockReturnValue({ restored: [], failed: [] });

    expect(() => runGlobalFlags(parseCliArgs(['--dry-run', '--restore']))).toThrow(
      /cannot run in a dry run/
    );
    expect(mockRestoreConfigBackups).not.toHaveBeenCalled();
  });

  it('refuses --restore alongside a subcommand', () => {
    mockRestoreConfigBackups.mockReturnValue({ restored: [], failed: [] });

    expect(() =>
      runGlobalFlags(parseCliArgs(['generate', '--preset', 'pure-prompt', '--restore']))
    ).toThrow(/cannot be combined with the generate subcommand/);
    expect(mockRestoreConfigBackups).not.toHaveBeenCalled();
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

  it('warns when repair gets config flags without --state', async () => {
    mockRunRepair.mockResolvedValue({ ok: true, actions: [] });
    mockFormatRepairReport.mockReturnValue('REPAIRED\n');
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as never);

    await route(['repair', '--font', 'none']);

    expect(stderrWrite).toHaveBeenCalledWith(
      expect.stringContaining('--font is ignored by repair without --state')
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

  it('checks doctor and repair against a --state card', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shellconf-index-'));
    try {
      const card = path.join(dir, 'card.json');
      fs.writeFileSync(card, serializeState({ ...DEFAULT_STATE, selectedShells: ['fish'] }));
      mockRunDoctor.mockResolvedValue({ ok: true, findings: [] });
      mockFormatDoctorReport.mockReturnValue('HEALTHY\n');
      mockRunRepair.mockResolvedValue({ ok: true, actions: [] });
      mockFormatRepairReport.mockReturnValue('REPAIRED\n');

      await route(['doctor', '--state', card]);
      await route(['repair', '--state', card]);

      expect(mockRunDoctor.mock.calls[0]![0]).toMatchObject({ selectedShells: ['fish'] });
      expect(mockRunRepair.mock.calls[0]![0]).toMatchObject({ selectedShells: ['fish'] });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prints the repair report as JSON with --json', async () => {
    const report = { ok: true, actions: [], dryRun: false };
    mockRunRepair.mockResolvedValue(report);

    await route(['repair', '--json']);

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

  it('runs repair and prints the repair report', async () => {
    mockRunRepair.mockResolvedValue({ ok: true, actions: [] });
    mockFormatRepairReport.mockReturnValue('REPAIRED\n');

    const routed = await route(['repair']);

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

  it('upgrades doctor --fix into a repair', async () => {
    mockRunRepair.mockResolvedValue({ ok: true, actions: [] });
    mockFormatRepairReport.mockReturnValue('REPAIRED\n');

    const routed = await route(['doctor', '--fix']);

    expect(routed).toBe(true);
    expect(mockRunRepair).toHaveBeenCalledWith(
      null,
      {},
      { includeWarnings: undefined, dryRun: true }
    );
    expect(mockRunDoctor).not.toHaveBeenCalled();
  });

  it('passes --dry-run through to repair so nothing is applied', async () => {
    mockRunRepair.mockResolvedValue({ ok: true, actions: [], dryRun: true });
    mockFormatRepairReport.mockReturnValue('PLANNED\n');

    const routed = await route(['repair', '--dry-run']);

    expect(routed).toBe(true);
    expect(mockRunRepair).toHaveBeenCalledOnce();
    expect(mockRunRepair).toHaveBeenCalledWith(
      null,
      {},
      { includeWarnings: undefined, dryRun: true }
    );
    expect(stdoutWrite).toHaveBeenCalledWith('PLANNED\n');
  });

  it('passes --include-warnings through to repair and doctor --fix', async () => {
    mockRunRepair.mockResolvedValue({ ok: true, actions: [], dryRun: false });
    mockFormatRepairReport.mockReturnValue('');

    await route(['repair', '--include-warnings']);
    await route(['doctor', '--fix', '--include-warnings']);

    for (const call of mockRunRepair.mock.calls) {
      expect(call[2]).toMatchObject({ includeWarnings: true });
    }
    expect(mockRunRepair).toHaveBeenCalledTimes(2);
  });

  it('rejects --include-warnings outside a repair', async () => {
    await expect(route(['doctor', '--include-warnings'])).rejects.toThrow(
      '--include-warnings only applies to repair'
    );
  });

  it('reports a repair with nothing to fix as a real run, not a dry run', async () => {
    mockRunRepair.mockResolvedValue({ ok: true, actions: [], dryRun: true });
    mockFormatRepairReport.mockImplementation((report) => `REPORT ${report.dryRun}\n`);

    await route(['repair']);

    expect(stdoutWrite).toHaveBeenCalledWith('REPORT false\n');
  });

  it('sets a non-zero exit code when a repair still fails a check', async () => {
    process.exitCode = 0;
    mockRunRepair.mockResolvedValue({ ok: false, actions: [] });
    mockFormatRepairReport.mockReturnValue('STILL BROKEN\n');

    await route(['repair']);

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

      await runRepairCommand(parseCliArgs(['repair']), 'repair', ask);

      expect(ask.confirm).toHaveBeenCalled();
      expect(output()).toContain('REPORT true');
      expect(output()).toContain('Nothing was changed.');
      expect(mockRunRepair).toHaveBeenCalledOnce();
      expect(mockRecordRun).not.toHaveBeenCalled();
    });

    it('refuses off a terminal without --yes', async () => {
      await expect(
        runRepairCommand(parseCliArgs(['repair']), 'repair', io({ isTerminal: () => false }))
      ).rejects.toThrow('repair changes files and may install software; pass --yes');
      expect(mockRunRepair).toHaveBeenCalledOnce();
    });

    it('still records a repair that throws partway, so rollback can undo it', async () => {
      vi.mocked(captureRun).mockRejectedValueOnce(
        new CapturedRunError('run-3', new Error('starship install broke'))
      );

      await expect(
        runRepairCommand(parseCliArgs(['repair', '--yes']), 'repair --yes', io())
      ).rejects.toThrow('starship install broke');
      expect(mockRecordRun).toHaveBeenCalledWith({
        kind: 'repair',
        command: 'repair --yes',
        exitCode: 1,
        runId: 'run-3',
      });
    });

    it('applies the fixes inside a captured run, records it and points at rollback', async () => {
      vi.mocked(captureRun).mockImplementationOnce(async (_files, run) => ({
        result: await run(),
        runId: 'run-7',
      }));
      const ask = io();

      await runRepairCommand(parseCliArgs(['repair', '--yes']), 'repair --yes', ask);

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
        command: 'repair --yes',
        exitCode: 0,
        runId: 'run-7',
      });
    });
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
      result: await run(),
      runId: 'run-9',
    }));
    const io = fakeIo(
      {},
      { removeManagedRcBlocks: vi.fn(() => ({ removed: true, backedUpTo: '/h/.zshrc.bak-1' })) }
    );

    await runUninstallCommand(parseCliArgs(['uninstall']), 'uninstall', io);

    expect(io.deps.removeManagedRcBlocks).toHaveBeenCalledWith('zsh');
    expect(io.deps.removeShellConfigFile).toHaveBeenCalledWith('zsh');
    expect(output()).toContain('REMOVED Zsh config');
    expect(output()).toContain('Undo it with: shell-configurator rollback');
    expect(output()).not.toContain('  cp ');
    expect(mockRecordRun).toHaveBeenCalledWith({
      kind: 'uninstall',
      command: 'uninstall',
      exitCode: 0,
      runId: 'run-9',
    });
  });

  it('says rollback cannot bring back a removed Starship or font', async () => {
    vi.mocked(captureRun).mockImplementationOnce(async (_files, run) => ({
      result: await run(),
      runId: 'run-9',
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
      'Rollback only puts files back: reinstall Hack and Starship with shell-configurator apply or repair.'
    );
  });

  it('prints the copy-back commands when the run could not be captured', async () => {
    const io = fakeIo(
      {},
      {
        removeManagedRcBlocks: vi.fn(() => ({ removed: true, backedUpTo: '/h/.zshrc.bak-1' })),
        removeShellConfigFile: vi.fn(() => ({ removed: true, backedUpTo: "/h/it's.toml.bak-1" })),
      }
    );

    await runUninstallCommand(parseCliArgs(['uninstall']), 'uninstall', io);

    expect(output()).toContain('To undo, copy the backups back:');
    expect(output()).toContain(`  cp '/h/.zshrc.bak-1' '${getShell('zsh')!.rcFile}'`);
    expect(output()).toContain(`  cp '/h/it'\\''s.toml.bak-1' '${getShellConfigPath('zsh')}'`);
    expect(output()).not.toContain('rollback');
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
    [['--include-warnings'], /--include-warnings only applies to repair/],
    [['--restore'], /--restore cannot be used with uninstall/],
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
      '--yes only applies to repair, doctor --fix, uninstall and rollback.'
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

describe('index rollback command', () => {
  let stdoutWrite: ReturnType<typeof vi.spyOn>;
  let tmpDir: string;
  const savedEnv = { ...process.env };
  const savedExitCode = process.exitCode;

  beforeEach(() => {
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true as never);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shellconf-rollback-cli-'));
    process.env.XDG_STATE_HOME = path.join(tmpDir, 'state');
    mockRecordRun.mockClear();
  });

  afterEach(() => {
    stdoutWrite.mockRestore();
    restoreEnv(savedEnv);
    process.exitCode = savedExitCode;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const output = () => stdoutWrite.mock.calls.map((c: unknown[]) => String(c[0])).join('');
  const rc = () => path.join(tmpDir, 'rc');
  const io = (overrides: Partial<PromptIo> = {}): PromptIo => ({
    confirm: vi.fn().mockResolvedValue(true),
    isTerminal: () => true,
    ...overrides,
  });

  /** Records a run of `kind` that wrote `content` to the rc; returns its runId. */
  function recordedRun(kind: 'install' | 'apply', content: string): string {
    const capture = beginRunCapture([rc()]);
    fs.writeFileSync(rc(), content);
    const runId = finishRunCapture(capture)!.runId;
    appendHistory({ version: 1, timestamp: new Date().toISOString(), kind, runId });
    return runId;
  }

  it('lists the runs that changed files', async () => {
    const first = recordedRun('install', 'one');
    const second = recordedRun('apply', 'two');

    await runRollbackCommand(parseCliArgs(['rollback', '--list']), 'rollback --list', io());

    expect(output()).toBe(
      `${second}  apply     1 file (next to roll back)\n${first}  install   1 file\n`
    );
  });

  it('lists the runs as JSON', async () => {
    const runId = recordedRun('install', 'one');
    await runRollbackCommand(parseCliArgs(['rollback', '--list', '--json']), 'rollback', io());
    expect(JSON.parse(output())).toEqual([expect.objectContaining({ runId, files: 1 })]);
  });

  it('puts the newest run back once confirmed and records the rollback', async () => {
    fs.writeFileSync(rc(), 'zero');
    recordedRun('install', 'one');
    const second = recordedRun('apply', 'two');
    const prompt = io();

    await runRollbackCommand(parseCliArgs(['rollback']), 'rollback', prompt);

    expect(prompt.confirm).toHaveBeenCalled();
    expect(fs.readFileSync(rc(), 'utf8')).toBe('one');
    expect(output()).toContain(`RESTORED ${rc()}`);
    expect(mockRecordRun).toHaveBeenCalledWith({
      kind: 'rollback',
      command: 'rollback',
      exitCode: 0,
      runId: null,
      rollbackOf: second,
      partial: false,
    });
  });

  describe('of an interrupted run', () => {
    function interruptedRun(): string {
      fs.writeFileSync(rc(), 'zero');
      const capture = beginRunCapture([rc()]);
      fs.writeFileSync(rc(), 'one');
      const runId = finishRunCapture(capture)!.runId;
      appendHistory({
        version: 1,
        timestamp: new Date().toISOString(),
        kind: 'apply',
        runId,
        interrupted: true,
      });
      return runId;
    }

    it('warns that later edits come back too, and asks on a terminal even with --yes', async () => {
      interruptedRun();
      const prompt = io({ confirm: vi.fn().mockResolvedValue(false) });

      await runRollbackCommand(parseCliArgs(['rollback', '--yes']), 'rollback', prompt);

      expect(output()).toContain('That run was interrupted');
      expect(prompt.confirm).toHaveBeenCalled();
      expect(fs.readFileSync(rc(), 'utf8')).toBe('one');
    });

    it('goes ahead with --yes --json on a terminal, where nothing can be asked', async () => {
      interruptedRun();
      const prompt = io();

      await runRollbackCommand(parseCliArgs(['rollback', '--yes', '--json']), 'rollback', prompt);

      expect(prompt.confirm).not.toHaveBeenCalled();
      expect(fs.readFileSync(rc(), 'utf8')).toBe('zero');
    });

    it.each([['--list'], ['--dry-run']])(
      'leaves a dead run unrecorded with %s, and says it is waiting',
      async (flag) => {
        fs.writeFileSync(rc(), 'zero');
        const live = beginRunCapture([rc()]);
        const dead = path.join(runDir(live.runId), '..', '2000-01-01T00-00-00.000Z');
        fs.cpSync(runDir(live.runId), dead, { recursive: true });
        finishRunCapture(live);
        fs.writeFileSync(rc(), 'one');

        await runRollbackCommand(parseCliArgs(['rollback', flag]), 'rollback', io());

        expect(output()).toContain('1 interrupted run is not listed yet');
        expect(fs.existsSync(path.join(dead, 'pending.json'))).toBe(true);
        expect(mockRecordRun).not.toHaveBeenCalled();
      }
    );

    it('goes ahead with --yes off a terminal', async () => {
      interruptedRun();

      await runRollbackCommand(
        parseCliArgs(['rollback', '--yes']),
        'rollback',
        io({ isTerminal: () => false })
      );

      expect(fs.readFileSync(rc(), 'utf8')).toBe('zero');
    });
  });

  it('marks a run whose files are already back as rolled back, without asking', async () => {
    fs.writeFileSync(rc(), 'zero');
    const runId = recordedRun('apply', 'one');
    fs.writeFileSync(rc(), 'zero');
    const prompt = io();

    await runRollbackCommand(parseCliArgs(['rollback']), 'rollback', prompt);

    expect(prompt.confirm).not.toHaveBeenCalled();
    expect(output()).toContain('already as it was before that run');
    expect(output()).toContain('that run now counts as rolled back');
    expect(mockRecordRun).toHaveBeenCalledWith({
      kind: 'rollback',
      command: 'rollback',
      exitCode: 0,
      runId: null,
      rollbackOf: runId,
      partial: false,
    });
  });

  it('records nothing for --run on a run that is already rolled back', async () => {
    fs.writeFileSync(rc(), 'zero');
    const runId = recordedRun('apply', 'one');
    fs.writeFileSync(rc(), 'zero');
    appendHistory({
      version: 1,
      timestamp: new Date().toISOString(),
      kind: 'rollback',
      runId: 'later-rollback',
      rollbackOf: runId,
    });

    await runRollbackCommand(parseCliArgs(['rollback', '--run', runId]), 'rollback', io());

    expect(output()).not.toContain('now counts as rolled back');
    expect(mockRecordRun).not.toHaveBeenCalled();
  });

  it('records nothing for a dry run whose files are already back', async () => {
    fs.writeFileSync(rc(), 'zero');
    recordedRun('apply', 'one');
    fs.writeFileSync(rc(), 'zero');

    await runRollbackCommand(parseCliArgs(['rollback', '--dry-run']), 'rollback', io());

    expect(mockRecordRun).not.toHaveBeenCalled();
  });

  it('records a rollback that left a change in place as partial', async () => {
    const other = path.join(tmpDir, 'other');
    fs.writeFileSync(rc(), 'zero');
    fs.writeFileSync(other, 'zero');
    const capture = beginRunCapture([rc(), other]);
    fs.writeFileSync(rc(), 'one');
    fs.writeFileSync(other, 'one');
    const runId = finishRunCapture(capture)!.runId;
    appendHistory({ version: 1, timestamp: new Date().toISOString(), kind: 'apply', runId });
    fs.writeFileSync(other, 'edited');

    await runRollbackCommand(parseCliArgs(['rollback', '--yes']), 'rollback', io());

    expect(fs.readFileSync(rc(), 'utf8')).toBe('zero');
    expect(output()).toContain('so it stays next to roll back');
    expect(mockRecordRun).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'rollback', rollbackOf: runId, partial: true })
    );
  });

  it('rolls back the run --run names', async () => {
    fs.writeFileSync(rc(), 'zero');
    const first = recordedRun('install', 'one');
    recordedRun('apply', 'two');

    await runRollbackCommand(parseCliArgs(['rollback', '--run', first, '--yes']), 'rollback', io());

    expect(output()).toContain('changed since that run');
    expect(fs.readFileSync(rc(), 'utf8')).toBe('two');
  });

  it('changes nothing when the user says no', async () => {
    recordedRun('install', 'one');
    await runRollbackCommand(
      parseCliArgs(['rollback']),
      'rollback',
      io({ confirm: vi.fn().mockResolvedValue(false) })
    );
    expect(fs.readFileSync(rc(), 'utf8')).toBe('one');
    expect(output()).toContain('Nothing was changed.');
    expect(mockRecordRun).not.toHaveBeenCalled();
  });

  it('only prints the plan in a dry run', async () => {
    recordedRun('install', 'one');
    await runRollbackCommand(parseCliArgs(['rollback', '--dry-run']), 'rollback', io());
    expect(output()).toContain(`PLANNED ${rc()}`);
    expect(fs.existsSync(rc())).toBe(true);
  });

  it('refuses to change files off a terminal without --yes', async () => {
    recordedRun('install', 'one');
    await expect(
      runRollbackCommand(parseCliArgs(['rollback']), 'rollback', io({ isTerminal: () => false }))
    ).rejects.toThrow(/rollback rewrites files; pass --yes/);
  });

  it('says when there is nothing to roll back', async () => {
    await runRollbackCommand(parseCliArgs(['rollback']), 'rollback', io());
    expect(output()).toBe('Nothing to roll back.\n');
  });

  it('reports nothing to roll back as a complete JSON report', async () => {
    await runRollbackCommand(parseCliArgs(['rollback', '--json']), 'rollback', io());
    expect(JSON.parse(output())).toEqual({
      runId: null,
      actions: [],
      ok: true,
      complete: true,
      dryRun: false,
    });
  });

  it('rejects an unknown run id', async () => {
    await expect(
      runRollbackCommand(parseCliArgs(['rollback', '--run', 'nope']), 'rollback', io())
    ).rejects.toThrow(/No recorded run 'nope'/);
  });

  it('exits non-zero when a file cannot be put back', async () => {
    fs.writeFileSync(rc(), 'zero');
    const runId = recordedRun('install', 'one');
    fs.rmSync(path.join(runDir(runId), 'files'), { recursive: true });

    await runRollbackCommand(parseCliArgs(['rollback', '--yes']), 'rollback', io());

    expect(process.exitCode).toBe(1);
    expect(output()).toContain(`FAILED  ${rc()}`);
  });

  it.each([
    [['--preset', 'pure-prompt'], /--preset cannot be used with rollback/],
    [['--state', 'card.json'], /--state cannot be used with rollback/],
    [['--fix'], /--fix cannot be used with rollback/],
    [['--include-warnings'], /--include-warnings only applies to repair/],
    [['--restore'], /--restore cannot be used with rollback/],
  ])('rejects %o', async (args, message) => {
    await expect(
      runHeadlessCommand(parseCliArgs(['rollback', ...args]), 'rollback')
    ).rejects.toThrow(message);
  });

  it('rejects --list and --run outside rollback', async () => {
    await expect(runHeadlessCommand(parseCliArgs(['doctor', '--list']), '')).rejects.toThrow(
      '--list only applies to rollback.'
    );
    await expect(runHeadlessCommand(parseCliArgs(['apply', '--run', 'x']), '')).rejects.toThrow(
      '--run only applies to rollback.'
    );
  });

  it('documents rollback in the help text', () => {
    runGlobalFlags(parseCliArgs(['--help']));
    expect(output()).toContain('shell-configurator rollback');
    expect(output()).toContain('--run <id>');
  });
});

describe('index debug-info command', () => {
  let stdoutWrite: ReturnType<typeof vi.spyOn>;
  let home: string;

  beforeEach(() => {
    home = homeDir();
    deps.env = { PATH: `${home}/bin:/usr/bin` };
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true as never);
    mockFormatDoctorReport.mockReturnValue('Starship health check\n\nPASS    Starship — ok\n');
  });

  afterEach(() => {
    stdoutWrite.mockRestore();
  });

  const output = () => stdoutWrite.mock.calls.map((c: unknown[]) => String(c[0])).join('');
  const deps: DebugInfoDeps = {
    detectPackageManager: async () => 'apt',
    detectInstalledShells: async () => ['bash'],
    detectTerminal: async () => null,
    detectContainer: async () => true,
    detectCurrentShell: async () => 'bash',
    findStarship: async () => ({ installed: false }),
    starshipPath: () => null,
    recordedStarshipVersion: () => null,
    distro: () => 'Debian GNU/Linux 12 (bookworm)',
    runDoctor: async () => ({ ok: false, findings: [] }),
    history: () => [],
    shellFacts: () => ({ startsStarship: false, managedBlock: false, config: false }),
    hasStarshipIn: () => false,
    env: {},
    os: () => 'Linux 6.1.0 (linux/x64)',
  };

  it('prints the Markdown report with the version and the doctor findings', async () => {
    await runDebugInfoCommand(parseCliArgs(['debug-info']), deps);

    expect(output()).toMatch(
      /^# shell-configurator debug info\n\n- shell-configurator: \d+\.\d+\.\d+\n/
    );
    expect(output()).toContain('- OS: Linux 6.1.0 (linux/x64) — Debian GNU/Linux 12 (bookworm)');
    expect(output()).toContain('- Installed: no');
    expect(output()).toContain('PASS    Starship — ok');
    expect(output()).toContain('- `~/bin`');
  });

  it('prints the data as JSON with the home directory hidden', async () => {
    await runDebugInfoCommand(parseCliArgs(['debug-info', '--json']), deps);

    const info = JSON.parse(output());
    expect(info).toMatchObject({ packageManager: 'apt', container: true, currentShell: 'bash' });
    expect(info.path[0].dir).toBe('~/bin');
    expect(output()).not.toContain(home);
  });

  it.each([
    [['--preset', 'pure-prompt'], /--preset cannot be used with debug-info/],
    [['--state', 'card.json'], /--state cannot be used with debug-info/],
    [['--dry-run'], /--dry-run cannot be used with debug-info/],
  ])('rejects %o', async (args, message) => {
    await expect(runHeadlessCommand(parseCliArgs(['debug-info', ...args]), '')).rejects.toThrow(
      message
    );
  });

  it('documents debug-info in the help text', () => {
    runGlobalFlags(parseCliArgs(['--help']));
    expect(output()).toContain('shell-configurator debug-info');
  });
});

describe('index completions command', () => {
  let stdoutWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true as never);
  });

  afterEach(() => {
    stdoutWrite.mockRestore();
  });

  const output = () => stdoutWrite.mock.calls.map((c: unknown[]) => String(c[0])).join('');

  it.each(['bash', 'zsh', 'fish'] as const)('prints the %s script', (shell) => {
    runCompletionsCommand(parseCliArgs(['completions', shell]));
    expect(output()).toBe(completionScript(shell));
  });

  it('routes the subcommand', async () => {
    expect(await runHeadlessCommand(parseCliArgs(['completions', 'fish']), '')).toBe(true);
    expect(output()).toContain('complete -c shell-configurator');
  });

  it.each([
    [['completions'], /completions needs a shell: bash, zsh, fish/],
    [['completions', 'tcsh'], /No completions for 'tcsh'/],
    [['completions', 'zsh', '--json'], /--json cannot be used with completions/],
    [['completions', 'zsh', '--preset', 'pure-prompt'], /--preset cannot be used with completions/],
    [
      [
        'completions',
        'bash',
        '--run',
        'abc',
        '--yes',
        '--include-warnings',
        '--starship',
        '--list',
      ],
      /--include-warnings only applies to repair/,
    ],
  ])('rejects %o', async (args, message) => {
    await expect(runHeadlessCommand(parseCliArgs(args), '')).rejects.toThrow(message);
  });

  it('documents completions and where to install them in the help text', () => {
    runGlobalFlags(parseCliArgs(['--help']));
    expect(output()).toContain('shell-configurator completions <bash|zsh|fish>');
    expect(output()).toContain('~/.config/fish/completions/shell-configurator.fish');
  });
});

describe('index list flags', () => {
  let stdoutWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true as never);
  });

  afterEach(() => {
    stdoutWrite.mockRestore();
  });

  const output = () => stdoutWrite.mock.calls.map((c: unknown[]) => String(c[0])).join('');

  it.each([
    ['--list-presets', 'presets'],
    ['--list-modules', 'modules'],
    ['--list-fonts', 'fonts'],
  ] as const)('%s prints the %s', (flag, kind) => {
    expect(runGlobalFlags(parseCliArgs([flag]))).toBe(true);
    expect(output()).toBe(formatListing(listEntries(kind)));
  });

  it('prints the data as JSON with --json', () => {
    runGlobalFlags(parseCliArgs(['--list-fonts', '--json']));
    expect(JSON.parse(output())).toEqual(listEntries('fonts'));
  });

  it('runs before the subcommand check, so --json needs no subcommand', async () => {
    expect((await routeCli(['--list-presets', '--json'])).handled).toBe(true);
  });

  it('rejects any other flag next to a list flag, except --json', () => {
    expect(() =>
      runGlobalFlags(
        parseCliArgs(['--list-presets', '--shells', 'bash', '--dry-run', '--state', 'x'])
      )
    ).toThrow('--shells, --state, --dry-run cannot be used with --list-presets.');
    expect(runGlobalFlags(parseCliArgs(['--list-presets', '--json']))).toBe(true);
  });

  it('rejects a list flag with a subcommand, or two at once', () => {
    expect(() => runGlobalFlags(parseCliArgs(['apply', '--list-presets']))).toThrow(
      '--list-presets cannot be combined with the apply subcommand.'
    );
    expect(() => runGlobalFlags(parseCliArgs(['--list-presets', '--list-fonts']))).toThrow(
      'Pass one of --list-presets, --list-fonts at a time.'
    );
  });

  it('documents the list flags in the help text', () => {
    runGlobalFlags(parseCliArgs(['--help']));
    expect(output()).toContain('--list-presets | --list-modules | --list-fonts [--json]');
  });
});

describe('index timings command', () => {
  let stdoutWrite: ReturnType<typeof vi.spyOn>;
  const output = () => stdoutWrite.mock.calls.map((c: unknown[]) => String(c[0])).join('');
  const TIMINGS = ` Here are the timings of modules in your prompt (>=1ms or output):
 git_status  -  320ms  -   "[?1] "
 character   -   <1ms  -   "> "
`;
  const deps = (installed = true) => ({
    isStarshipInstalled: async () => installed,
    run: vi.fn(async (_command: string, _path: string, configPath: string) => ({
      stdout: TIMINGS,
      stderr: `config was ${fs.readFileSync(configPath, 'utf8').length} bytes`,
    })),
  });

  beforeEach(() => {
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true as never);
  });
  afterEach(() => stdoutWrite.mockRestore());

  it('times a config built from the flags in the current folder, with suggestions', async () => {
    const probe = deps();
    await runTimingsCommand(parseCliArgs(['timings', '--preset', 'pure-prompt']), probe);

    expect(probe.run).toHaveBeenCalledWith('timings', process.cwd(), expect.any(String));
    expect(output()).toContain('(config: built from the flags)');
    expect(output()).toMatch(/git_status\s+320ms {2}slow/);
    expect(output()).toContain('Suggestions:');
    expect(output()).toContain('git_status took 320ms');
  });

  it('times the config Starship loads here when no flags are given', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shellconf-active-'));
    const config = path.join(dir, 'zsh.toml');
    fs.writeFileSync(config, 'format = "$character"\n');
    vi.stubEnv('STARSHIP_CONFIG', config);
    try {
      const probe = deps();
      await runTimingsCommand(parseCliArgs(['timings']), probe);
      expect(output()).toContain(`(config: ${config})`);
      expect(probe.run).toHaveBeenCalledWith('timings', process.cwd(), config);
    } finally {
      vi.unstubAllEnvs();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("times Starship's built-in default prompt when the config it would load is missing", async () => {
    vi.stubEnv('STARSHIP_CONFIG', '/no/such/starship.toml');
    try {
      const probe = deps();
      probe.run.mockImplementationOnce(async () => ({ stdout: TIMINGS, stderr: '' }));
      await runTimingsCommand(parseCliArgs(['timings']), probe);
      expect(output()).toContain(
        "(config: Starship's built-in default prompt, since $STARSHIP_CONFIG (/no/such/starship.toml) does not exist)"
      );
      expect(probe.run).toHaveBeenCalledWith('timings', process.cwd(), '/no/such/starship.toml');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('times the file --config names, as JSON with --json', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shellconf-timings-'));
    const config = path.join(dir, 'starship.toml');
    fs.writeFileSync(config, 'format = "$git_status$character"\n');
    try {
      await runTimingsCommand(parseCliArgs(['timings', '--config', config, '--json']), deps());
      expect(JSON.parse(output())).toMatchObject({ config, slowestMs: 320, slow: true });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([
    [['--config', 'x', '--preset', 'pure-prompt'], /--config times an existing file, so --preset/],
    [['--config', '/no/such/file'], /Could not read '\/no\/such\/file'/],
  ])('rejects %o', async (args, message) => {
    await expect(runTimingsCommand(parseCliArgs(['timings', ...args]), deps())).rejects.toThrow(
      message
    );
  });

  it.each([
    [['--shells', 'zsh'], /--shells cannot be used with timings/],
    [['--yes'], /--yes only applies to repair/],
  ])('refuses %o before timing anything', async (args, message) => {
    await expect(runHeadlessCommand(parseCliArgs(['timings', ...args]), '')).rejects.toThrow(
      message
    );
  });

  it('says Starship is needed when it is not installed', async () => {
    await expect(
      runTimingsCommand(parseCliArgs(['timings', '--preset', 'pure-prompt']), deps(false))
    ).rejects.toThrow(/Starship is not installed/);
  });

  it('documents timings in the help text', () => {
    runGlobalFlags(parseCliArgs(['--help']));
    expect(output()).toContain('shell-configurator timings');
    expect(output()).toContain('--config <file>');
  });

  it('refuses an adopt-mode card and points at the shared config instead', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shellconf-adopt-'));
    const card = path.join(dir, 'card.json');
    fs.writeFileSync(card, serializeState({ ...DEFAULT_STATE, keepExistingConfig: true }));
    try {
      await expect(
        runTimingsCommand(parseCliArgs(['timings', '--state', card]), deps())
      ).rejects.toThrow(/adopt-mode card keeps your own config.*--config .*starship\.toml/);
      expect(() => runShareCommand(parseCliArgs(['share', '--state', card]))).toThrow(
        /adopt-mode card keeps your own config, so there is no generated prompt to share/
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects --config outside timings', async () => {
    await expect(
      runHeadlessCommand(parseCliArgs(['generate', '--config', 'x']), '')
    ).rejects.toThrow('--config only applies to timings.');
  });
});

describe('index share command', () => {
  let stdoutWrite: ReturnType<typeof vi.spyOn>;
  const output = () => stdoutWrite.mock.calls.map((c: unknown[]) => String(c[0])).join('');
  beforeEach(() => {
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true as never);
  });
  afterEach(() => stdoutWrite.mockRestore());

  it('prints the prompt the flags build as Markdown', () => {
    runShareCommand(parseCliArgs(['share', '--preset', 'pure-prompt']));
    expect(output()).toMatch(/^# Starship prompt: Pure Prompt\n/);
    expect(output()).toContain('```toml');
  });

  it('writes it to the -o file instead', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shellconf-share-cli-'));
    const file = path.join(dir, 'prompt.md');
    try {
      runShareCommand(parseCliArgs(['share', '-o', file]));
      expect(fs.readFileSync(file, 'utf8')).toContain('## starship.toml');
      expect(output()).toBe(`Wrote ${file}\n`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([
    [['--shells', 'zsh'], /--shells cannot be used with share/],
    [['--json'], /--json cannot be used with share/],
  ])('rejects %o', async (args, message) => {
    await expect(runHeadlessCommand(parseCliArgs(['share', ...args]), '')).rejects.toThrow(message);
  });

  it('documents share in the help text', () => {
    runGlobalFlags(parseCliArgs(['--help']));
    expect(output()).toContain('shell-configurator share');
  });
});
