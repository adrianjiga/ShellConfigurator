import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getShell } from '../../config/shells.ts';

afterEach(() => vi.unstubAllEnvs());

describe('shell rc paths', () => {
  it('puts .zshrc in ZDOTDIR when it is set', () => {
    vi.stubEnv('ZDOTDIR', '/home/u/.config/zsh');
    expect(getShell('zsh')?.rcFile).toBe(path.join('/home/u/.config/zsh', '.zshrc'));
  });

  it('ignores a relative ZDOTDIR', () => {
    vi.stubEnv('ZDOTDIR', 'zsh');
    expect(getShell('zsh')?.rcFile).toBe(path.join(os.homedir(), '.zshrc'));
  });

  it('puts the fish and PowerShell files under XDG_CONFIG_HOME', () => {
    vi.stubEnv('XDG_CONFIG_HOME', '/home/u/.xdg');
    expect(getShell('fish')?.rcFile).toBe(path.join('/home/u/.xdg', 'fish', 'config.fish'));
    expect(getShell('powershell')?.initPath).toBe(
      path.join('/home/u/.xdg', 'powershell', 'Microsoft.PowerShell_profile.ps1')
    );
  });
});
