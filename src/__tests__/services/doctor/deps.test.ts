import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DOCTOR_DEPS } from '../../../services/doctor/deps.ts';
import { stubPlatform } from '../../helpers/platform.ts';

describe('DEFAULT_DOCTOR_DEPS', () => {
  it('reads an unreadable Starship version record as none instead of throwing', () => {
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'shellconf-cache-'));
    vi.stubEnv('XDG_CACHE_HOME', cache);
    try {
      fs.mkdirSync(path.join(cache, 'shell-configurator', 'starship.version'), { recursive: true });
      expect(DEFAULT_DOCTOR_DEPS.readCachedStarshipVersion()).toBeNull();
    } finally {
      vi.unstubAllEnvs();
      fs.rmSync(cache, { recursive: true, force: true });
    }
  });
});

describe('DEFAULT_DOCTOR_DEPS.hasNerdFonts', () => {
  let data: string;
  let restorePlatform: () => void;
  beforeEach(() => {
    data = fs.mkdtempSync(path.join(os.tmpdir(), 'shellconf-fonts-'));
    vi.stubEnv('XDG_DATA_HOME', data);
    restorePlatform = stubPlatform('linux');
    fs.mkdirSync(path.join(data, 'fonts', 'nerd'), { recursive: true });
  });
  afterEach(() => {
    restorePlatform();
    vi.unstubAllEnvs();
    fs.rmSync(data, { recursive: true, force: true });
  });
  const add = (name: string) => fs.writeFileSync(path.join(data, 'fonts', 'nerd', name), '');

  it('counts only font files, not a leftover archive or license', () => {
    add('FiraCodeNerdFont.zip');
    add('FiraCodeNerdFont-LICENSE.txt');
    expect(DEFAULT_DOCTOR_DEPS.hasNerdFonts('FiraCode')).toBe(false);
    expect(DEFAULT_DOCTOR_DEPS.hasNerdFonts()).toBe(false);

    add('FiraCodeNerdFont-Regular.ttf');
    expect(DEFAULT_DOCTOR_DEPS.hasNerdFonts('FiraCode')).toBe(true);
    expect(DEFAULT_DOCTOR_DEPS.hasNerdFonts()).toBe(true);
  });

  it('finds a Nerd Fonts 2 install by its older file names', () => {
    add('JetBrains Mono Regular Nerd Font Complete.ttf');
    expect(DEFAULT_DOCTOR_DEPS.hasNerdFonts('JetBrainsMono')).toBe(true);
    expect(DEFAULT_DOCTOR_DEPS.hasNerdFonts('FiraCode')).toBe(false);
  });

  it('looks for the requested font, not any Nerd Font', () => {
    add('JetBrainsMonoNerdFont-Regular.ttf');
    expect(DEFAULT_DOCTOR_DEPS.hasNerdFonts('FiraCode')).toBe(false);
    expect(DEFAULT_DOCTOR_DEPS.hasNerdFonts('JetBrainsMono')).toBe(true);
  });
});
