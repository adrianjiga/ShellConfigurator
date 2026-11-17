import * as os from 'node:os';
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

import { getShell } from '../../config/shells.ts';
import {
  initReachable,
  shellsWithStarshipInit,
  sourcedFiles,
  startsStarship,
} from '../../generators/rcInit.ts';
import { appliedRcContent, starshipConfigLine } from '../../generators/rcPlan.ts';

beforeEach(() => {
  vi.stubEnv('XDG_CONFIG_HOME', undefined);
  vi.stubEnv('ZDOTDIR', undefined);
  vi.stubEnv('STARSHIP_CONFIG', undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('shellsWithStarshipInit', () => {
  const rcFile = (shellId: 'zsh' | 'fish') => getShell(shellId)!.rcFile!;

  function io(files: Record<string, string>) {
    return {
      exists: (filePath: string) => filePath in files,
      readFile: (filePath: string) => files[filePath],
    };
  }

  it('keeps shells whose rc runs starship', () => {
    expect(
      shellsWithStarshipInit(
        ['zsh', 'fish'],
        io({
          [rcFile('zsh')]: 'eval "$(starship init zsh)"\n',
          [rcFile('fish')]: 'set -gx EDITOR vim\n',
        })
      )
    ).toEqual(['zsh']);
  });

  it('sees fish loading starship from its conf.d drop-in', () => {
    expect(
      shellsWithStarshipInit(
        ['fish'],
        io({
          [rcFile('fish')]: '',
          [path.join(path.dirname(rcFile('fish')), 'conf.d', 'starship.fish')]: '',
        })
      )
    ).toEqual(['fish']);
  });

  it('ignores commented-out init lines, missing rc files and read errors', () => {
    const throwing = {
      exists: () => true,
      readFile: () => {
        throw new Error('EACCES');
      },
    };
    expect(shellsWithStarshipInit(['zsh'], throwing)).toEqual([]);
    expect(
      shellsWithStarshipInit(
        ['zsh', 'bash'],
        io({ [rcFile('zsh')]: '# eval "$(starship init zsh)"\n' })
      )
    ).toEqual([]);
  });
});

describe('startsStarship', () => {
  const managed = '# Added by ShellConfigurator\neval "$(starship init zsh)"\n';
  const rcIo = (content: string, extra: string[] = []) => ({
    exists: (p: string) => p === getShell('zsh')!.rcFile! || extra.includes(p),
    readFile: () => content,
  });

  it('counts a managed init until its blocks are removed', () => {
    expect(startsStarship('zsh', false, rcIo(managed))).toBe(true);
    expect(startsStarship('zsh', true, rcIo(managed))).toBe(false);
  });

  it("counts the user's own init line either way", () => {
    const own = `eval "$(starship init zsh)"\n\n${managed}`;
    expect(startsStarship('zsh', true, rcIo(own))).toBe(true);
  });

  it('counts a fish conf.d init, which uninstall never removes', () => {
    const fishRc = getShell('fish')!.rcFile!;
    const confD = path.join(path.dirname(fishRc), 'conf.d', 'starship.fish');
    const io = { exists: (p: string) => p === confD, readFile: () => '' };
    expect(startsStarship('fish', true, io)).toBe(true);
  });

  it('counts a hand-applied Nushell setup', () => {
    const nu = getShell('nushell')!;
    const io = { exists: (p: string) => p === nu.initPath, readFile: () => '' };
    expect(startsStarship('nushell', true, io)).toBe(true);
    expect(startsStarship('nushell', true, { exists: () => false, readFile: () => '' })).toBe(
      false
    );
  });

  it('is false for a shell with no rc', () => {
    expect(startsStarship('zsh', false, { exists: () => false, readFile: () => '' })).toBe(false);
  });
});

describe('a Starship init in a sourced file, as on Omarchy', () => {
  const env = { OMARCHY_PATH: '/usr/share/omarchy', HOME: os.homedir() };
  const BASHRC = [
    '[[ -r /usr/share/omarchy/default/bash/env-bootstrap ]] && source /usr/share/omarchy/default/bash/env-bootstrap',
    '[[ $- != *i* ]] && return',
    'source "$OMARCHY_PATH/default/bash/rc"',
    '',
  ].join('\n');
  const files = new Map([
    ['/usr/share/omarchy/default/bash/env-bootstrap', 'export OMARCHY_PATH=/usr/share/omarchy\n'],
    [
      '/usr/share/omarchy/default/bash/rc',
      `source $OMARCHY_PATH/default/bash/aliases\n. "${'$'}{OMARCHY_PATH}/default/bash/init"\n`,
    ],
    ['/usr/share/omarchy/default/bash/aliases', "alias ls='eza'\n"],
    [
      '/usr/share/omarchy/default/bash/init',
      'if command -v starship &> /dev/null; then\n  eval "$(starship init bash)"\nfi\n',
    ],
  ]);
  const io = {
    exists: (file: string) => files.has(file),
    readFile: (file: string) => files.get(file) ?? '',
  };

  it('lists the files a script sources, expanded, leaving out comments and unknown variables', () => {
    expect(
      sourcedFiles(
        `${BASHRC}# source /commented\nsource $NOT_SET/x\n. ~/.bash_aliases\nsource relative.sh\n`,
        env
      )
    ).toEqual([
      '/usr/share/omarchy/default/bash/env-bootstrap',
      '/usr/share/omarchy/default/bash/rc',
      path.join(os.homedir(), '.bash_aliases'),
    ]);
  });

  it('finds the init two files down, and stops at three levels and at cycles', () => {
    expect(initReachable(BASHRC, 'bash', io, env)).toBe(true);
    expect(initReachable(BASHRC, 'zsh', io, env)).toBe(false);
    const deep = new Map([
      ['/a', 'source /b\n'],
      ['/b', 'source /c\n'],
      ['/c', 'source /d\n'],
      ['/d', 'eval "$(starship init bash)"\n'],
    ]);
    const deepIo = { exists: (f: string) => deep.has(f), readFile: (f: string) => deep.get(f)! };
    expect(initReachable('source /a\n', 'bash', deepIo, env)).toBe(false);
    expect(initReachable('source /b\n', 'bash', deepIo, env)).toBe(true);
    const loop = new Map([
      ['/x', 'source /y\n'],
      ['/y', 'source /x\n'],
    ]);
    const reads: string[] = [];
    const loopIo = {
      exists: (f: string) => loop.has(f),
      readFile: (f: string) => {
        reads.push(f);
        return loop.get(f)!;
      },
    };
    expect(initReachable('source /x\n', 'bash', loopIo, env)).toBe(false);
    expect(reads).toEqual(['/x', '/y']);
  });

  it('counts such a shell as starting Starship, and adds no second init line to it', () => {
    vi.stubEnv('OMARCHY_PATH', '/usr/share/omarchy');
    const rc = getShell('bash')!.rcFile!;
    const withRc = {
      exists: (file: string) => file === rc || files.has(file),
      readFile: (file: string) => (file === rc ? BASHRC : (files.get(file) ?? '')),
    };
    try {
      expect(shellsWithStarshipInit(['bash'], withRc)).toEqual(['bash']);
      expect(startsStarship('bash', false, withRc)).toBe(true);
      const planned = appliedRcContent('bash', BASHRC, {}, withRc)!;
      expect(planned.content).not.toContain('starship init bash');
      expect(planned.content).toContain(starshipConfigLine('bash'));
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
