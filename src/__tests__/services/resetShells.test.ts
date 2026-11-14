import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getShell } from '../../config/shells.ts';
import {
  applyShellConfig,
  getShellConfigPath,
  keepsOwnConfig,
  removeManagedRcBlocks,
  resetRcContent,
  resetSharedShellConfig,
  writeShellConfig,
} from '../../generators/shellRc.ts';
import { DEFAULT_INSTALL_TASK_DEPS, plannedResetShells } from '../../services/installTasks.ts';
import { DEFAULT_STATE } from '../../types.ts';

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'shellconf-reset-'));
  vi.stubEnv('HOME', home);
  vi.stubEnv('XDG_CONFIG_HOME', undefined);
  vi.stubEnv('ZDOTDIR', undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

function setUp(shellId: 'fish' | 'zsh'): void {
  writeShellConfig('format = "$character"\n', shellId);
  applyShellConfig(shellId);
}

describe('a later run that selects other shells', () => {
  it('leaves a shell set up in an earlier run alone, so it keeps its own prompt', () => {
    setUp('fish');
    const configFish = getShell('fish')!.rcFile!;
    const before = fs.readFileSync(configFish, 'utf8');

    const resets = plannedResetShells({
      ...DEFAULT_STATE,
      installedShells: ['zsh', 'fish'],
      selectedShells: ['zsh'],
    });

    expect(resets).toEqual([]);
    expect(keepsOwnConfig('fish')).toBe(true);
    expect(fs.readFileSync(configFish, 'utf8')).toBe(before);
  });

  it('leaves alone a shell set up by a version that double-quoted the export', () => {
    writeShellConfig('format = "$character"\n', 'bash');
    fs.writeFileSync(
      path.join(home, '.bashrc'),
      `# Added by ShellConfigurator\nexport STARSHIP_CONFIG="${getShellConfigPath('bash')}"\neval "$(starship init bash)"\n`
    );

    expect(keepsOwnConfig('bash')).toBe(true);
    expect(
      plannedResetShells({
        ...DEFAULT_STATE,
        installedShells: ['zsh', 'bash'],
        selectedShells: ['zsh'],
      })
    ).toEqual([]);
  });

  it('runs the same check in a real run as in the plan', async () => {
    const detect = vi
      .spyOn(await import('../../services/detector.ts'), 'detectInstalledShellsAsync')
      .mockResolvedValue(['bash', 'fish']);
    setUp('fish');
    fs.writeFileSync(path.join(home, '.bashrc'), 'eval "$(starship init bash)"\n');

    expect(await DEFAULT_INSTALL_TASK_DEPS.getShellsUsingStarship()).toEqual(['bash']);
    expect(detect).toHaveBeenCalled();
  });

  it('still points back a shell whose own config file is gone', () => {
    setUp('fish');
    fs.rmSync(getShellConfigPath('fish'));

    expect(keepsOwnConfig('fish')).toBe(false);
    expect(
      plannedResetShells({
        ...DEFAULT_STATE,
        installedShells: ['zsh', 'fish'],
        selectedShells: ['zsh'],
      })
    ).toEqual(['fish']);
  });

  it('still guards a shell that starts Starship without a setup of its own', () => {
    const configFish = getShell('fish')!.rcFile!;
    fs.mkdirSync(path.dirname(configFish), { recursive: true });
    fs.writeFileSync(configFish, 'starship init fish | source\n');

    expect(keepsOwnConfig('fish')).toBe(false);
    expect(
      plannedResetShells({
        ...DEFAULT_STATE,
        installedShells: ['zsh', 'fish'],
        selectedShells: ['zsh'],
      })
    ).toEqual(['fish']);
  });
});

describe("a setting of the user's own", () => {
  const init = 'eval "$(starship init zsh)"\n';

  function guarded(rc: string): boolean {
    return resetRcContent('zsh', rc)!.content.includes('unset STARSHIP_CONFIG');
  }

  it('gets a guard when the shell has none', () => {
    expect(guarded(init)).toBe(true);
  });

  it.each([
    'typeset -x STARSHIP_CONFIG=$HOME/dots/starship.toml',
    'declare -x STARSHIP_CONFIG=$HOME/dots/starship.toml',
    "export STARSHIP_CONFIG='/dots/starship.toml'",
  ])('is kept when the rc sets it with %s', (line) => {
    expect(guarded(`${line}\n${init}`)).toBe(false);
  });

  it('is kept when it lives in a file the rc sources', () => {
    const env = path.join(home, '.zsh_env');
    fs.writeFileSync(env, 'export STARSHIP_CONFIG=~/dots/starship.toml\n');

    expect(guarded(`source ${env}\n${init}`)).toBe(false);
  });

  it.each(['.zshenv', '.zprofile'])('is kept when it lives in ~/%s', (name) => {
    fs.writeFileSync(path.join(home, name), 'export STARSHIP_CONFIG=~/dots/starship.toml\n');

    expect(guarded(init)).toBe(false);
  });

  it('is not mistaken for a commented-out line', () => {
    fs.writeFileSync(path.join(home, '.zshenv'), '# export STARSHIP_CONFIG=~/old.toml\n');

    expect(guarded(init)).toBe(true);
  });
});

describe('the blocks of many runs in a row', () => {
  it('stay whole, so uninstall takes every line it wrote back out', () => {
    const zshrc = path.join(home, '.zshrc');
    fs.writeFileSync(zshrc, 'export EDITOR=vim\n');
    writeShellConfig('format = "$character"\n', 'zsh');

    applyShellConfig('zsh');
    resetSharedShellConfig('zsh');
    applyShellConfig('zsh', { pointAtSharedConfig: true });
    resetSharedShellConfig('zsh');
    applyShellConfig('zsh');
    resetSharedShellConfig('zsh');
    applyShellConfig('zsh', { ensurePathDir: path.join(home, '.local', 'bin') });

    removeManagedRcBlocks('zsh');

    expect(fs.readFileSync(zshrc, 'utf8')).toBe('export EDITOR=vim\n');
  });
});

describe('a shell whose rc starts Starship from a file it sources', () => {
  let bashrc: string;
  const source = 'source ~/.config/shell/prompt.sh';

  beforeEach(() => {
    bashrc = path.join(home, '.bashrc');
    fs.mkdirSync(path.join(home, '.config', 'shell'), { recursive: true });
    fs.writeFileSync(
      path.join(home, '.config', 'shell', 'prompt.sh'),
      'eval "$(starship init bash)"\n'
    );
    fs.writeFileSync(bashrc, `export EDITOR=vim\n${source}\nalias ll='ls -l'\n`);
  });

  it('gets its PATH and STARSHIP_CONFIG lines above that source line, so the init sees them', () => {
    const bin = path.join(home, '.local', 'bin');
    applyShellConfig('bash', { ensurePathDir: bin });

    const lines = fs.readFileSync(bashrc, 'utf8').split('\n');
    const at = (start: string) => lines.findIndex((line) => line.startsWith(start));
    expect(at('export PATH=')).toBeGreaterThan(-1);
    expect(at('export PATH=')).toBeLessThan(at(source));
    expect(at('export STARSHIP_CONFIG=')).toBeLessThan(at(source));
    expect(lines.filter((line) => line.includes('starship init'))).toEqual([]);

    removeManagedRcBlocks('bash');
    expect(fs.readFileSync(bashrc, 'utf8')).toBe(
      `export EDITOR=vim\nexport PATH='${bin}':"$PATH"\n${source}\nalias ll='ls -l'\n`
    );
  });

  it('gets its unset guard above that source line', () => {
    resetSharedShellConfig('bash');

    const content = fs.readFileSync(bashrc, 'utf8');
    expect(content.indexOf('unset STARSHIP_CONFIG')).toBeLessThan(content.indexOf(source));
  });
});
