import { describe, expect, it } from 'vitest';
import { parseState, STATE_VERSION, type StateCard, serializeState } from '../../services/state.ts';
import { DEFAULT_STATE, type WizardState } from '../../types.ts';

const sampleState: WizardState = {
  ...DEFAULT_STATE,
  preset: 'catppuccin',
  leftModules: ['directory', 'git_branch', 'git_status', 'character'],
  rightModules: ['time', 'battery'],
  characterSymbol: 'lambda',
  palette: 'vivid',
  powerline: true,
  selectedShells: ['zsh', 'fish'],
  nerdFontToInstall: { kind: 'install', id: 'JetBrainsMono' },
  setDefaultShell: 'zsh',
  skipStarshipInstall: true,
  hasNerdFont: false,
};

describe('serializeState', () => {
  it('writes a versioned card with a trailing newline', () => {
    const card = serializeState(sampleState);
    expect(card.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(card) as StateCard;
    expect(parsed.version).toBe(STATE_VERSION);
    expect(parsed.wizard.preset).toBe('catppuccin');
    expect(parsed.wizard.leftModules).toEqual(sampleState.leftModules);
    expect(parsed.wizard.rightModules).toEqual(sampleState.rightModules);
    expect(parsed.wizard.characterSymbol).toBe('lambda');
    expect(parsed.wizard.palette).toBe('vivid');
    expect(parsed.wizard.powerline).toBe(true);
    expect(parsed.wizard.selectedShells).toEqual(['zsh', 'fish']);
    expect(parsed.wizard.nerdFontToInstall).toEqual({ kind: 'install', id: 'JetBrainsMono' });
    expect(parsed.wizard.setDefaultShell).toBe('zsh');
    expect(parsed.wizard.skipStarshipInstall).toBe(true);
    expect(parsed.wizard.hasNerdFont).toBe(false);
  });

  it('omits runtime-only fields from the card', () => {
    const parsed = JSON.parse(serializeState(sampleState)) as StateCard;
    expect(parsed.wizard).not.toHaveProperty('step');
    expect(parsed.wizard).not.toHaveProperty('installResults');
    expect(parsed.wizard).not.toHaveProperty('packageManager');
  });
});

describe('parseState', () => {
  it('round-trips a serialized card exactly', () => {
    const restored = parseState(serializeState(sampleState));
    expect(restored).toEqual(sampleState);
  });

  it('rejects malformed JSON', () => {
    expect(() => parseState('{nope')).toThrow(/Invalid state card/);
  });

  it('rejects an unknown version', () => {
    const card = JSON.parse(serializeState(sampleState)) as StateCard;
    card.version = 2;
    expect(() => parseState(JSON.stringify(card))).toThrow(
      /Unsupported state card version: 2 .* newer/i
    );
  });

  it('rejects a card without a wizard object', () => {
    expect(() => parseState(JSON.stringify({ version: 1 }))).toThrow(/missing wizard/);
  });

  it('starts runtime fields at their defaults', () => {
    const restored = parseState(serializeState(sampleState));
    expect(restored.step).toBe('welcome');
    expect(restored.hasNerdFont).toBe(false);
    expect(restored.packageManager).toBe('script');
    expect(restored.installedShells).toEqual([]);
    expect(restored.dryRun).toBe(false);
    expect(restored.installResults).toEqual([]);
  });

  it('defaults present-but-malformed choices instead of crashing', () => {
    const card = JSON.parse(serializeState(sampleState)) as StateCard;
    card.wizard.leftModules = [42] as never;
    card.wizard.palette = 7 as never;
    card.wizard.characterSymbol = 'twirl' as never;
    const restored = parseState(JSON.stringify(card));
    expect(restored.leftModules).toEqual(['directory', 'git_branch', 'git_status', 'character']);
    expect(restored.characterSymbol).toBe('arrow');
  });

  it('keeps a valid nerdFontToInstall none choice', () => {
    const card = JSON.parse(serializeState(sampleState)) as StateCard;
    card.wizard.nerdFontToInstall = { kind: 'none' };
    const restored = parseState(JSON.stringify(card));
    expect(restored.nerdFontToInstall).toEqual({ kind: 'none' });
  });

  it('rejects an install nerdFontToInstall missing a font id', () => {
    const card = {
      version: STATE_VERSION,
      wizard: { nerdFontToInstall: { kind: 'install' } },
    };
    expect(() => parseState(JSON.stringify(card))).toThrow(/install.*requires a font id/);
  });

  it('rejects an unknown nerdFontToInstall kind', () => {
    const card = {
      version: STATE_VERSION,
      wizard: { nerdFontToInstall: { kind: 'mystery' } },
    };
    expect(() => parseState(JSON.stringify(card))).toThrow(/unknown nerdFontToInstall kind/);
  });

  it('defaults absent modules to the core set', () => {
    const card = JSON.parse(serializeState(sampleState)) as StateCard;
    card.wizard.leftModules = undefined as never;
    const restored = parseState(JSON.stringify(card));
    expect(restored.leftModules).toContain('directory');
  });
});
