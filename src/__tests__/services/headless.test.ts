import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CapturedRunError, captureRun, trackedFiles } from '../../services/runCapture.ts';
import { whatChangedPath, writeWhatChangedSafely } from '../../services/whatChanged.ts';

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

import { getShell } from '../../config/shells.ts';
import type { CliFlags } from '../../services/args.ts';
import { CliRunError, CliUsageError } from '../../services/errors.ts';
import { runApply, runGenerate } from '../../services/headless.ts';
import { NERD_FONTS } from '../../services/installer.ts';
import { DEFAULT_INSTALL_TASK_DEPS } from '../../services/installTasks.ts';
import { STATE_VERSION, serializeState } from '../../services/state.ts';
import { DEFAULT_STATE, type WizardState } from '../../types.ts';
import { stubPlatform } from '../helpers/platform.ts';

const flags = (partial: Partial<CliFlags>): CliFlags => ({
  subcommand: 'generate',
  help: false,
  version: false,
  ...partial,
});

function writeFixtureCard(dir: string, state: Partial<WizardState> = {}): string {
  const file = path.join(dir, 'card.json');
  fs.writeFileSync(file, serializeState({ ...DEFAULT_STATE, ...state }));
  return file;
}

describe('runGenerate', () => {
  let stdoutWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects an adopt-mode state card', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-configurator-'));
    try {
      const card = writeFixtureCard(dir, { keepExistingConfig: true });
      expect(() => runGenerate(flags({ stateFile: card }))).toThrow(CliUsageError);
      expect(() => runGenerate(flags({ stateFile: card }))).toThrow(/adopt-mode/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects --adopt on the generate subcommand', () => {
    expect(() => runGenerate(flags({ adopt: true }))).toThrow(/apply subcommand/);
  });

  it('rejects --import-url on the generate subcommand', () => {
    expect(() => runGenerate(flags({ importUrl: 'https://example.com/starship.toml' }))).toThrow(
      /apply subcommand/
    );
  });

  it('writes the generated TOML to stdout by default', () => {
    runGenerate(flags({ preset: 'pure-prompt' }));
    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('format'));
  });

  it('-o writes the TOML to a file and stays silent on stdout', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-configurator-'));
    try {
      const out = path.join(dir, 'starship.toml');
      runGenerate(flags({ preset: 'pure-prompt', outputFile: out }));
      expect(fs.existsSync(out)).toBe(true);
      expect(fs.readFileSync(out, 'utf8')).toContain('format');
      expect(stdoutWrite).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--export writes the versioned state card instead of TOML', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-configurator-'));
    try {
      const out = path.join(dir, 'card.json');
      runGenerate(flags({ preset: 'catppuccin-powerline', exportFile: out }));
      const card = JSON.parse(fs.readFileSync(out, 'utf8')) as {
        version: number;
        wizard: WizardState;
      };
      expect(card.version).toBe(STATE_VERSION);
      expect(card.wizard.palette).toBe('catppuccin');
      expect(card.wizard.powerline).toBe(true);
      expect(stdoutWrite).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--export and -o both write when given together', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-configurator-'));
    try {
      const card = path.join(dir, 'card.json');
      const out = path.join(dir, 'starship.toml');
      runGenerate(flags({ preset: 'pure-prompt', exportFile: card, outputFile: out }));

      expect(JSON.parse(fs.readFileSync(card, 'utf8'))).toMatchObject({ version: 1 });
      expect(fs.readFileSync(out, 'utf8')).toContain('format');
      expect(stdoutWrite).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('still writes -o under --dry-run, since generate installs nothing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-configurator-'));
    try {
      const out = path.join(dir, 'out.toml');
      runGenerate(flags({ preset: 'pure-prompt', outputFile: out, dryRun: true }));
      expect(fs.readFileSync(out, 'utf8')).toContain('$character');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps the card it wrote when the TOML write then fails', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-configurator-'));
    try {
      const card = path.join(dir, 'card.json');
      const out = path.join(dir, 'missing-dir', 'out.toml');
      expect(() =>
        runGenerate(flags({ preset: 'pure-prompt', exportFile: card, outputFile: out }))
      ).toThrow(/Could not write TOML/);
      expect(JSON.parse(fs.readFileSync(card, 'utf8')).version).toBe(STATE_VERSION);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects writing the card and the TOML to the same file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-configurator-'));
    try {
      const out = path.join(dir, 'starship.toml');
      expect(() =>
        runGenerate(flags({ preset: 'pure-prompt', exportFile: out, outputFile: out }))
      ).toThrow(CliUsageError);
      expect(fs.existsSync(out)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('leaves no temp file behind when the atomic write fails', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-configurator-'));
    try {
      const out = path.join(dir, 'starship.toml');
      fs.mkdirSync(out);
      expect(() => runGenerate(flags({ preset: 'pure-prompt', outputFile: out }))).toThrow(
        CliRunError
      );
      expect(fs.readdirSync(dir)).toEqual(['starship.toml']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports an unwritable -o path as a run failure', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-configurator-'));
    try {
      const out = path.join(dir, 'missing-dir', 'starship.toml');
      expect(() => runGenerate(flags({ preset: 'pure-prompt', outputFile: out }))).toThrow(
        CliRunError
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports an unwritable --export path as a run failure', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-configurator-'));
    try {
      const out = path.join(dir, 'missing-dir', 'card.json');
      expect(() => runGenerate(flags({ preset: 'pure-prompt', exportFile: out }))).toThrow(
        CliRunError
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('runApply', () => {
  let stdoutWrite: ReturnType<typeof vi.spyOn>;
  let stderrWrite: ReturnType<typeof vi.spyOn>;

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
    stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as never);
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

  it('refuses a real run with no shells selected', async () => {
    await expect(runApply(flags({ subcommand: 'apply' }))).rejects.toThrow(/none are selected/);
    expect(mockRunInstallTasks).not.toHaveBeenCalled();
  });

  it('runs the install pipeline and records a successful run in history', async () => {
    mockRunInstallTasks.mockResolvedValue(doneTasks as never);
    const files = [{ path: '/h/.zshrc', before: '0', after: 'x' }];
    vi.mocked(captureRun).mockImplementationOnce(async (captured, run, options) => {
      expect(captured).toEqual([...trackedFiles(), whatChangedPath()]);
      expect(options?.rewritable).toEqual([whatChangedPath()]);
      const result = await run(false);
      options?.onChanged?.('run-3', files, undefined);
      return { result, runId: 'run-3', uncaptured: false };
    });
    await runApply(flags({ subcommand: 'apply', shells: ['zsh'] }), 'apply --shells zsh');

    expect(mockRunInstallTasks).toHaveBeenCalled();
    expect(mockRecordRun).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'apply',
        state: expect.objectContaining({ selectedShells: ['zsh'] }),
        command: 'apply --shells zsh',
        results: doneTasks,
        exitCode: 0,
        runId: 'run-3',
      })
    );
    expect(process.exitCode).toBeUndefined();
    const output = stdoutWrite.mock.calls
      .map((call: [string, ...unknown[]]) => String(call[0]))
      .join('');
    expect(output).toContain('Install Starship');
    expect(writeWhatChangedSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'apply',
        command: 'apply --shells zsh',
        results: doneTasks,
        runId: 'run-3',
        files,
      })
    );
  });

  it('writes no summary for a run that changed nothing', async () => {
    mockRunInstallTasks.mockResolvedValue(doneTasks as never);
    vi.mocked(writeWhatChangedSafely).mockClear();
    await runApply(flags({ subcommand: 'apply', shells: ['zsh'] }));
    expect(writeWhatChangedSafely).not.toHaveBeenCalled();
  });

  it('still writes the summary of a run that broke partway, with its unfinished tasks failed', async () => {
    const failure = new Error('chain broke');
    mockRunInstallTasks.mockImplementationOnce(
      async (_state: unknown, _deps: unknown, onUpdate: (id: string, patch: object) => void) => {
        onUpdate('starship', { status: 'done' });
        throw failure;
      }
    );
    vi.mocked(captureRun).mockImplementationOnce(async (_files, run, options) => {
      try {
        return { result: await run(false), runId: 'run-4', uncaptured: false };
      } catch (err) {
        options?.onChanged?.('run-4', [], err);
        throw new CapturedRunError('run-4', err);
      }
    });
    vi.mocked(writeWhatChangedSafely).mockReturnValueOnce('/h/.config/starship/WHAT-CHANGED.md');

    await expect(runApply(flags({ subcommand: 'apply', shells: ['zsh'] }))).rejects.toBe(failure);

    const results = vi.mocked(writeWhatChangedSafely).mock.lastCall![0].results;
    expect(results.find((task) => task.id === 'starship')?.status).toBe('done');
    expect(results.find((task) => task.id === 'rc_zsh')).toMatchObject({
      status: 'failed',
      error: 'chain broke',
    });
    expect(stdoutWrite).toHaveBeenCalledWith(
      'What changed, and how to undo it: /h/.config/starship/WHAT-CHANGED.md\n'
    );
  });

  it('prints where the summary of what changed was written', async () => {
    mockRunInstallTasks.mockResolvedValue(doneTasks as never);
    vi.mocked(captureRun).mockImplementationOnce(async (_files, run, options) => {
      const result = await run(false);
      options?.onChanged?.('run-5', [], undefined);
      return { result, runId: 'run-5', uncaptured: false };
    });
    vi.mocked(writeWhatChangedSafely).mockReturnValueOnce('/h/.config/starship/WHAT-CHANGED.md');

    await runApply(flags({ subcommand: 'apply', shells: ['zsh'] }));

    expect(stdoutWrite).toHaveBeenCalledWith(
      '\nWhat changed, and how to undo it: /h/.config/starship/WHAT-CHANGED.md\n'
    );
  });

  it('records the files a crashing run changed, then rethrows its error', async () => {
    const failure = new Error('chain broke');
    vi.mocked(captureRun).mockRejectedValueOnce(new CapturedRunError('run-8', failure));

    await expect(
      runApply(flags({ subcommand: 'apply', shells: ['zsh'] }), 'apply --shells zsh')
    ).rejects.toBe(failure);
    expect(mockRecordRun).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'apply', exitCode: 1, runId: 'run-8' })
    );
  });

  it('sets exit code 1 and records it when a task fails', async () => {
    const failedTasks = [
      { id: 'starship', label: 'Install Starship', status: 'failed', error: 'boom' },
    ];
    mockRunInstallTasks.mockResolvedValue(failedTasks as never);
    await runApply(flags({ subcommand: 'apply', shells: ['zsh'] }));

    expect(mockRecordRun).toHaveBeenCalledWith(expect.objectContaining({ exitCode: 1 }));
    expect(process.exitCode).toBe(1);
    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Install Starship'));
  });

  it('refuses a real run with no target shells before installing anything', async () => {
    await expect(runApply(flags({ subcommand: 'apply' }))).rejects.toThrow(/at least one shell/);

    expect(mockRunInstallTasks).not.toHaveBeenCalled();
    expect(mockRecordRun).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it('refuses to apply an exported card that selects no shells', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-configurator-'));
    try {
      const card = path.join(dir, 'card.json');
      fs.writeFileSync(card, serializeState({ ...DEFAULT_STATE, selectedShells: [] }));
      await expect(runApply(flags({ subcommand: 'apply', stateFile: card }))).rejects.toThrow(
        /at least one shell/
      );

      expect(mockRunInstallTasks).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prints the setup command of a shell set up by hand', async () => {
    mockRunInstallTasks.mockResolvedValue([
      {
        id: 'rc_nushell',
        label: 'Configure nushell',
        status: 'skipped',
        note: getShell('nushell')!.manualNote,
      },
    ] as never);

    await runApply(flags({ subcommand: 'apply', shells: ['nushell'] }));

    const output = stdoutWrite.mock.calls
      .map((call: [string, ...unknown[]]) => String(call[0]))
      .join('');
    expect(output).toContain('Nushell is set up by hand.');
    expect(output).toContain(`  ${getShell('nushell')!.initLine}\n`);
  });

  it.each([
    [{ installed: true }, 'Starship is already installed'],
    [{ installed: true, pathDir: '/home/u/.local/bin' }, 'Starship is already installed'],
    [{ installed: false }, 'will install Starship'],
  ])('says what detection found about Starship (%o)', async (found, text) => {
    mockFindStarship.mockResolvedValueOnce(found);

    await runApply(flags({ subcommand: 'apply', shells: ['zsh'], dryRun: true }));

    const output = stdoutWrite.mock.calls
      .map((call: [string, ...unknown[]]) => String(call[0]))
      .join('');
    expect(output).toContain(text);
  });

  it('survives a history write failure', async () => {
    mockRunInstallTasks.mockResolvedValue(doneTasks as never);
    mockRecordRun.mockImplementation(() => {
      throw new Error('ENOSPC');
    });
    await runApply(flags({ subcommand: 'apply', shells: ['zsh'] }));

    expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('could not record this run'));
    expect(process.exitCode).toBeUndefined();
  });

  it('marks the run as running in a container when detected', async () => {
    const fakeTask = { id: 'config', label: 'Write config files', status: 'done' };
    mockRunInstallTasks.mockResolvedValue([fakeTask] as never);
    mockDetectContainer.mockResolvedValue(true);

    await runApply(flags({ subcommand: 'apply', shells: ['zsh'] }));

    expect(mockRunInstallTasks).toHaveBeenCalledWith(
      expect.objectContaining({ container: true }),
      DEFAULT_INSTALL_TASK_DEPS,
      expect.any(Function),
      expect.any(AbortSignal)
    );
  });

  it('detects the terminal so a headless apply wires the font', async () => {
    const fakeTask = { id: 'terminal', label: 'Set kitty font', status: 'done' };
    mockRunInstallTasks.mockResolvedValue([fakeTask] as never);
    mockDetectTerminal.mockResolvedValue('kitty');

    await runApply(flags({ subcommand: 'apply', shells: ['zsh'], font: 'JetBrainsMono' }));

    expect(mockDetectTerminal).toHaveBeenCalled();
    expect(mockRunInstallTasks).toHaveBeenCalledWith(
      expect.objectContaining({ terminal: 'kitty' }),
      DEFAULT_INSTALL_TASK_DEPS,
      expect.any(Function),
      expect.any(AbortSignal)
    );
  });

  it('passes a null terminal through when none is detected', async () => {
    const fakeTask = { id: 'config', label: 'Write config files', status: 'done' };
    mockRunInstallTasks.mockResolvedValue([fakeTask] as never);

    await runApply(flags({ subcommand: 'apply', shells: ['zsh'] }));

    expect(mockRunInstallTasks).toHaveBeenCalledWith(
      expect.objectContaining({ terminal: null }),
      DEFAULT_INSTALL_TASK_DEPS,
      expect.any(Function),
      expect.any(AbortSignal)
    );
  });

  it('stops a Nerd Font preset without font flags instead of installing a font', async () => {
    await expect(
      runApply(flags({ subcommand: 'apply', preset: 'tokyo-night', shells: ['zsh'] }))
    ).rejects.toThrow(
      new CliUsageError(
        `The tokyo-night preset draws Nerd Font icons. Pass --font <id> to install a Nerd Font (${NERD_FONTS.map((font) => font.id).join(', ')}), --has-nerd-font when the terminal already shows them, or --no-nerd-font for a version without icons.`
      )
    );
    expect(mockRunInstallTasks).not.toHaveBeenCalled();
  });

  it.each([
    [{ hasNerdFont: true }, { kind: 'none' }],
    [{ font: 'FiraCode' }, { kind: 'install', id: 'FiraCode' }],
  ])('runs a Nerd Font preset once %o says how to show its icons', async (extra, font) => {
    mockRunInstallTasks.mockResolvedValue([] as never);

    await runApply(
      flags({ subcommand: 'apply', preset: 'tokyo-night', shells: ['zsh'], ...extra })
    );

    expect(mockRunInstallTasks).toHaveBeenCalledWith(
      expect.objectContaining({ nerdFontToInstall: font }),
      DEFAULT_INSTALL_TASK_DEPS,
      expect.any(Function),
      expect.any(AbortSignal)
    );
  });

  it('cancels the steps on Ctrl+C, then records the run and exits like a signal', async () => {
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as never);
    const listeners = process.listenerCount('SIGINT');
    mockRunInstallTasks.mockImplementationOnce(async (_state, _deps, _onUpdate, signal) => {
      process.emit('SIGINT');
      expect(signal?.aborted).toBe(true);
      return [{ id: 'config', label: 'Write config files', status: 'failed' }] as never;
    });

    await runApply(flags({ subcommand: 'apply', shells: ['zsh'] }), 'apply --shells zsh');

    expect(process.exitCode).toBe(130);
    expect(mockRecordRun).toHaveBeenCalledWith(expect.objectContaining({ exitCode: 130 }));
    expect(process.listenerCount('SIGINT')).toBe(listeners);
    expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('Cancelling'));
    stderrWrite.mockRestore();
    process.exitCode = undefined;
  });

  it('adopts the existing shared config when --adopt is passed without --import-url', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-configurator-'));
    const previous = process.env.HOME;
    process.env.HOME = dir;
    fs.mkdirSync(path.join(dir, '.config'));
    try {
      await runApply(flags({ subcommand: 'apply', shells: ['zsh'], adopt: true, dryRun: true }));
      const output = stdoutWrite.mock.calls
        .map((call: [string, ...unknown[]]) => String(call[0]))
        .join('');
      expect(output).toContain('No config to keep yet');
      expect(output).not.toContain('Generated starship.toml');
    } finally {
      process.env.HOME = previous;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
