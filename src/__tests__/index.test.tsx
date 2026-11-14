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
  runRepair: mockRunRepair,
  formatRepairReport: mockFormatRepairReport,
}));

import { render } from 'ink';
import {
  applyInstallOutcomeExitCode,
  crash,
  recordInstallOutcome,
  reportFatal,
  routeCli,
  runGlobalFlags,
  runHeadlessCommand,
  runUninstallCommand,
  type UninstallIo,
} from '../index.tsx';
import { parseCliArgs } from '../services/args.ts';
import { CliRunError, CliUsageError } from '../services/errors.ts';
import { serializeState } from '../services/state.ts';
import type { UninstallDeps } from '../services/uninstall.ts';
import { DEFAULT_STATE, type InstallTask, type ShellId } from '../types.ts';

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
    expect(help).toContain('--restore, --undo');
    expect(help).toContain('-o, --output <file>');
    expect(help).toContain('--import, --state <file>');
    expect(help).toContain('--shells is');
    expect(help).not.toContain('read-only');
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

    expect(runGlobalFlags(parseCliArgs(['--restore']))).toBe(true);

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

  it('accepts --undo as an alias for --restore', () => {
    mockRestoreConfigBackups.mockReturnValue({ restored: [], failed: [] });

    expect(runGlobalFlags(parseCliArgs(['--undo']))).toBe(true);
    expect(mockRestoreConfigBackups).toHaveBeenCalled();
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
    });

    expect(mockRecordRun).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'install',
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
      /--preset, -o\/--output require a subcommand/
    );
    await expect(route(['--json'])).rejects.toThrow(/--json require a subcommand/);
    await expect(route(['--shells', 'zsh'])).rejects.toThrow(/--shells require a subcommand/);
    await expect(route(['--state', 'card.json'])).rejects.toThrow(/--state require a subcommand/);
  });

  it('surfaces a bogus flag as a CliUsageError', async () => {
    await expect(route(['apply', '--preset', 'nope'])).rejects.toThrow(CliUsageError);
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
    expect(mockRunRepair).toHaveBeenCalledWith(null, undefined, { dryRun: undefined });
    expect(stdoutWrite).toHaveBeenCalledWith('REPAIRED\n');
    expect(mockRunDoctor).not.toHaveBeenCalled();
  });

  it('upgrades doctor --fix into a repair', async () => {
    mockRunRepair.mockResolvedValue({ ok: true, actions: [] });
    mockFormatRepairReport.mockReturnValue('REPAIRED\n');

    const routed = await route(['doctor', '--fix']);

    expect(routed).toBe(true);
    expect(mockRunRepair).toHaveBeenCalledWith(null, undefined, { dryRun: undefined });
    expect(mockRunDoctor).not.toHaveBeenCalled();
  });

  it('passes --dry-run through to repair so nothing is applied', async () => {
    mockRunRepair.mockResolvedValue({ ok: true, actions: [], dryRun: true });
    mockFormatRepairReport.mockReturnValue('PLANNED\n');

    const routed = await route(['repair', '--dry-run']);

    expect(routed).toBe(true);
    expect(mockRunRepair).toHaveBeenCalledWith(null, undefined, {
      dryRun: true,
      includeWarnings: undefined,
    });
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

  it('sets a non-zero exit code when a repair still fails a check', async () => {
    process.exitCode = 0;
    mockRunRepair.mockResolvedValue({ ok: false, actions: [] });
    mockFormatRepairReport.mockReturnValue('STILL BROKEN\n');

    await route(['repair']);

    expect(process.exitCode).toBe(1);
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
        startsStarship: () => false,
        removeManagedRcBlocks: vi.fn(() => ({ removed: true })),
        removeShellConfigFile: vi.fn(() => ({ removed: true })),
        detectPackageManager: vi.fn().mockResolvedValue('brew'),
        plannedStarshipRemoval: vi.fn(async () => ({ kind: 'absent' as const })),
        removeStarship: vi.fn(),
        forgetStarshipVersion: vi.fn(),
        installedFontFiles: vi.fn().mockResolvedValue([]),
        removeFontFiles: vi.fn(),
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

  it('removes everything once confirmed, records the run and points at --restore', async () => {
    const io = fakeIo();

    await runUninstallCommand(parseCliArgs(['uninstall']), 'uninstall', io);

    expect(io.deps.removeManagedRcBlocks).toHaveBeenCalledWith('zsh');
    expect(io.deps.removeShellConfigFile).toHaveBeenCalledWith('zsh');
    expect(output()).toContain('REMOVED Zsh config');
    expect(output()).toContain('shell-configurator --restore');
    expect(mockRecordRun).toHaveBeenCalledWith({
      kind: 'uninstall',
      command: 'uninstall',
      exitCode: 0,
    });
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
    [['--font', 'none'], /not none/],
    [['--font', 'Comic'], /Unknown Nerd Font/],
    [['--shells', 'tcsh'], /Unknown shell id/],
  ])('rejects %o', async (args, message) => {
    await expect(
      runUninstallCommand(parseCliArgs(['uninstall', ...args]), 'uninstall', fakeIo())
    ).rejects.toThrow(message);
  });

  it('rejects --yes and --starship outside uninstall', async () => {
    await expect(runHeadlessCommand(parseCliArgs(['repair', '--yes']), '')).rejects.toThrow(
      '--yes only applies to uninstall.'
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
