import { describe, expect, it } from 'vitest';
import { MODULES } from '../../config/modules.ts';
import { PRESETS } from '../../config/presets.ts';
import { NERD_FONTS } from '../../services/installer.ts';
import { formatListing, listEntries } from '../../services/listings.ts';

describe('listEntries', () => {
  it('lists every preset with what a script needs to pick one', () => {
    const presets = listEntries('presets');
    expect(presets.map((p) => p.id)).toEqual(PRESETS.map((p) => p.id));
    expect(presets.find((p) => p.id === 'tokyo-night')).toMatchObject({
      label: 'Tokyo Night',
      palette: 'tokyo-night',
      requiresNerdFont: expect.any(Boolean),
      leftModules: expect.any(Array),
    });
  });

  it('lists every module and every font', () => {
    expect(listEntries('modules').map((m) => m.id)).toEqual(MODULES.map((m) => m.id));
    expect(listEntries('fonts')).toContainEqual({
      id: 'JetBrainsMono',
      label: 'JetBrains Mono',
      family: 'JetBrainsMono Nerd Font',
    });
    expect(listEntries('fonts')).toHaveLength(NERD_FONTS.length);
  });
});

describe('formatListing', () => {
  it('aligns the ids and adds the description when there is one', () => {
    expect(
      formatListing([
        { id: 'a', label: 'Alpha', description: 'first' },
        { id: 'bravo', label: 'Bravo' },
      ])
    ).toBe('a      Alpha — first\nbravo  Bravo\n');
  });
});
