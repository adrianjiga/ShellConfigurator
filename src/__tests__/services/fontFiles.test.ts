import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordFontFiles } from '../../services/cache.ts';
import { getNerdFontsDir, installedFontFiles } from '../../services/installer.ts';
import { stubPlatform } from '../helpers/platform.ts';

let home: string;
let restorePlatform: () => void;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'shellconf-fontfiles-'));
  vi.stubEnv('HOME', home);
  vi.stubEnv('XDG_CACHE_HOME', path.join(home, 'cache'));
  vi.stubEnv('XDG_DATA_HOME', path.join(home, 'data'));
  restorePlatform = stubPlatform('linux');
});

afterEach(() => {
  restorePlatform();
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

describe('installedFontFiles', () => {
  it('finds a font from the names its install recorded, with no archive cached', async () => {
    fs.mkdirSync(getNerdFontsDir(), { recursive: true });
    fs.writeFileSync(path.join(getNerdFontsDir(), 'FiraCodeNerdFont-Regular.ttf'), 'ttf');
    recordFontFiles('FiraCode', ['FiraCodeNerdFont-Regular.ttf', 'FiraCodeNerdFont-Bold.ttf']);

    expect(await installedFontFiles('FiraCode')).toEqual([
      path.join(getNerdFontsDir(), 'FiraCodeNerdFont-Regular.ttf'),
    ]);
  });

  it('cannot tell a font apart with neither an archive nor a record', async () => {
    expect(await installedFontFiles('FiraCode')).toBeNull();
  });

  it('keeps a recorded name inside the fonts folder', async () => {
    recordFontFiles('Hack', ['../../.bashrc']);
    fs.writeFileSync(path.join(home, '.bashrc'), 'x');

    expect(await installedFontFiles('Hack')).toEqual([]);
  });
});
