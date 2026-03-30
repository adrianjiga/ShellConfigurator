import { describe, it, expect } from 'vitest';
import { MODULES, getModule } from '../../config/modules.js';

describe('MODULES', () => {
  it('all modules have required fields', () => {
    for (const mod of MODULES) {
      expect(mod.id, `${mod.id} missing id`).toBeTruthy();
      expect(mod.label, `${mod.id} missing label`).toBeTruthy();
      expect(mod.description, `${mod.id} missing description`).toBeTruthy();
      expect(mod.formatKey, `${mod.id} missing formatKey`).toBeTruthy();
      expect(typeof mod.previewSegment, `${mod.id} previewSegment not a function`).toBe('function');
    }
  });

  it('module ids are unique', () => {
    const ids = MODULES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('previewSegment returns a non-empty string', () => {
    for (const mod of MODULES) {
      expect(mod.previewSegment(true), `${mod.id} nerd font preview empty`).toBeTruthy();
      expect(mod.previewSegment(false), `${mod.id} text preview empty`).toBeTruthy();
    }
  });
});

describe('getModule', () => {
  it('returns module by id', () => {
    const mod = getModule('directory');
    expect(mod?.id).toBe('directory');
    expect(mod?.label).toBe('Directory');
  });

  it('returns undefined for unknown id', () => {
    expect(getModule('unknown_module')).toBeUndefined();
  });

  it('can retrieve every module by its own id', () => {
    for (const mod of MODULES) {
      expect(getModule(mod.id)).toBe(mod);
    }
  });
});
