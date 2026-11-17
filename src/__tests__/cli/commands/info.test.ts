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

import { runCompletionsCommand, runDebugInfoCommand } from '../../../cli/commands/info.ts';
import { routeCli, runGlobalFlags, runHeadlessCommand } from '../../../cli/route.ts';
import { parseCliArgs } from '../../../services/args.ts';
import { completionScript } from '../../../services/completions.ts';
import type { DebugInfoDeps } from '../../../services/debugInfo.ts';
import { formatListing, listEntries } from '../../../services/listings.ts';
import { homeDir } from '../../../services/paths.ts';

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
      /--include-warnings only applies to doctor --fix/,
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

  it.each(['presets', 'modules', 'fonts'] as const)('list %s prints the %s', async (kind) => {
    expect((await routeCli(['list', kind])).handled).toBe(true);
    expect(output()).toBe(formatListing(listEntries(kind)));
  });

  it('prints the data as JSON with --json', async () => {
    await routeCli(['list', 'fonts', '--json']);
    expect(JSON.parse(output())).toEqual(listEntries('fonts'));
  });

  it('rejects any other flag than --json', async () => {
    await expect(routeCli(['list', 'presets', '--shells', 'bash', '--dry-run'])).rejects.toThrow(
      '--shells, --dry-run cannot be used with list.'
    );
  });

  it('needs to know what to list, from a fixed set', async () => {
    await expect(routeCli(['list'])).rejects.toThrow(
      'list needs what to list: presets, modules, fonts.'
    );
    await expect(routeCli(['list', 'shells'])).rejects.toThrow(
      "Cannot list 'shells' (available: presets, modules, fonts)."
    );
  });

  it('points the retired list flags at list', () => {
    expect(() => parseCliArgs(['--list-presets'])).toThrow(
      '--list-presets is gone: run shell-configurator list presets.'
    );
  });

  it('documents list in the help text', () => {
    runGlobalFlags(parseCliArgs(['--help']));
    expect(output()).toContain('shell-configurator list <presets|modules|fonts>');
    expect(output()).not.toContain('--list-presets');
  });
});
