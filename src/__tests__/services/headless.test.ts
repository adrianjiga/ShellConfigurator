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

import type { ModuleId } from '../../config/modules.ts';
import type { CliFlags } from '../../services/args.ts';
import { CliUsageError } from '../../services/errors.ts';
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

  it('infers hasNerdFont from a preset that needs one', () => {
    expect(stateFromFlags(flags({ preset: 'pastel-powerline' })).hasNerdFont).toBe(true);
    expect(stateFromFlags(flags({ preset: 'pure-prompt' })).hasNerdFont).toBe(false);
  });

  it('lets an explicit --no-nerd-font beat the preset inference', () => {
    const state = stateFromFlags(flags({ preset: 'pastel-powerline', hasNerdFont: false }));
    expect(state.hasNerdFont).toBe(false);
    expect(state.powerline).toBe(true);
  });

  it('lets a --font install imply hasNerdFont after a plain preset', () => {
    const state = stateFromFlags(flags({ preset: 'pure-prompt', font: 'FiraCode' }));
    expect(state.hasNerdFont).toBe(true);
    expect(state.nerdFontToInstall).toEqual({ kind: 'install', id: 'FiraCode' });
  });

  it('lets explicit flags override the preset', () => {
    const state = stateFromFlags(
      flags({ preset: 'pastel-powerline', palette: 'tokyo-night', powerline: false })
    );
    expect(state.palette).toBe('tokyo-night');
    expect(state.powerline).toBe(false);
  });

  it('throws CliUsageError for an unknown shell id', () => {
    expect(() => stateFromFlags(flags({ shells: ['zsh', 'csh'] }))).toThrow(/csh/);
  });

  it('throws CliUsageError for an unknown preset', () => {
    expect(() => stateFromFlags(flags({ preset: 'nonexistent' }))).toThrow(/preset/);
  });

  it('throws CliUsageError for an unknown palette', () => {
    expect(() => stateFromFlags(flags({ palette: 'rainbow-brite' }))).toThrow(/palette/);
  });

  it('throws CliUsageError for an unknown character symbol', () => {
    expect(() => stateFromFlags(flags({ characterSymbol: 'spiral' }))).toThrow(/character/);
  });

  it('throws CliUsageError for an unknown shell id in --set-default', () => {
    expect(() => stateFromFlags(flags({ setDefaultShell: 'elvish' }))).toThrow(/set-default/);
  });

  it('throws CliUsageError for an unknown Nerd Font', () => {
    expect(() => stateFromFlags(flags({ font: 'ComicMono' }))).toThrow(/Nerd Font/);
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

  it('rejects a state card with an install nerdFontToInstall missing an id', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-configurator-'));
    try {
      const card = path.join(dir, 'bad.json');
      const wizard = {
        preset: null,
        leftModules: ['directory'],
        rightModules: [],
        characterSymbol: 'arrow',
        palette: 'default',
        powerline: false,
        selectedShells: [],
        nerdFontToInstall: { kind: 'install' },
        setDefaultShell: null,
        skipStarshipInstall: false,
        hasNerdFont: false,
      };
      fs.writeFileSync(card, JSON.stringify({ version: 1, wizard }));
      expect(() => stateFromFlags(flags({ stateFile: card }))).toThrow(
        /install.*requires a font id/
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects a state card that defers the font to the interactive picker', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-configurator-'));
    try {
      const card = writeFixtureCard(dir, {
        nerdFontToInstall: { kind: 'select' },
      });
      expect(() => stateFromFlags(flags({ stateFile: card }))).toThrow(/interactive picker/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws CliUsageError for an unknown module in a state card left slot', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-configurator-'));
    try {
      const card = writeFixtureCard(dir, {
        leftModules: ['directory', 'sentinel'] as ModuleId[],
      });
      expect(() => stateFromFlags(flags({ stateFile: card }))).toThrow(/sentinel/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws CliUsageError for an unknown module in a state card right slot', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-configurator-'));
    try {
      const card = writeFixtureCard(dir, {
        rightModules: ['time', 'bogus_module'] as ModuleId[],
      });
      expect(() => stateFromFlags(flags({ stateFile: card }))).toThrow(/bogus_module/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accepts the character module inside a state card', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-configurator-'));
    try {
      const card = writeFixtureCard(dir, { leftModules: ['directory', 'character'] });
      expect(stateFromFlags(flags({ stateFile: card })).leftModules).toContain('character');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports a missing state card file as a usage error', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-configurator-'));
    try {
      expect(() => stateFromFlags(flags({ stateFile: path.join(dir, 'missing.json') }))).toThrow(
        /Could not read state card/
      );
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

  it('reports an unwritable -o path as a usage error', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-configurator-'));
    try {
      const out = path.join(dir, 'missing-dir', 'starship.toml');
      expect(() => runGenerate(flags({ preset: 'pure-prompt', outputFile: out }))).toThrow(
        CliUsageError
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports an unwritable --export path as a usage error', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-configurator-'));
    try {
      const out = path.join(dir, 'missing-dir', 'card.json');
      expect(() => runGenerate(flags({ preset: 'pure-prompt', exportFile: out }))).toThrow(
        CliUsageError
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
    await runApply(flags({ subcommand: 'apply', shells: ['zsh'] }), 'apply --shells zsh');

    expect(mockRunInstallTasks).toHaveBeenCalled();
    expect(mockAppendHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'apply',
        command: 'apply --shells zsh',
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
    await runApply(flags({ subcommand: 'apply', shells: ['zsh'] }));

    expect(mockAppendHistory).toHaveBeenCalledWith(expect.objectContaining({ exitCode: 1 }));
    expect(process.exitCode).toBe(1);
    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Install Starship'));
  });

  it('refuses a real run with no target shells before installing anything', async () => {
    await expect(runApply(flags({ subcommand: 'apply' }))).rejects.toThrow(/at least one shell/);

    expect(mockRunInstallTasks).not.toHaveBeenCalled();
    expect(mockAppendHistory).not.toHaveBeenCalled();
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

  it('still dry-runs an empty plan as a preview', async () => {
    await runApply(flags({ subcommand: 'apply', dryRun: true }));

    const output = stdoutWrite.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('(none)');
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
