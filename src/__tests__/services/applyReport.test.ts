import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockDetectInstalledShells,
  mockDetectPackageManager,
  mockDetectContainer,
  mockDetectTerminal,
  mockFindStarship,
  mockRunInstallTasks,
  mockRecordRun,
} = vi.hoisted(() => ({
  mockFindStarship: vi.fn(
    async (): Promise<{ installed: boolean; pathDir?: string }> => ({
      installed: false,
    })
  ),
  mockDetectInstalledShells: vi.fn(),
  mockDetectPackageManager: vi.fn(),
  mockDetectContainer: vi.fn(),
  mockDetectTerminal: vi.fn(),
  mockRunInstallTasks: vi.fn(),
  mockRecordRun: vi.fn(),
}));

vi.mock('../../services/detector.ts', async () => {
  const actual = await vi.importActual<typeof import('../../services/detector.ts')>(
    '../../services/detector.ts'
  );
  return {
    ...actual,
    detectInstalledShellsAsync: mockDetectInstalledShells,
    detectPackageManagerAsync: mockDetectPackageManager,
    detectContainerAsync: mockDetectContainer,
    detectTerminalAsync: mockDetectTerminal,
    findStarshipAsync: mockFindStarship,
  };
});

vi.mock('../../services/installTasks.ts', async () => {
  const actual = await vi.importActual<typeof import('../../services/installTasks.ts')>(
    '../../services/installTasks.ts'
  );
  return {
    ...actual,
    runInstallTasks: mockRunInstallTasks,
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

import { dryRunPlan } from '../../services/applyReport.ts';
import type { CliFlags } from '../../services/args.ts';
import { CliUsageError } from '../../services/errors.ts';
import { runApply } from '../../services/headless.ts';
import { DEFAULT_STATE } from '../../types.ts';
import { stubPlatform } from '../helpers/platform.ts';

const flags = (partial: Partial<CliFlags>): CliFlags => ({
  subcommand: 'generate',
  help: false,
  version: false,
  ...partial,
});

describe('runApply --dry-run', () => {
  let stdoutWrite: ReturnType<typeof vi.spyOn>;

  const doneTasks = [
    { id: 'starship', label: 'Install Starship', status: 'done' },
    { id: 'config', label: 'Write config files', status: 'done' },
  ];

  let restorePlatform: () => void;
  let scratchHome: string;
  beforeEach(() => {
    restorePlatform = stubPlatform('linux');
    scratchHome = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-configurator-home-'));
    vi.stubEnv('HOME', scratchHome);
    vi.stubEnv('XDG_CONFIG_HOME', undefined);
    vi.stubEnv('XDG_STATE_HOME', undefined);
    vi.stubEnv('ZDOTDIR', undefined);
    vi.clearAllMocks();
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true as never);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true as never);
    mockDetectInstalledShells.mockResolvedValue(['zsh']);
    mockDetectPackageManager.mockResolvedValue('apt');
    mockDetectContainer.mockResolvedValue(false);
    mockDetectTerminal.mockResolvedValue(null);
    mockRecordRun.mockReturnValue(undefined);
    process.exitCode = undefined;
  });

  afterEach(() => {
    restorePlatform();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(scratchHome, { recursive: true, force: true });
  });

  it('prints a plan and runs nothing for --dry-run', async () => {
    mockRunInstallTasks.mockResolvedValue(doneTasks as never);
    await runApply(flags({ subcommand: 'apply', shells: ['bash'], dryRun: true }));

    expect(mockRunInstallTasks).not.toHaveBeenCalled();
    expect(mockRecordRun).not.toHaveBeenCalled();
    const output = stdoutWrite.mock.calls
      .map((call: [string, ...unknown[]]) => String(call[0]))
      .join('');
    expect(output).toContain('dry run');
    expect(output).toContain('Targets: bash');
    expect(output).toContain('Generated starship.toml');
  });

  it('prints the dry-run plan and config as JSON with --json', async () => {
    await runApply(
      flags({
        subcommand: 'apply',
        shells: ['bash'],
        preset: 'pure-prompt',
        dryRun: true,
        json: true,
      })
    );

    expect(mockRunInstallTasks).not.toHaveBeenCalled();
    const output = stdoutWrite.mock.calls
      .map((call: [string, ...unknown[]]) => String(call[0]))
      .join('');
    const plan = JSON.parse(output);
    expect(plan).toMatchObject({ dryRun: true, shells: ['bash'], installStarship: true });
    expect(plan.tasks.map((t: { id: string }) => t.id)).toContain('rc_bash');
    expect(plan.config.kind).toBe('per-shell');
    expect(plan.config.toml).toMatch(/^format\s+= "/m);
  });

  it('describes the kept shared config in an --adopt --dry-run --json plan', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-configurator-'));
    const previous = process.env.HOME;
    process.env.HOME = dir;
    try {
      await runApply(
        flags({ subcommand: 'apply', shells: ['bash'], adopt: true, dryRun: true, json: true })
      );
      const output = stdoutWrite.mock.calls
        .map((call: [string, ...unknown[]]) => String(call[0]))
        .join('');
      expect(JSON.parse(output).config).toEqual({
        kind: 'kept',
        path: path.join(dir, '.config', 'starship.toml'),
        exists: false,
      });
    } finally {
      process.env.HOME = previous;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('diffs the files a dry run would change against disk, as text and JSON', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-configurator-'));
    vi.stubEnv('HOME', dir);
    vi.stubEnv('XDG_CONFIG_HOME', undefined);
    try {
      const bashrc = path.join(dir, '.bashrc');
      fs.writeFileSync(bashrc, 'alias ll="ls -l"\n');
      const output = async (json: boolean) => {
        stdoutWrite.mockClear();
        await runApply(flags({ subcommand: 'apply', shells: ['bash'], dryRun: true, json }));
        return stdoutWrite.mock.calls
          .map((call: [string, ...unknown[]]) => String(call[0]))
          .join('');
      };

      const text = await output(false);
      expect(text).toContain('Changes to config and rc files on disk:');
      expect(text).toContain(
        `create ${path.join(dir, '.config', 'starship', 'bash.toml')}: the config shown above`
      );
      expect(text).not.toContain('--- /dev/null');
      expect(text).toContain(
        'for the first time as <file>.pre-shell-configurator, and writes WHAT-CHANGED.md'
      );
      expect(text).toContain(`--- ${bashrc}\n+++ ${bashrc}\n@@ -1,1 +1,`);
      expect(text).toContain(' alias ll="ls -l"\n+\n+# Added by ShellConfigurator\n');

      const plan = JSON.parse(await output(true));
      expect(plan.changes.map((c: { path: string; status: string }) => [c.path, c.status])).toEqual(
        [
          [path.join(dir, '.config', 'starship', 'bash.toml'), 'create'],
          [bashrc, 'modify'],
        ]
      );
      expect(fs.readFileSync(bashrc, 'utf8')).toBe('alias ll="ls -l"\n');
      expect(fs.existsSync(path.join(dir, '.config'))).toBe(false);
    } finally {
      vi.unstubAllEnvs();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('diffs an existing per-shell config instead of only pointing at the config above', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-configurator-'));
    vi.stubEnv('HOME', dir);
    vi.stubEnv('XDG_CONFIG_HOME', undefined);
    try {
      const config = path.join(dir, '.config', 'starship', 'bash.toml');
      fs.mkdirSync(path.dirname(config), { recursive: true });
      fs.writeFileSync(config, 'add_newline = false\n');
      await runApply(flags({ subcommand: 'apply', shells: ['bash'], dryRun: true }));
      const text = stdoutWrite.mock.calls
        .map((call: [string, ...unknown[]]) => String(call[0]))
        .join('');
      expect(text).toContain(`--- ${config}\n+++ ${config}\n`);
      expect(text).toContain('-add_newline = false');
    } finally {
      vi.unstubAllEnvs();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('shows the config a failed font install would write instead', async () => {
    const output = async (json: boolean) => {
      stdoutWrite.mockClear();
      await runApply(
        flags({ subcommand: 'apply', shells: ['bash'], font: 'JetBrainsMono', dryRun: true, json })
      );
      return stdoutWrite.mock.calls.map((call: [string, ...unknown[]]) => String(call[0])).join('');
    };
    expect(await output(false)).toContain(
      'If the Nerd Font install fails, the config is written without Nerd Font glyphs instead.'
    );
    const config = JSON.parse(await output(true)).config;
    expect(config.tomlIfFontFails).toEqual(expect.any(String));
    expect(config.tomlIfFontFails).not.toBe(config.toml);
  });

  it('says no file would change when the setup is already in place', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-configurator-'));
    vi.stubEnv('HOME', dir);
    vi.stubEnv('XDG_CONFIG_HOME', undefined);
    try {
      fs.writeFileSync(path.join(dir, '.bashrc'), 'eval "$(starship init bash)"\n');
      mockDetectPackageManager.mockResolvedValue('brew');
      await runApply(flags({ subcommand: 'apply', shells: ['bash'], adopt: true, dryRun: true }));
      const output = stdoutWrite.mock.calls
        .map((call: [string, ...unknown[]]) => String(call[0]))
        .join('');
      expect(output).toContain('No config or rc file on disk would change.');
    } finally {
      vi.unstubAllEnvs();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses --json on a real apply', async () => {
    await expect(
      runApply(flags({ subcommand: 'apply', shells: ['bash'], json: true }))
    ).rejects.toThrow(/apply --json only prints a plan, with --dry-run/);
    expect(mockRunInstallTasks).not.toHaveBeenCalled();
  });

  it('says plainly when --adopt --dry-run finds no config to keep', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-configurator-'));
    const previous = process.env.HOME;
    process.env.HOME = dir;
    fs.mkdirSync(path.join(dir, '.config'));
    try {
      await runApply(flags({ subcommand: 'apply', shells: ['bash'], adopt: true, dryRun: true }));
      const output = stdoutWrite.mock.calls
        .map((call: [string, ...unknown[]]) => String(call[0]))
        .join('');
      expect(output).toContain('No config to keep yet');
      expect(output).toContain(path.join(dir, '.config', 'starship.toml'));
    } finally {
      process.env.HOME = previous;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('names the config --adopt --dry-run would keep', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-configurator-'));
    const previous = process.env.HOME;
    process.env.HOME = dir;
    fs.mkdirSync(path.join(dir, '.config'));
    fs.writeFileSync(path.join(dir, '.config', 'starship.toml'), 'format = "x"\n');
    try {
      await runApply(flags({ subcommand: 'apply', shells: ['bash'], adopt: true, dryRun: true }));
      const output = stdoutWrite.mock.calls
        .map((call: [string, ...unknown[]]) => String(call[0]))
        .join('');
      expect(output).toContain(`Config to keep: ${path.join(dir, '.config', 'starship.toml')}`);
    } finally {
      process.env.HOME = previous;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a dry run with no shells, as the real run does', async () => {
    await expect(runApply(flags({ subcommand: 'apply', dryRun: true }))).rejects.toThrow(
      new CliUsageError(
        'apply configures at least one shell, but none are selected. Pass --shells <id,...> or a --state card that selects shells.'
      )
    );
  });

  it("says the terminal font step's own config edit is not in the diff", async () => {
    mockDetectTerminal.mockResolvedValue('ghostty');

    await runApply(flags({ subcommand: 'apply', shells: ['zsh'], dryRun: true, font: 'FiraCode' }));

    const output = stdoutWrite.mock.calls
      .map((call: [string, ...unknown[]]) => String(call[0]))
      .join('');
    expect(output).toContain("terminal font step edits the terminal's own config");
  });
});

describe('dryRunPlan', () => {
  it('labels an empty imported config as imported, since the run writes it', () => {
    const plan = dryRunPlan(
      { ...DEFAULT_STATE, keepExistingConfig: true, sharedConfigToml: '' },
      [],
      []
    );
    expect(plan.config).toMatchObject({ kind: 'imported', toml: '' });
  });
});
