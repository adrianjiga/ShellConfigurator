import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockDetectInstalledShells,
  mockDetectPackageManager,
  mockDetectContainer,
  mockDetectTerminal,
  mockRunInstallTasks,
  mockAppendHistory,
} = vi.hoisted(() => ({
  mockDetectInstalledShells: vi.fn(),
  mockDetectPackageManager: vi.fn(),
  mockDetectContainer: vi.fn(),
  mockDetectTerminal: vi.fn(),
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
    detectContainerAsync: mockDetectContainer,
    detectTerminalAsync: mockDetectTerminal,
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
import { CliRunError, CliUsageError } from '../../services/errors.ts';
import {
  fetchImportedConfig,
  runApply,
  runGenerate,
  stateFromFlags,
} from '../../services/headless.ts';
import { DEFAULT_INSTALL_TASK_DEPS } from '../../services/installTasks.ts';
import { NERD_FONTS } from '../../services/installer.ts';
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

  it('plans the font install a Nerd Font preset needs', () => {
    const state = stateFromFlags(flags({ preset: 'pastel-powerline' }));
    expect(state.nerdFontToInstall).toEqual({ kind: 'install', id: NERD_FONTS[0].id });
    expect(stateFromFlags(flags({ preset: 'pure-prompt' })).nerdFontToInstall).toEqual({
      kind: 'none',
    });
  });

  it('does not plan a font install when the user says glyphs already render', () => {
    const state = stateFromFlags(flags({ preset: 'pastel-powerline', hasNerdFont: true }));
    expect(state.nerdFontToInstall).toEqual({ kind: 'none' });
  });

  it('keeps the font facts a card recorded when a preset is layered on top', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-configurator-'));
    try {
      const haveFont = writeFixtureCard(dir, { hasNerdFont: true });
      expect(
        stateFromFlags(flags({ stateFile: haveFont, preset: 'pure-prompt' })).hasNerdFont
      ).toBe(true);

      const noFont = writeFixtureCard(dir, { hasNerdFont: false });
      const state = stateFromFlags(flags({ stateFile: noFont, preset: 'pastel-powerline' }));
      expect(state.hasNerdFont).toBe(false);
      expect(state.nerdFontToInstall).toEqual({ kind: 'none' });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('lets an explicit --no-nerd-font beat the preset inference', () => {
    const state = stateFromFlags(flags({ preset: 'pastel-powerline', hasNerdFont: false }));
    expect(state.hasNerdFont).toBe(false);
    expect(state.powerline).toBe(true);
  });

  it('warns when powerline is on without a Nerd Font', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as never);
    stateFromFlags(flags({ preset: 'pastel-powerline', font: 'none' }));
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining('powerline separators need a Nerd Font')
    );
    stderr.mockRestore();
  });

  it('does not warn when the preset has a font to render glyphs with', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as never);
    stateFromFlags(flags({ preset: 'pastel-powerline' }));
    expect(stderr).not.toHaveBeenCalled();
    stderr.mockRestore();
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

  it('rejects a default shell that is not one of the shells being configured', () => {
    expect(() =>
      stateFromFlags(flags({ shells: ['bash'], setDefaultShell: 'zsh' }))
    ).toThrow(/not one of the shells being configured/);
    expect(() =>
      stateFromFlags(flags({ shells: ['bash'], setDefaultShell: 'bash' }))
    ).not.toThrow();
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

  it('--adopt keeps the existing shared config', () => {
    const state = stateFromFlags(flags({ adopt: true }));
    expect(state.keepExistingConfig).toBe(true);
  });

  it('applies the remaining scalar flags', () => {
    const state = stateFromFlags(
      flags({ characterSymbol: 'lambda', shells: ['zsh'], setDefaultShell: 'zsh', skipStarship: true })
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

  beforeEach(() => {
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true as never);
    stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as never);
    mockDetectInstalledShells.mockResolvedValue(['zsh']);
    mockDetectPackageManager.mockResolvedValue('apt');
    mockDetectContainer.mockResolvedValue(false);
    mockDetectTerminal.mockResolvedValue(null);
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
    const output = stdoutWrite.mock.calls
      .map((call: [string, ...unknown[]]) => String(call[0]))
      .join('');
    expect(output).toContain('dry run');
    expect(output).toContain('Targets: bash');
    expect(output).toContain('Generated starship.toml');
  });

  it('says plainly when --adopt --dry-run finds no config to keep', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-configurator-'));
    const previous = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = dir;
    try {
      await runApply(flags({ subcommand: 'apply', shells: ['bash'], adopt: true, dryRun: true }));
      const output = stdoutWrite.mock.calls
        .map((call: [string, ...unknown[]]) => String(call[0]))
        .join('');
      expect(output).toContain('No config to keep yet');
      expect(output).toContain(path.join(dir, 'starship.toml'));
    } finally {
      if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previous;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('names the config --adopt --dry-run would keep', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-configurator-'));
    const previous = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = dir;
    fs.writeFileSync(path.join(dir, 'starship.toml'), 'format = "x"\n');
    try {
      await runApply(flags({ subcommand: 'apply', shells: ['bash'], adopt: true, dryRun: true }));
      const output = stdoutWrite.mock.calls
        .map((call: [string, ...unknown[]]) => String(call[0]))
        .join('');
      expect(output).toContain(`Config to keep: ${path.join(dir, 'starship.toml')}`);
    } finally {
      if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previous;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a real run with no shells selected', async () => {
    await expect(runApply(flags({ subcommand: 'apply' }))).rejects.toThrow(/none are selected/);
    expect(mockRunInstallTasks).not.toHaveBeenCalled();
  });

  it('does not download an import URL when the plan has no shells', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('[a]', { status: 200 }));

    await expect(
      runApply(flags({ subcommand: 'apply', importUrl: 'https://example.com/raw' }))
    ).rejects.toThrow(/none are selected/);
    expect(fetchSpy).not.toHaveBeenCalled();
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
    const output = stdoutWrite.mock.calls
      .map((call: [string, ...unknown[]]) => String(call[0]))
      .join('');
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

    const output = stdoutWrite.mock.calls
      .map((call: [string, ...unknown[]]) => String(call[0]))
      .join('');
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

  it('adopts an imported URL in dry-run instead of generating a TOML', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('[character]\nsuccess_symbol = "…"\n', { status: 200 })
    );

    await runApply(
      flags({
        subcommand: 'apply',
        shells: ['zsh'],
        importUrl: 'https://gist.example/raw',
        dryRun: true,
      })
    );

    const output = stdoutWrite.mock.calls
      .map((call: [string, ...unknown[]]) => String(call[0]))
      .join('');
    expect(output).toContain('Config to keep');
    expect(output).toContain('success_symbol = "…"');
    expect(output).not.toContain('Generated starship.toml');
    expect(mockRunInstallTasks).not.toHaveBeenCalled();
  });

  it('feeds the fetched config into the install as the shared config', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('[character]\nsuccess_symbol = "…"\n', { status: 200 })
    );
    const fakeTask = { id: 'config', label: 'Keep existing Starship config', status: 'done' };
    mockRunInstallTasks.mockResolvedValue([fakeTask] as never);

    await runApply(
      flags({ subcommand: 'apply', shells: ['zsh'], importUrl: 'https://gist.example/raw' })
    );

    expect(mockRunInstallTasks).toHaveBeenCalledWith(
      expect.objectContaining({
        keepExistingConfig: true,
        sharedConfigToml: '[character]\nsuccess_symbol = "…"\n',
      }),
      DEFAULT_INSTALL_TASK_DEPS,
      expect.any(Function)
    );
  });

  it('marks the run as running in a container when detected', async () => {
    const fakeTask = { id: 'config', label: 'Write config files', status: 'done' };
    mockRunInstallTasks.mockResolvedValue([fakeTask] as never);
    mockDetectContainer.mockResolvedValue(true);

    await runApply(flags({ subcommand: 'apply', shells: ['zsh'] }));

    expect(mockRunInstallTasks).toHaveBeenCalledWith(
      expect.objectContaining({ container: true }),
      DEFAULT_INSTALL_TASK_DEPS,
      expect.any(Function)
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
      expect.any(Function)
    );
  });

  it('passes a null terminal through when none is detected', async () => {
    const fakeTask = { id: 'config', label: 'Write config files', status: 'done' };
    mockRunInstallTasks.mockResolvedValue([fakeTask] as never);

    await runApply(flags({ subcommand: 'apply', shells: ['zsh'] }));

    expect(mockRunInstallTasks).toHaveBeenCalledWith(
      expect.objectContaining({ terminal: null }),
      DEFAULT_INSTALL_TASK_DEPS,
      expect.any(Function)
    );
  });

  it('adopts the existing shared config when --adopt is passed without --import-url', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-configurator-'));
    const previous = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = dir;
    try {
      await runApply(flags({ subcommand: 'apply', shells: ['zsh'], adopt: true, dryRun: true }));
      const output = stdoutWrite.mock.calls
        .map((call: [string, ...unknown[]]) => String(call[0]))
        .join('');
      expect(output).toContain('No config to keep yet');
      expect(output).not.toContain('Generated starship.toml');
    } finally {
      if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previous;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects a non-http import URL as a usage error', async () => {
    await expect(
      runApply(flags({ subcommand: 'apply', shells: ['zsh'], importUrl: 'ftp://nope' }))
    ).rejects.toThrow(CliUsageError);
  });

  it('refuses a plain-http import URL', async () => {
    await expect(
      fetchImportedConfig('http://example.com/starship.toml')
    ).rejects.toThrow(/requires an https URL/);
  });

  it('accepts an uppercase scheme', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[a]', { status: 200 }));

    await expect(fetchImportedConfig('HTTPS://example.com/starship.toml')).resolves.toBe('[a]');
  });

  it('rejects an HTTP error when fetching an imported config as a run failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }));

    await expect(
      runApply(
        flags({ subcommand: 'apply', shells: ['zsh'], importUrl: 'https://example.com/404' })
      )
    ).rejects.toThrow(/HTTP 404/);
    await expect(fetchImportedConfig('https://example.com/404', { timeoutMs: 5 })).rejects.toThrow(
      CliRunError
    );
  });

  it('rejects an empty body from a URL fetch', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));

    await expect(
      runApply(
        flags({ subcommand: 'apply', shells: ['zsh'], importUrl: 'https://example.com/empty' })
      )
    ).rejects.toThrow(/no config content/);
  });

  it('rejects an HTML page instead of adopting it as a config', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<!DOCTYPE html><html><body>gist</body></html>', { status: 200 })
    );

    await expect(
      fetchImportedConfig('https://gist.example.com/not-raw')
    ).rejects.toThrow(/returned HTML, not a TOML config/);
  });

  it('rejects an oversized imported config based on the declared content-length', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('small', { status: 200, headers: { 'content-length': '9000000' } })
    );

    await expect(
      runApply(
        flags({ subcommand: 'apply', shells: ['zsh'], importUrl: 'https://example.com/lies' })
      )
    ).rejects.toThrow(/server reports 9000000 bytes/);
  });

  it('rejects an oversized imported config based on the actual downloaded bytes', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('a'.repeat(1_000_001), { status: 200 })
    );

    await expect(
      runApply(
        flags({ subcommand: 'apply', shells: ['zsh'], importUrl: 'https://example.com/huge' })
      )
    ).rejects.toThrow(/config exceeds 1000000 bytes/);
  });

  it('stops reading an oversized streamed body instead of buffering it whole', async () => {
    let cancelled = false;
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 50) throw new Error('kept reading past the cap');
        controller.enqueue(new Uint8Array(100_000));
      },
      cancel() {
        cancelled = true;
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 200 }));

    await expect(
      fetchImportedConfig('https://example.com/stream', { maxBytes: 1_000_000 })
    ).rejects.toThrow(/config exceeds 1000000 bytes/);
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThanOrEqual(12);
  });

  it('times out a hung import fetch and says how long it waited', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new DOMException('The operation was aborted', 'TimeoutError')
    );

    await expect(fetchImportedConfig('https://example.com/slow', { timeoutMs: 1 })).rejects.toThrow(
      /timed out after 1ms/
    );
  });

  it('reports a body that fails mid-read as a run failure, not a stack trace', async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(10));
        controller.error(new Error('ECONNRESET'));
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 200 }));

    await expect(fetchImportedConfig('https://example.com/reset')).rejects.toThrow(CliRunError);
    await expect(fetchImportedConfig('https://example.com/reset')).rejects.toThrow(/ECONNRESET/);
  });

  it('passes a timeout signal to fetch so a hung request aborts', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('[a]', { status: 200 }));

    await fetchImportedConfig('https://example.com/fast', { timeoutMs: 5 });

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.com/fast',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('reports a network failure when fetching an imported config', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ENOTFOUND'));

    await expect(
      runApply(
        flags({ subcommand: 'apply', shells: ['zsh'], importUrl: 'https://offline.test/raw' })
      )
    ).rejects.toThrow(/Could not fetch.*ENOTFOUND/);
  });
});
