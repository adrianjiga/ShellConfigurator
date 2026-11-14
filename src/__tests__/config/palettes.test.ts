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

describe('palette colours', () => {
  const STARSHIP_COLOUR =
    /^(#[0-9a-f]{6}|(bright-)?(black|red|green|yellow|blue|purple|cyan|white)|\d{1,3})$/i;

  it('are all colours Starship can parse', () => {
    for (const palette of PALETTES) {
      for (const [name, value] of Object.entries(palette.colors)) {
        expect(STARSHIP_COLOUR.test(value), `${palette.id}.${name} = ${value}`).toBe(true);
        if (/^\d+$/.test(value)) expect(Number(value)).toBeLessThanOrEqual(255);
      }
    }
  });
});
