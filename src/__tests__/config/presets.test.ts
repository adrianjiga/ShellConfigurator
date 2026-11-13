import { describe, expect, it } from 'vitest';
import { isConfigurableModule, MODULES } from '../../config/modules.ts';
import { getPalette } from '../../config/palettes.ts';
import { PRESETS } from '../../config/presets.ts';

describe('PRESETS', () => {
  it('all presets have required fields', () => {
    for (const preset of PRESETS) {
      expect(preset.id, `${preset.id} missing id`).toBeTruthy();
      expect(preset.label, `${preset.id} missing label`).toBeTruthy();
      expect(preset.description, `${preset.id} missing description`).toBeTruthy();
    }
  });

  it('preset ids are unique', () => {
    const ids = PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every preset with leftModules has at least one module', () => {
    for (const preset of PRESETS) {
      if (preset.leftModules !== undefined) {
        expect(preset.leftModules.length, `${preset.id} has empty leftModules`).toBeGreaterThan(0);
      }
    }
  });

  it('nerd-font-symbols preset requires a nerd font', () => {
    const preset = PRESETS.find((p) => p.id === 'nerd-font-symbols');
    expect(preset?.requiresNerdFont).toBe(true);
  });

  it('plain-text preset does not require a nerd font', () => {
    const preset = PRESETS.find((p) => p.id === 'plain-text');
    expect(preset?.requiresNerdFont).toBe(false);
  });

  it('custom preset is first in the list', () => {
    expect(PRESETS[0]?.id).toBe('custom');
  });

  it('all preset module IDs exist in MODULES', () => {
    const validIds = new Set([...MODULES.map((m) => m.id), 'character']);
    for (const preset of PRESETS) {
      for (const id of preset.leftModules ?? []) {
        expect(validIds.has(id), `${preset.id} leftModules contains unknown module '${id}'`).toBe(
          true
        );
      }
      for (const id of preset.rightModules ?? []) {
        expect(validIds.has(id), `${preset.id} rightModules contains unknown module '${id}'`).toBe(
          true
        );
      }
    }
  });
});

describe('powerline presets', () => {
  it.each(PRESETS.filter((p) => p.powerline).map((p) => [p.id, p] as const))(
    '%s never puts two same-coloured segments next to each other',
    (_id, preset) => {
      const colors = getPalette(preset.palette).colors;
      for (const side of [preset.leftModules ?? [], preset.rightModules ?? []]) {
        const segments = side.filter(isConfigurableModule);
        for (let i = 1; i < segments.length; i++) {
          expect(colors[segments[i]!], `${segments[i - 1]} → ${segments[i]}`).not.toBe(
            colors[segments[i - 1]!]
          );
        }
      }
    }
  );
});
