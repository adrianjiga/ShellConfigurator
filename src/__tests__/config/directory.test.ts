import { describe, expect, it } from 'vitest';
import {
  clampTruncationLength,
  DEFAULT_TRUNCATION_LENGTH,
  formatSubstitutions,
  MAX_TRUNCATION_LENGTH,
  MIN_TRUNCATION_LENGTH,
  parseSubstitutions,
} from '../../config/directory.ts';

describe('clampTruncationLength', () => {
  it('leaves a value inside the picker range alone', () => {
    expect(clampTruncationLength(3)).toBe(3);
  });

  it('clamps to the full-path minimum and the maximum', () => {
    expect(clampTruncationLength(-4)).toBe(MIN_TRUNCATION_LENGTH);
    expect(clampTruncationLength(99)).toBe(MAX_TRUNCATION_LENGTH);
  });

  it('rounds fractional values', () => {
    expect(clampTruncationLength(2.6)).toBe(3);
  });

  it('falls back to the default for a non-finite value', () => {
    expect(clampTruncationLength(Number.NaN)).toBe(DEFAULT_TRUNCATION_LENGTH);
    expect(clampTruncationLength(Number.POSITIVE_INFINITY)).toBe(DEFAULT_TRUNCATION_LENGTH);
  });
});

describe('formatSubstitutions', () => {
  it('renders each pair as from=to, comma separated', () => {
    expect(
      formatSubstitutions([
        { from: 'projects', to: 'code' },
        { from: 'node_modules', to: '' },
      ])
    ).toBe('projects=code, node_modules=');
  });

  it('renders an empty list as an empty string', () => {
    expect(formatSubstitutions([])).toBe('');
  });
});

describe('parseSubstitutions', () => {
  it('parses pairs, trimming whitespace around the separator', () => {
    expect(parseSubstitutions(' projects = code , node_modules = deps ')).toEqual([
      { from: 'projects', to: 'code' },
      { from: 'node_modules', to: 'deps' },
    ]);
  });

  it('returns an empty list for blank input', () => {
    expect(parseSubstitutions('')).toEqual([]);
    expect(parseSubstitutions('  ,  ')).toEqual([]);
  });

  it('allows an empty target, which hides the folder', () => {
    expect(parseSubstitutions('node_modules=')).toEqual([{ from: 'node_modules', to: '' }]);
  });

  it('keeps the last entry when a source repeats', () => {
    expect(parseSubstitutions('src=one, src=two')).toEqual([{ from: 'src', to: 'two' }]);
  });

  it('rejects a pair without an equals sign', () => {
    expect(() => parseSubstitutions('broken')).toThrow(/Missing '='/);
  });

  it('rejects a pair without a source folder', () => {
    expect(() => parseSubstitutions('=target')).toThrow(/needs a folder name/);
  });
});
