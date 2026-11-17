import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getShellConfigPath } from '../../generators/configPaths.ts';
import { restoreEnv } from '../helpers/env.ts';

const expectedConfigPath = path.join(os.homedir(), '.config', 'starship', 'zsh.toml');

beforeEach(() => {
  vi.stubEnv('XDG_CONFIG_HOME', undefined);
  vi.stubEnv('ZDOTDIR', undefined);
  vi.stubEnv('STARSHIP_CONFIG', undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getShellConfigPath', () => {
  const savedEnv = { ...process.env };
  afterEach(() => {
    restoreEnv(savedEnv);
  });

  it('defaults to starship/<shell>.toml inside ~/.config', () => {
    delete process.env.STARSHIP_CONFIG;
    delete process.env.XDG_CONFIG_HOME;
    expect(getShellConfigPath('zsh')).toBe(expectedConfigPath);
  });

  it('uses the shell id for the file name', () => {
    delete process.env.STARSHIP_CONFIG;
    delete process.env.XDG_CONFIG_HOME;
    expect(getShellConfigPath('bash')).toBe(
      path.join(os.homedir(), '.config', 'starship', 'bash.toml')
    );
  });

  it('honours XDG_CONFIG_HOME', () => {
    delete process.env.STARSHIP_CONFIG;
    process.env.XDG_CONFIG_HOME = '/home/u/.dotfiles/config';
    expect(getShellConfigPath('zsh')).toBe(
      path.join('/home/u/.dotfiles/config', 'starship', 'zsh.toml')
    );
  });
});
