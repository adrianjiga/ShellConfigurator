import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

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

import type { ModuleId } from '../../config/modules.ts';
import type { CliFlags } from '../../services/args.ts';
import { CliUsageError } from '../../services/errors.ts';
import { NERD_FONTS } from '../../services/installer.ts';
import { serializeState } from '../../services/state.ts';
import { stateFromFlags } from '../../services/stateFlags.ts';
import { DEFAULT_STATE, type WizardState } from '../../types.ts';

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

function expectUsageError(run: () => unknown, message: RegExp): void {
  let caught: unknown;
  try {
    run();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(CliUsageError);
  expect((caught as Error).message).toMatch(message);
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

  it('never plans a font install the flags did not ask for', () => {
    expect(stateFromFlags(flags({ preset: 'pastel-powerline' })).nerdFontToInstall).toEqual({
      kind: 'none',
    });
    expect(
      stateFromFlags(flags({ preset: 'pastel-powerline', font: NERD_FONTS[0].id }))
        .nerdFontToInstall
    ).toEqual({ kind: 'install', id: NERD_FONTS[0].id });
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
      expect.stringContaining('Powerline separators need a Nerd Font')
    );
    stderr.mockRestore();
  });

  it('warns when powerline is on with a text-only preset', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as never);
    stateFromFlags(flags({ preset: 'plain-text', powerline: true, hasNerdFont: true }));
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('uses text symbols only'));
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
    expect(() => stateFromFlags(flags({ shells: ['bash'], setDefaultShell: 'zsh' }))).toThrow(
      /not one of the shells being configured/
    );
    expect(() =>
      stateFromFlags(flags({ shells: ['bash'], setDefaultShell: 'bash' }))
    ).not.toThrow();
  });

  it('deduplicates --shells', () => {
    expect(stateFromFlags(flags({ shells: ['zsh', 'zsh', 'bash'] })).selectedShells).toEqual([
      'zsh',
      'bash',
    ]);
  });

  it('throws CliUsageError for an unknown shell id', () => {
    expectUsageError(() => stateFromFlags(flags({ shells: ['zsh', 'csh'] })), /csh/);
  });

  it('throws CliUsageError for an unknown preset', () => {
    expectUsageError(() => stateFromFlags(flags({ preset: 'nonexistent' })), /preset/);
  });

  it('throws CliUsageError for an unknown palette', () => {
    expectUsageError(() => stateFromFlags(flags({ palette: 'rainbow-brite' })), /palette/);
  });

  it('throws CliUsageError for an unknown character symbol', () => {
    expectUsageError(() => stateFromFlags(flags({ characterSymbol: 'spiral' })), /character/);
  });

  it('throws CliUsageError for an unknown shell id in --set-default', () => {
    expectUsageError(() => stateFromFlags(flags({ setDefaultShell: 'elvish' })), /set-default/);
  });

  it('throws CliUsageError for an unknown Nerd Font', () => {
    expectUsageError(() => stateFromFlags(flags({ font: 'ComicMono' })), /Nerd Font/);
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

  it('--font none on a Nerd Font preset plans no font and drops the glyphs', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as never);
    const state = stateFromFlags(flags({ preset: 'pastel-powerline', font: 'none' }));
    expect(state.nerdFontToInstall).toEqual({ kind: 'none' });
    expect(state.hasNerdFont).toBe(false);
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining('Powerline separators need a Nerd Font')
    );
    stderr.mockRestore();
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
      flags({
        characterSymbol: 'lambda',
        shells: ['zsh'],
        setDefaultShell: 'zsh',
        skipStarship: true,
      })
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

  it('rejects a card whose font id is not a known Nerd Font', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-configurator-'));
    try {
      const card = writeFixtureCard(dir, { nerdFontToInstall: { kind: 'install', id: 'Bogus' } });
      expect(() => stateFromFlags(flags({ stateFile: card }))).toThrow(
        /Unknown Nerd Font: 'Bogus'/
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects a card whose default shell is not one it configures', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-configurator-'));
    try {
      const card = writeFixtureCard(dir, { selectedShells: ['bash'], setDefaultShell: 'zsh' });
      expect(() => stateFromFlags(flags({ stateFile: card }))).toThrow(
        /Cannot set 'zsh' as the default shell/
      );
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
      expectUsageError(() => stateFromFlags(flags({ stateFile: card })), /sentinel/);
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
      expectUsageError(() => stateFromFlags(flags({ stateFile: card })), /bogus_module/);
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
      expectUsageError(
        () => stateFromFlags(flags({ stateFile: path.join(dir, 'missing.json') })),
        /Could not read state card/
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
