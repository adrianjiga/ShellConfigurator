import { afterEach, describe, expect, it } from 'vitest';
import { colorsEnabled, uiColor } from '../../config/colors.ts';

const savedNoColor = process.env.NO_COLOR;

afterEach(() => {
  if (savedNoColor === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = savedNoColor;
});

describe('colorsEnabled', () => {
  it('is on when NO_COLOR is unset', () => {
    delete process.env.NO_COLOR;
    expect(colorsEnabled()).toBe(true);
  });

  it('is on when NO_COLOR is empty, as the convention requires', () => {
    process.env.NO_COLOR = '';
    expect(colorsEnabled()).toBe(true);
  });

  it('is off when NO_COLOR has any non-empty value', () => {
    process.env.NO_COLOR = '1';
    expect(colorsEnabled()).toBe(false);
  });
});

describe('uiColor', () => {
  it('passes the colour through when colour is on', () => {
    delete process.env.NO_COLOR;
    expect(uiColor('cyan')).toBe('cyan');
  });

  it('drops the colour when NO_COLOR is set', () => {
    process.env.NO_COLOR = '1';
    expect(uiColor('cyan')).toBeUndefined();
  });

  it('keeps an absent colour absent', () => {
    delete process.env.NO_COLOR;
    expect(uiColor(undefined)).toBeUndefined();
  });
});
