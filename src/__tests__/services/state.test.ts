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
    expect(parsed.wizard.directoryTruncationLength).toBe(3);
    expect(parsed.wizard.directorySubstitutions).toEqual([]);
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

  it('blames an older tool for an older card version', () => {
    const card = JSON.parse(serializeState(sampleState)) as StateCard;
    card.version = 0;
    expect(() => parseState(JSON.stringify(card))).toThrow(/older ShellConfigurator/);
  });

  it('blames a newer tool for an unknown non-numeric version', () => {
    expect(() => parseState(JSON.stringify({ version: 'one', wizard: {} }))).toThrow(
      /newer ShellConfigurator/
    );
  });

  it('rejects a card without a wizard object', () => {
    expect(() => parseState(JSON.stringify({ version: 1 }))).toThrow(/missing wizard/);
  });

  it('rejects an array in place of the wizard object', () => {
    expect(() => parseState(JSON.stringify({ version: 1, wizard: [] }))).toThrow(/missing wizard/);
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

  it('round-trips the directory truncation length and substitutions', () => {
    const restored = parseState(
      serializeState({
        ...sampleState,
        directoryTruncationLength: 1,
        directorySubstitutions: [{ from: 'projects', to: 'code' }],
      })
    );
    expect(restored.directoryTruncationLength).toBe(1);
    expect(restored.directorySubstitutions).toEqual([{ from: 'projects', to: 'code' }]);
  });

  it('clamps an out-of-range truncation length from a hand-edited card', () => {
    const card = JSON.parse(serializeState(sampleState)) as StateCard;
    card.wizard.directoryTruncationLength = 99;
    expect(parseState(JSON.stringify(card)).directoryTruncationLength).toBe(5);
  });

  it('defaults an unknown palette in a hand-edited card', () => {
    const card = JSON.parse(serializeState(sampleState)) as StateCard;
    card.wizard.palette = 'not-a-palette' as never;
    expect(parseState(JSON.stringify(card)).palette).toBe('default');
  });

  it('rejects an unknown module id in a hand-edited card', () => {
    const card = JSON.parse(serializeState(sampleState)) as StateCard;
    card.wizard.leftModules = ['directory', 'unknown', 'directory', 'character'] as never;
    expect(() => parseState(JSON.stringify(card))).toThrow(/unknown module 'unknown'/);
  });

  it('explains that character belongs on the left when a card puts it on the right', () => {
    const card = JSON.parse(serializeState(sampleState)) as StateCard;
    card.wizard.rightModules = ['character'] as never;
    expect(() => parseState(JSON.stringify(card))).toThrow(/belongs in leftModules/);
  });

  it('deduplicates valid module ids and removes right-side duplicates of left modules', () => {
    const card = JSON.parse(serializeState(sampleState)) as StateCard;
    card.wizard.leftModules = ['directory', 'directory', 'character'] as never;
    card.wizard.rightModules = ['directory', 'time', 'time'] as never;
    const restored = parseState(JSON.stringify(card));
    expect(restored.leftModules).toEqual(['directory', 'character']);
    expect(restored.rightModules).toEqual(['time']);
  });

  it('keeps an empty left module list instead of restoring the defaults', () => {
    const card = JSON.parse(serializeState(sampleState)) as StateCard;
    card.wizard.leftModules = [];
    card.wizard.rightModules = ['time'];
    const restored = parseState(JSON.stringify(card));
    expect(restored.leftModules).toEqual([]);
    expect(restored.rightModules).toEqual(['time']);
  });

  it('hands out its own default module list, not the shared constant', () => {
    const card = JSON.parse(serializeState(sampleState)) as StateCard;
    delete (card.wizard as Partial<StateCard['wizard']>).leftModules;
    const restored = parseState(JSON.stringify(card));
    restored.leftModules.push('time');
    expect(parseState(JSON.stringify(card)).leftModules).not.toContain('time');
  });

  it('drops malformed substitution entries and keeps the last duplicate source', () => {
    const card = JSON.parse(serializeState(sampleState)) as StateCard;
    card.wizard.directorySubstitutions = [
      { from: 'a', to: 'one' },
      { from: '', to: 'ignored' },
      { from: 'b', to: 7 },
      null,
      { from: 'a', to: 'two' },
    ] as never;
    expect(parseState(JSON.stringify(card)).directorySubstitutions).toEqual([
      { from: 'a', to: 'two' },
    ]);
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

  it('round-trips the keep-existing-config decision', () => {
    const restored = parseState(serializeState({ ...sampleState, keepExistingConfig: true }));
    expect(restored.keepExistingConfig).toBe(true);
  });

  it('defaults keep-existing-config to false and never persists sharedConfigToml', () => {
    const restored = parseState(
      serializeState({ ...sampleState, keepExistingConfig: false, sharedConfigToml: '# x' })
    );
    expect(restored.keepExistingConfig).toBe(false);
    expect(restored.sharedConfigToml).toBeNull();
    const card = JSON.parse(serializeState(sampleState)) as StateCard;
    expect(card.wizard).not.toHaveProperty('sharedConfigToml');
  });
});
