import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('fs', () => ({
  constants: { W_OK: 2 },
  lstatSync: vi.fn(),
  statSync: vi.fn(),
  realpathSync: vi.fn(),
  accessSync: vi.fn(),
  chmodSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  appendFileSync: vi.fn(),
  copyFileSync: vi.fn(),
  rmSync: vi.fn(),
}));

import * as fs from 'node:fs';
import { appliedRcContent, resetRcContent, starshipConfigLine } from '../../generators/rcPlan.ts';

beforeEach(() => {
  vi.stubEnv('XDG_CONFIG_HOME', undefined);
  vi.stubEnv('ZDOTDIR', undefined);
  vi.stubEnv('STARSHIP_CONFIG', undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('appliedRcContent and resetRcContent', () => {
  const noFiles = { exists: () => false, readFile: () => '' };
  const zshInit = 'eval "$(starship init zsh)"';

  it('return what the writers would write, without writing', () => {
    const applied = appliedRcContent('zsh', 'alias ll="ls -l"\n', {}, noFiles);
    expect(applied).toMatchObject({ applied: true });
    expect(applied!.content).toBe(
      `alias ll="ls -l"\n\n# Added by ShellConfigurator\n${starshipConfigLine('zsh')}\n${zshInit}\n`
    );

    const reset = resetRcContent('zsh', `${zshInit}\n`, noFiles);
    expect(reset).toEqual({
      content: `# Added by ShellConfigurator\nunset STARSHIP_CONFIG\n\n${zshInit}\n`,
      applied: true,
    });
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('leave the content as it is when the rc is already configured', () => {
    const configured = appliedRcContent('zsh', '', {}, noFiles)!.content;
    expect(appliedRcContent('zsh', configured, {}, noFiles)).toEqual({
      content: configured,
      applied: false,
      note: 'already configured',
    });
  });

  it("see fish's conf.d init through the given io", () => {
    const confD = {
      exists: (p: string) => p.endsWith(path.join('conf.d', 'starship.fish')),
      readFile: () => '',
    };
    expect(
      appliedRcContent('fish', '', { pointAtSharedConfig: true }, confD)!.content
    ).not.toContain('starship init fish');
  });

  it('are null for shells without an rc file', () => {
    expect(appliedRcContent('nushell', '', {}, noFiles)).toBeNull();
    expect(resetRcContent('powershell', '', noFiles)).toBeNull();
  });
});
