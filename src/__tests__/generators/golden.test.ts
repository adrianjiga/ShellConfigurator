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
 * applies a preset: modules fall back to the core defaults, and the palette and
 * powerline flag come from the def. A Nerd Font preset implies the font is
 * present and one that does not implies text symbols, so each fixture matches
 * the promise the preset's label makes rather than one run's detection result.
 */
function stateForPreset(preset: PresetDef): WizardState {
  return {
    ...DEFAULT_STATE,
    hasNerdFont: preset.requiresNerdFont,
    preset: preset.id,
    leftModules: preset.leftModules ?? DEFAULT_STATE.leftModules,
    rightModules: preset.rightModules ?? DEFAULT_STATE.rightModules,
    palette: preset.palette,
    powerline: preset.powerline,
  };
}

describe('golden config fixtures', () => {
  it.each(PRESETS.map((p) => [p.id, p] as const))(
    'matches the committed fixture for %s',
    async (_presetId, preset) => {
      // A trailing newline keeps the committed TOML a normal text file; the
      // snapshot asserts it, so a regenerated fixture is byte-identical.
      const generated = `${generateToml(stateForPreset(preset))}\n`;
      await expect(generated).toMatchFileSnapshot(fixturePath(preset.id));
    }
  );

  it('covers every preset with a fixture and leaves no stale fixtures', () => {
    const onDisk = readdirSync(GOLDEN_DIR)
      .filter((name) => name.endsWith('.toml'))
      .map((name) => name.replace(/\.toml$/, ''))
      .sort();
    expect(onDisk).toEqual(PRESETS.map((p) => p.id).sort());
  });
});
