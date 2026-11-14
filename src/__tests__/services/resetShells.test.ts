import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getShell } from '../../config/shells.ts';
import {
  applyShellConfig,
  getShellConfigPath,
  keepsOwnConfig,
  resetRcContent,
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
