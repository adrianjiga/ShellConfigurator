import { execFileSync } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getShell, SHELLS, setupCommand } from '../../config/shells.ts';

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

describe('setupCommand', () => {
  it('drops the per-shell pin for the manual shells in adopt mode', () => {
    const nu = getShell('nushell')!;
    const pwsh = getShell('powershell')!;

    expect(setupCommand(nu, false)).toContain('STARSHIP_CONFIG');
    expect(setupCommand(nu, true)).not.toContain('STARSHIP_CONFIG');
    expect(setupCommand(nu, true)).toContain('rm -f');
    expect(setupCommand(pwsh, true)).toBe('Invoke-Expression (&starship init powershell)');
  });

  it('keeps the rc init line for shells with an rc file', () => {
    const zsh = getShell('zsh')!;
    expect(setupCommand(zsh, true)).toBe(zsh.initLine);
  });
});

describe('STARSHIP_CONFIG syntax', () => {
  it('is defined for exactly the shells with an rc file', () => {
    for (const shell of SHELLS) {
      expect(Boolean(shell.configEnv), shell.id).toBe(shell.rcFile !== null);
    }
  });
});

describe('Nushell setup command', () => {
  it('hands Nushell the exact config path, even one with quotes and backslashes', () => {
    vi.stubEnv('XDG_CONFIG_HOME', "/home/o'brien\\x/.config");
    const command = getShell('nushell')!.initLine;
    expect(command.startsWith('nu -c ')).toBe(true);

    const program = execFileSync('bash', ['-c', command.replace(/^nu -c /, 'printf %s ')], {
      encoding: 'utf8',
    });

    expect(program).toContain(
      `"export-env { $env.STARSHIP_CONFIG = \\"/home/o'brien\\\\\\\\x/.config/starship/nushell.toml\\" }"`
    );
  });
});
