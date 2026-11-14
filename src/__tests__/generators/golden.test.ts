import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PRESETS, type PresetDef } from '../../config/presets.ts';
import { generateToml } from '../../generators/starship.ts';
import { DEFAULT_STATE, type WizardState } from '../../types.ts';

const GOLDEN_DIR = fileURLToPath(new URL('../golden/', import.meta.url));

function fixturePath(presetId: string): string {
  return `${GOLDEN_DIR}${presetId}.toml`;
}

/**
 * The canonical state a preset fixture represents, mirroring how PresetScreen
 * applies a preset: modules, palette and
 * powerline flag all come from the def. A Nerd Font preset implies the font is
 * present and one that does not implies text symbols, so each fixture matches
 * the promise the preset's label makes rather than one run's detection result.
 */
function stateForPreset(preset: PresetDef): WizardState {
  return {
    ...DEFAULT_STATE,
    hasNerdFont: preset.requiresNerdFont,
    preset: preset.id,
    leftModules: [...preset.leftModules],
    rightModules: [...preset.rightModules],
    palette: preset.palette,
    powerline: preset.powerline,
  };
}

/**
 * Every fixture: each preset as its label promises, plus — for a preset that
 * also draws glyphs when the font is there — the output a Nerd Font user gets.
 */
const FIXTURES = PRESETS.flatMap((preset) => {
  const base = { name: preset.id, state: stateForPreset(preset) };
  if (preset.requiresNerdFont || preset.textOnly) return [base];
  return [base, { name: `${preset.id}.nerd-font`, state: { ...base.state, hasNerdFont: true } }];
});

describe('golden config fixtures', () => {
  it.each(FIXTURES.map((f) => [f.name, f.state] as const))(
    'matches the committed fixture for %s',
    async (name, state) => {
      // A trailing newline keeps the committed TOML a normal text file; the
      // snapshot asserts it, so a regenerated fixture is byte-identical.
      const generated = `${generateToml(state)}\n`;
      await expect(generated).toMatchFileSnapshot(fixturePath(name));
    }
  );

  it('covers every fixture and leaves no stale ones', () => {
    const onDisk = readdirSync(GOLDEN_DIR)
      .filter((name) => name.endsWith('.toml'))
      .map((name) => name.replace(/\.toml$/, ''))
      .sort();
    expect(onDisk).toEqual(FIXTURES.map((f) => f.name).sort());
  });
});
