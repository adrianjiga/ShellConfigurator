import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockDetectInstalledShells,
  mockDetectPackageManager,
  mockRunInstallTasks,
  mockAppendHistory,
} = vi.hoisted(() => ({
  mockDetectInstalledShells: vi.fn(),
  mockDetectPackageManager: vi.fn(),
  mockRunInstallTasks: vi.fn(),
  mockAppendHistory: vi.fn(),
}));

vi.mock('../../services/detector.ts', async () => {
  const actual = await vi.importActual<typeof import('../../services/detector.ts')>(
    '../../services/detector.ts'
  );
  return {
    ...actual,
    detectInstalledShellsAsync: mockDetectInstalledShells,
    detectPackageManagerAsync: mockDetectPackageManager,
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

vi.mock('../../services/history.ts', () => ({
  appendHistory: mockAppendHistory,
}));

import type { CliFlags } from '../../services/args.ts';
import { runApply, runGenerate, stateFromFlags } from '../../services/headless.ts';
import { STATE_VERSION, serializeState } from '../../services/state.ts';
import { DEFAULT_STATE, type WizardState } from '../../types.ts';

const flags = (partial: Partial<CliFlags>): CliFlags => ({
  subcommand: 'generate',
  help: false,
  version: false,
  restore: false,
  ...partial,
});

function writeFixtureCard(dir: string, state: Partial<WizardState> = {}): string {
  const file = path.join(dir, 'card.json');
  fs.writeFileSync(file, serializeState({ ...DEFAULT_STATE, ...state }));
  return file;
}

describe('stateFromFlags', () => {
  it('returns the wizard defaults for an empty set of flags', () => {
    const state = stateFromFlags(flags({}));
    expect(state.leftModules).toContain('directory');
    expect(state.selectedShells).toEqual([]);
    expect(state.nerdFontToInstall).toEqual({ kind: 'none' });
    expect(state.hasNerdFont).toBe(false);
    expect(state.powerline).toBe(false);
  });

  it('seeds modules, palette and powerline from a preset', () => {
    const state = stateFromFlags(flags({ preset: 'pastel-powerline' }));
    expect(state.palette).toBe('pastel');
    expect(state.powerline).toBe(true);
    expect(state.leftModules).toContain('username');
    expect(state.rightModules).toContain('time');
  });

  it('lets explicit flags override the preset', () => {
    const state = stateFromFlags(
      flags({ preset: 'pastel-powerline', palette: 'tokyo-night', powerline: false })
    );
    expect(state.palette).toBe('tokyo-night');
    expect(state.powerline).toBe(false);
  });

  it('filters unknown shell ids from --shells', () => {
    const state = stateFromFlags(flags({ shells: ['zsh', 'csh', 'fish'] }));
    expect(state.selectedShells).toEqual(['zsh', 'fish']);
  });

  it('maps --font to an install and infers hasNerdFont', () => {
    const state = stateFromFlags(flags({ font: 'JetBrainsMono' }));
    expect(state.nerdFontToInstall).toEqual({ kind: 'install', id: 'JetBrainsMono' });
    expect(state.hasNerdFont).toBe(true);
  });

  it('maps --font none to no font', () => {
    const state = stateFromFlags(flags({ font: 'none' }));
    expect(state.nerdFontToInstall).toEqual({ kind: 'none' });
    expect(state.hasNerdFont).toBe(false);
  });

  it('--no-nerd-font beats the --font inference', () => {
    const state = stateFromFlags(flags({ font: 'Meslo', hasNerdFont: false }));
    expect(state.nerdFontToInstall).toEqual({ kind: 'install', id: 'Meslo' });
    expect(state.hasNerdFont).toBe(false);
  });

  it('applies the remaining scalar flags', () => {
    const state = stateFromFlags(
      flags({ characterSymbol: 'lambda', setDefaultShell: 'zsh', skipStarship: true })
    );
    expect(state.characterSymbol).toBe('lambda');
    expect(state.setDefaultShell).toBe('zsh');
    expect(state.skipStarshipInstall).toBe(true);
  });

  it('reads a state card with --import and layers flags on top', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-configurator-'));
    try {
      const card = writeFixtureCard(dir, { palette: 'gruvbox', selectedShells: ['bash'] });
      const state = stateFromFlags(flags({ stateFile: card, palette: 'vivid', powerline: true }));
      expect(state.palette).toBe('vivid');
      expect(state.powerline).toBe(true);
      expect(state.selectedShells).toEqual(['bash']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('runGenerate', () => {
  let stdoutWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
});

describe('runApply', () => {
  let stdoutWrite: ReturnType<typeof vi.spyOn>;
  let stderrWrite: ReturnType<typeof vi.spyOn>;

  const doneTasks = [
    { id: 'starship', label: 'Install Starship', status: 'done' },
    { id: 'config', label: 'Write config files', status: 'done' },
  ];

  beforeEach(() => {
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true as never);
    stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as never);
    mockDetectInstalledShells.mockResolvedValue(['zsh']);
    mockDetectPackageManager.mockResolvedValue('apt');
    mockAppendHistory.mockReturnValue(undefined);
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints a plan and runs nothing for --dry-run', async () => {
    mockRunInstallTasks.mockResolvedValue(doneTasks as never);
    await runApply(flags({ subcommand: 'apply', shells: ['bash'], dryRun: true }));

    expect(mockRunInstallTasks).not.toHaveBeenCalled();
    expect(mockAppendHistory).not.toHaveBeenCalled();
    const output = stdoutWrite.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('dry run');
    expect(output).toContain('Targets: bash');
    expect(output).toContain('Generated starship.toml');
  });

  it('runs the install pipeline and records a successful run in history', async () => {
    mockRunInstallTasks.mockResolvedValue(doneTasks as never);
    await runApply(flags({ subcommand: 'apply', shells: ['zsh'] }));

    expect(mockRunInstallTasks).toHaveBeenCalled();
    expect(mockAppendHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'apply',
        results: doneTasks,
        exitCode: 0,
      })
    );
    expect(process.exitCode).toBeUndefined();
    const output = stdoutWrite.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('Install Starship');
  });

  it('sets exit code 1 and records it when a task fails', async () => {
    const failedTasks = [
      { id: 'starship', label: 'Install Starship', status: 'failed', error: 'boom' },
    ];
    mockRunInstallTasks.mockResolvedValue(failedTasks as never);
    await runApply(flags({ subcommand: 'apply' }));

    expect(mockAppendHistory).toHaveBeenCalledWith(expect.objectContaining({ exitCode: 1 }));
    expect(process.exitCode).toBe(1);
    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Install Starship'));
  });

  it('survives a history write failure', async () => {
    mockRunInstallTasks.mockResolvedValue(doneTasks as never);
    mockAppendHistory.mockImplementation(() => {
      throw new Error('ENOSPC');
    });
    await runApply(flags({ subcommand: 'apply', shells: ['zsh'] }));

    expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('could not record this run'));
    expect(process.exitCode).toBeUndefined();
  });
});
