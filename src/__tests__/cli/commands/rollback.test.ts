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

import { runRollbackCommand } from '../../../cli/commands/rollback.ts';
import type { PromptIo } from '../../../cli/prompt.ts';
import { runGlobalFlags, runHeadlessCommand } from '../../../cli/route.ts';
import { parseCliArgs } from '../../../services/args.ts';
import { appendHistory } from '../../../services/history.ts';
import { beginRunCapture, finishRunCapture, runDir } from '../../../services/runCapture.ts';
import { restoreEnv } from '../../helpers/env.ts';

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

    it('warns that later edits come back too, and asks on a terminal', async () => {
      interruptedRun();
      const prompt = io({ confirm: vi.fn().mockResolvedValue(false) });

      await runRollbackCommand(parseCliArgs(['rollback']), 'rollback', prompt);

      expect(output()).toContain('That run was interrupted');
      expect(prompt.confirm).toHaveBeenCalled();
      expect(fs.readFileSync(rc(), 'utf8')).toBe('one');
    });

    it('still warns, but goes ahead without asking, with --yes on a terminal', async () => {
      interruptedRun();
      const prompt = io();

      await runRollbackCommand(parseCliArgs(['rollback', '--yes']), 'rollback', prompt);

      expect(output()).toContain('That run was interrupted');
      expect(prompt.confirm).not.toHaveBeenCalled();
      expect(fs.readFileSync(rc(), 'utf8')).toBe('zero');
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
    [['--include-warnings'], /--include-warnings only applies to doctor --fix/],
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
