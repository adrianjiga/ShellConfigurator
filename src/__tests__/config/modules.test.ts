import { describe, expect, it } from 'vitest';
import { getModule, MODULES, type PreviewSample, placedModules } from '../../config/modules.ts';

const SAMPLE: PreviewSample = { directoryTruncationLength: 3, directorySubstitutions: [] };

import { NERD_FONT_SYMBOLS } from '../../config/promptSymbols.ts';

describe('MODULES', () => {
  it('all modules have required fields', () => {
    for (const mod of MODULES) {
      expect(mod.id, `${mod.id} missing id`).toBeTruthy();
      expect(mod.label, `${mod.id} missing label`).toBeTruthy();
      expect(mod.description, `${mod.id} missing description`).toBeTruthy();
      expect(typeof mod.previewSegment, `${mod.id} previewSegment not a function`).toBe('function');
    }
  });

  it('module ids are unique', () => {
    const ids = MODULES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers the phase 3 module library (at least 28 placeable modules)', () => {
    expect(MODULES.length).toBeGreaterThanOrEqual(28);
  });

  it('previewSegment returns a non-empty string', () => {
    for (const mod of MODULES) {
      expect(mod.previewSegment(true, SAMPLE), `${mod.id} nerd font preview empty`).toBeTruthy();
      expect(mod.previewSegment(false, SAMPLE), `${mod.id} text preview empty`).toBeTruthy();
    }
  });

  it('previews Nerd Font icons for the modules that provide them', () => {
    expect(getModule('git_branch')?.previewSegment(true, SAMPLE)).toContain('');
    expect(getModule('nodejs')?.previewSegment(true, SAMPLE)).toContain('');
    expect(getModule('python')?.previewSegment(true, SAMPLE)).toContain('');
    expect(getModule('rust')?.previewSegment(true, SAMPLE)).toContain('');
    expect(getModule('git_branch')?.plainPreview?.(false)).toBe('on main');
    expect(getModule('git_branch')?.plainPreview?.(true)).toBe(
      `on ${NERD_FONT_SYMBOLS.gitBranch}main`
    );
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

describe('directory preview', () => {
  const directory = getModule('directory')!;

  it('shows the sample path within the default depth', () => {
    expect(directory.previewSegment(false, SAMPLE)).toBe('~/projects/myapp');
  });

  it('keeps only the last folders when truncated', () => {
    expect(directory.previewSegment(false, { ...SAMPLE, directoryTruncationLength: 1 })).toBe(
      'myapp'
    );
  });

  it('applies substitutions before truncating', () => {
    const sample = { ...SAMPLE, directorySubstitutions: [{ from: 'projects', to: 'p' }] };
    expect(directory.previewSegment(false, sample)).toBe('~/p/myapp');
  });
});

describe('placedModules', () => {
  it('keeps each module once and gives one chosen for both sides to the left', () => {
    expect(
      placedModules(['git_branch', 'directory', 'git_branch'], ['nodejs', 'directory', 'nodejs'])
    ).toEqual({
      left: ['git_branch', 'directory'],
      right: ['nodejs'],
    });
  });
});
