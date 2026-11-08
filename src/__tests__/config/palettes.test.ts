import { describe, expect, it } from 'vitest';
import { getPalette, inkColor, PALETTES } from '../../config/palettes.ts';

const defaultPalette = PALETTES.find((p) => p.id === 'default');

describe('PALETTES', () => {
  it('every palette defines every colour role', () => {
    const roles = Object.keys(defaultPalette?.colors ?? {});
    expect(roles.length).toBeGreaterThan(0);
    for (const palette of PALETTES) {
      for (const role of roles) {
        expect(
          palette.colors[role as keyof typeof palette.colors],
          `${palette.id} is missing ${role}`
        ).toBeTruthy();
      }
    }
  });

  it('ships an accessibility-oriented palette for contrast and colour blindness', () => {
    expect(PALETTES.map((p) => p.id)).toEqual(
      expect.arrayContaining(['high-contrast', 'colorblind'])
    );
  });

  it('getPalette returns the palette under its id', () => {
    const palette = PALETTES.find((p) => p.id === 'high-contrast');
    expect(palette).toBeDefined();
    expect(getPalette('high-contrast')).toEqual(palette);
  });
});

describe('inkColor', () => {
  it('translates the starship names Ink spells differently', () => {
    expect(inkColor('purple')).toBe('magenta');
    expect(inkColor('bright-purple')).toBe('magentaBright');
    expect(inkColor('bright-black')).toBe('gray');
  });

  it('leaves hex literals and matching names alone', () => {
    expect(inkColor('#ffffff')).toBe('#ffffff');
    expect(inkColor('cyan')).toBe('cyan');
  });
});
