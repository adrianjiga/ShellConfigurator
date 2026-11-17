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

import { runDoctorCommand } from '../../../cli/commands/doctor.ts';
import { runMarkdownCommand } from '../../../cli/commands/generate.ts';
import { runGlobalFlags, runHeadlessCommand } from '../../../cli/route.ts';
import { parseCliArgs } from '../../../services/args.ts';
import { serializeState } from '../../../services/state.ts';
import { DEFAULT_STATE } from '../../../types.ts';

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

describe('index doctor --timings', () => {
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
  const doctor = (args: string[], probe = deps()) =>
    runDoctorCommand(parseCliArgs(['doctor', '--timings', ...args]), '', undefined, probe);

  beforeEach(() => {
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true as never);
    mockRunDoctor.mockClear();
    mockRunDoctor.mockResolvedValue({ ok: true, findings: [] });
    mockFormatDoctorReport.mockReturnValue('HEALTHY\n');
  });
  afterEach(() => {
    stdoutWrite.mockRestore();
    process.exitCode = 0;
  });

  it('times the config Starship loads here after the check, with suggestions', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shellconf-active-'));
    const config = path.join(dir, 'zsh.toml');
    fs.writeFileSync(config, 'format = "$git_status$character"\n');
    vi.stubEnv('STARSHIP_CONFIG', config);
    try {
      const probe = deps();
      await doctor([], probe);
      expect(output()).toMatch(/^HEALTHY\n/);
      expect(output()).toContain(`(config: ${config})`);
      expect(output()).toMatch(/git_status\s+320ms {2}slow/);
      expect(output()).toContain('git_status took 320ms');
      expect(probe.run).toHaveBeenCalledWith('timings', process.cwd(), config);
      expect(process.exitCode ?? 0).toBe(0);
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
      await doctor([], probe);
      expect(output()).toContain(
        "(config: Starship's built-in default prompt, since $STARSHIP_CONFIG (/no/such/starship.toml) does not exist)"
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('times the file --config names, inside the doctor JSON with --json', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shellconf-timings-'));
    const config = path.join(dir, 'starship.toml');
    fs.writeFileSync(config, 'format = "$git_status$character"\n');
    try {
      await doctor(['--config', config, '--json']);
      expect(JSON.parse(output())).toMatchObject({
        ok: true,
        timings: { config, slowestMs: 320, slow: true },
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a --config file it cannot read before running any check', async () => {
    await expect(doctor(['--config', '/no/such/file'])).rejects.toThrow(
      /Could not read '\/no\/such\/file'/
    );
    expect(mockRunDoctor).not.toHaveBeenCalled();
  });

  it('still prints the check, and fails, when Starship is not installed to time with', async () => {
    await doctor([], deps(false));
    expect(output()).toMatch(/^HEALTHY\n/);
    expect(output()).toMatch(/Could not time the prompt: .*Starship is not installed/);
    expect(process.exitCode).toBe(1);
  });

  it.each([
    [['doctor', '--config', 'x'], '--config only applies to doctor --timings.'],
    [['generate', '--timings'], '--timings only applies to doctor.'],
    [['doctor', '--timings', '--fix'], '--timings cannot be used with --fix.'],
    [
      ['doctor', '--timings', '--state', 'card.json', '--preset', 'pure-prompt'],
      '--timings times the config Starship loads here (or --config <file>), so --state, --preset cannot be used with it.',
    ],
  ])('rejects %o', async (args, message) => {
    await expect(runHeadlessCommand(parseCliArgs(args), '')).rejects.toThrow(message);
  });

  it('points the retired timings at doctor --timings', () => {
    expect(() => parseCliArgs(['timings'])).toThrow(
      'timings is gone: shell-configurator doctor --timings times the prompt in this folder.'
    );
  });

  it('documents --timings in the help text', () => {
    runGlobalFlags(parseCliArgs(['--help']));
    expect(output()).toContain('--timings');
    expect(output()).toContain('--config <file>');
    expect(output()).not.toContain('shell-configurator timings');
  });

  it('refuses an adopt-mode card for --markdown and points at the shared config', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shellconf-adopt-'));
    const card = path.join(dir, 'card.json');
    fs.writeFileSync(card, serializeState({ ...DEFAULT_STATE, keepExistingConfig: true }));
    try {
      expect(() =>
        runMarkdownCommand(parseCliArgs(['generate', '--markdown', '--state', card]))
      ).toThrow(/adopt-mode card keeps your own config, so there is no generated prompt to share/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
