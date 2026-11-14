import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getShell } from '../../config/shells.ts';
import { stubPlatform } from '../helpers/platform.ts';

let home: string;
const zshrc = () => getShell('zsh')!.rcFile;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'shellconf-zdotdir-'));
  vi.stubEnv('HOME', home);
  vi.stubEnv('ZDOTDIR', undefined);
  vi.stubEnv('XDG_CONFIG_HOME', undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

describe('the zsh rc file', () => {
  it('is ~/.zshrc without a ZDOTDIR', () => {
    expect(zshrc()).toBe(path.join(home, '.zshrc'));
  });

  it.each([
    'ZDOTDIR=$HOME/.config/zsh',
    'export ZDOTDIR="${XDG_CONFIG_HOME:-$HOME/.config}/zsh"',
    'ZDOTDIR=~/.config/zsh # zsh reads its files from here',
  ])('follows a ZDOTDIR that ~/.zshenv sets without exporting it: %s', (line) => {
    fs.writeFileSync(path.join(home, '.zshenv'), `${line}\n`);
    expect(zshrc()).toBe(path.join(home, '.config', 'zsh', '.zshrc'));
  });

  it('prefers a ZDOTDIR in the environment', () => {
    fs.writeFileSync(path.join(home, '.zshenv'), 'ZDOTDIR=$HOME/.config/zsh\n');
    vi.stubEnv('ZDOTDIR', path.join(home, 'zdot'));
    expect(zshrc()).toBe(path.join(home, 'zdot', '.zshrc'));
  });

  it('falls back to ~/.zshrc when the setting names a variable it cannot know', () => {
    fs.writeFileSync(path.join(home, '.zshenv'), 'ZDOTDIR=$DOTFILES/zsh\n');
    expect(zshrc()).toBe(path.join(home, '.zshrc'));
  });
});

describe('the Nushell autoload folder', () => {
  it('follows XDG_DATA_HOME on macOS too, as Nushell does', () => {
    const restore = stubPlatform('darwin');
    try {
      vi.stubEnv('XDG_DATA_HOME', path.join(home, 'data'));
      expect(getShell('nushell')!.initPath).toBe(
        path.join(home, 'data', 'nushell', 'vendor', 'autoload', 'starship.nu')
      );
      vi.stubEnv('XDG_DATA_HOME', undefined);
      expect(getShell('nushell')!.initPath).toContain(path.join('Library', 'Application Support'));
    } finally {
      restore();
    }
  });
});
