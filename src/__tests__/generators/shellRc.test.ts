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

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

import * as fs from 'node:fs';
import { getShell, posixShellQuote } from '../../config/shells.ts';
import { getShellConfigPath } from '../../generators/configPaths.ts';
import { hasManagedRcBlock } from '../../generators/rcInit.ts';
import {
  removeManagedRcBlocks,
  removeShellConfigFile,
  resetSharedShellConfig,
  writeSharedConfig,
  writeShellConfig,
} from '../../generators/shellRc.ts';
import { restoreEnv } from '../helpers/env.ts';
import { expectBefore, lastWrittenContent } from '../helpers/rcWrites.ts';

const expectedConfigPath = path.join(os.homedir(), '.config', 'starship', 'zsh.toml');
const expectedConfigDir = path.join(os.homedir(), '.config', 'starship');
const ownBin = posixShellQuote(path.join(os.homedir(), '.local', 'bin'));

beforeEach(() => {
  vi.stubEnv('XDG_CONFIG_HOME', undefined);
  vi.stubEnv('ZDOTDIR', undefined);
  vi.stubEnv('STARSHIP_CONFIG', undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('writeShellConfig', () => {
  const savedEnv = { ...process.env };
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.STARSHIP_CONFIG;
    delete process.env.XDG_CONFIG_HOME;
  });
  afterEach(() => {
    restoreEnv(savedEnv);
  });

  it('writes toml content to the per-shell config path', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const toml = '[character]\nsuccess_symbol = "❯"';

    const result = writeShellConfig(toml, 'zsh');

    // The content goes to a temp file that is renamed over the target.
    const tmpPath = expect.stringMatching(
      new RegExp(`/\\.${escapeRegExp(path.basename(expectedConfigPath))}\\.\\d+\\.[0-9a-f]+\\.tmp$`)
    );
    expect(fs.writeFileSync).toHaveBeenCalledWith(tmpPath, toml, {
      encoding: 'utf8',
      flush: true,
    });
    expect(fs.renameSync).toHaveBeenCalledWith(tmpPath, expectedConfigPath);
    expect(result.path).toBe(expectedConfigPath);
  });

  it('writes through a symlinked target and keeps its permissions', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.lstatSync).mockReturnValueOnce({ isSymbolicLink: () => true } as never);
    vi.mocked(fs.realpathSync).mockReturnValueOnce('/dotfiles/zsh.toml' as never);
    vi.mocked(fs.statSync).mockReturnValueOnce({ mode: 0o100600 } as never);

    writeShellConfig('x', 'zsh');

    const tmp = vi.mocked(fs.writeFileSync).mock.calls[0]![0] as string;
    expect(path.dirname(tmp)).toBe('/dotfiles');
    expect(fs.chmodSync).toHaveBeenCalledWith(tmp, 0o600);
    expect(fs.renameSync).toHaveBeenCalledWith(tmp, '/dotfiles/zsh.toml');
  });

  it('refuses a dangling symlink instead of replacing it', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.lstatSync).mockReturnValueOnce({ isSymbolicLink: () => true } as never);
    vi.mocked(fs.realpathSync).mockImplementationOnce(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });

    expect(() => writeShellConfig('x', 'zsh')).toThrow('symlink to a file that does not exist');
    expect(fs.renameSync).not.toHaveBeenCalled();
  });

  it('refuses a read-only file instead of rewriting it', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.lstatSync).mockReturnValueOnce({ isSymbolicLink: () => false } as never);
    vi.mocked(fs.accessSync).mockImplementationOnce(() => {
      throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
    });

    expect(() => writeShellConfig('x', 'zsh')).toThrow('EACCES');
    expect(fs.renameSync).not.toHaveBeenCalled();
  });

  it('writes to the XDG location when one is configured', () => {
    process.env.XDG_CONFIG_HOME = '/home/u/.dotfiles/config';
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const result = writeShellConfig('x', 'fish');

    const expected = path.join('/home/u/.dotfiles/config', 'starship', 'fish.toml');
    expect(fs.renameSync).toHaveBeenCalledWith(expect.stringContaining('.tmp'), expected);
    expect(result.path).toBe(expected);
  });

  it('overwrites an existing per-shell config without copying it aside', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    writeShellConfig('new content', 'zsh');

    expect(fs.copyFileSync).not.toHaveBeenCalled();
    expect(fs.renameSync).toHaveBeenCalledWith(expect.stringContaining('.tmp'), expectedConfigPath);
  });

  it('creates the per-shell config directory when it does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    writeShellConfig('', 'zsh');

    expect(fs.mkdirSync).toHaveBeenCalledWith(expectedConfigDir, { recursive: true });
  });

  it('skips mkdir when the per-shell config directory already exists', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    writeShellConfig('', 'zsh');

    expect(fs.mkdirSync).not.toHaveBeenCalled();
  });
});

describe('writeSharedConfig', () => {
  const savedEnv = { ...process.env };
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.STARSHIP_CONFIG;
    delete process.env.XDG_CONFIG_HOME;
  });
  afterEach(() => {
    restoreEnv(savedEnv);
  });

  const sharedPath = path.join(os.homedir(), '.config', 'starship.toml');

  it('writes toml content to the shared config path', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = writeSharedConfig('[character]\nsuccess_symbol = "…"');

    expect(result.path).toBe(sharedPath);
    expect(fs.renameSync).toHaveBeenCalledWith(expect.stringContaining('.tmp'), sharedPath);
  });

  it('creates the config directory when it is missing', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    writeSharedConfig('# imported');

    expect(fs.mkdirSync).toHaveBeenCalledWith(path.dirname(sharedPath), { recursive: true });
  });

  const originalPath = `${sharedPath}.pre-shell-configurator`;

  it('keeps an existing shared config as its original before the first overwrite', () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => p !== originalPath);
    vi.mocked(fs.readFileSync).mockReturnValue('# mine\n');

    writeSharedConfig('# imported');

    expect(fs.copyFileSync).toHaveBeenCalledWith(
      sharedPath,
      originalPath,
      fs.constants.COPYFILE_EXCL
    );
    const copyOrder = vi.mocked(fs.copyFileSync).mock.invocationCallOrder[0]!;
    const writeOrder = vi.mocked(fs.writeFileSync).mock.invocationCallOrder[0]!;
    expect(copyOrder).toBeLessThan(writeOrder);
  });

  it('leaves an original that is already there alone', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('# mine\n');

    writeSharedConfig('# imported');

    expect(fs.copyFileSync).not.toHaveBeenCalled();
  });

  it('keeps no original when there is no shared config yet', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    writeSharedConfig('# imported');

    expect(fs.copyFileSync).not.toHaveBeenCalled();
  });
});

describe('resetSharedShellConfig', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Clear any mock implementation left behind by an earlier test (e.g. the
    // applyShellConfig test that makes mkdirSync throw).
    vi.mocked(fs.mkdirSync).mockReset();
  });

  it('unsets STARSHIP_CONFIG so the shell falls back to the shared config', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => '');

    const result = resetSharedShellConfig('bash');

    expect(result.applied).toBe(true);
    const written = lastWrittenContent();
    expect(written).toContain('unset STARSHIP_CONFIG');
    expect(written).toContain('# Added by ShellConfigurator');
    expect(fs.renameSync).toHaveBeenCalled();
  });

  it('puts the unset guard above the init line of an adopt block', () => {
    const adopt = '# Added by ShellConfigurator (shared config)\neval "$(starship init bash)"\n';
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => adopt);

    const result = resetSharedShellConfig('bash');

    expect(result.applied).toBe(true);
    expect(lastWrittenContent()).toBe(
      '# Added by ShellConfigurator (shared config)\nunset STARSHIP_CONFIG\neval "$(starship init bash)"\n'
    );
  });

  it('uses fish syntax for the unset line', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => '');

    resetSharedShellConfig('fish');

    const written = lastWrittenContent();
    expect(written).toContain('set -e STARSHIP_CONFIG');
    expect(written).not.toContain('unset STARSHIP_CONFIG');
  });

  it('is idempotent — skips when the unset line is already present', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => 'unset STARSHIP_CONFIG\n');

    const result = resetSharedShellConfig('bash');

    expect(result.applied).toBe(false);
    expect(result.note).toBe('already configured');
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('points a shell an earlier run wired per-shell back at the shared config', () => {
    const original = `# Existing content\n# Added by ShellConfigurator\nexport PATH=${ownBin}:"$PATH"\nexport STARSHIP_CONFIG='${expectedConfigPath}'\neval "$(starship init zsh)"\n`;
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => original);

    expect(resetSharedShellConfig('zsh')).toEqual({ applied: true });
    const written = lastWrittenContent();
    expect(written).not.toContain('export STARSHIP_CONFIG');
    expect(written).toContain(`export PATH=${ownBin}:"$PATH"`);
    expect(written.match(/starship init zsh/g)).toHaveLength(1);
    expectBefore(written, 'unset STARSHIP_CONFIG', 'starship init');

    vi.mocked(fs.writeFileSync).mockClear();
    vi.mocked(fs.readFileSync).mockImplementation(() => written);
    expect(resetSharedShellConfig('zsh')).toEqual({ applied: false, note: 'already configured' });
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it.each([
    ['bash', 'export STARSHIP_CONFIG=~/my-starship.toml\n'],
    ['bash', 'STARSHIP_CONFIG="$HOME/s.toml"\n'],
    ['fish', 'set -Ux STARSHIP_CONFIG ~/my-starship.toml\n'],
    ['fish', 'set -g -x STARSHIP_CONFIG ~/my-starship.toml\n'],
    ['fish', 'set --global --export STARSHIP_CONFIG ~/my-starship.toml\n'],
  ] as const)("does not override a user's own %s export", (shell, rc) => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => rc);

    const result = resetSharedShellConfig(shell);

    expect(result.applied).toBe(false);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('treats an unexported fish set as no export of its own', () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => !String(p).endsWith('starship.fish'));
    vi.mocked(fs.readFileSync).mockImplementation(
      () => 'set -g STARSHIP_CONFIG ~/mine.toml\nstarship init fish | source\n'
    );

    expect(resetSharedShellConfig('fish')).toEqual({ applied: true });
    expect(lastWrittenContent()).toContain('set -e STARSHIP_CONFIG');
  });

  it("drops a stale unset guard that would cancel the shell's own export", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(
      () =>
        'set -gx STARSHIP_CONFIG ~/mine.toml\nstarship init fish | source\n\n# Added by ShellConfigurator\nset -e STARSHIP_CONFIG\n'
    );

    const result = resetSharedShellConfig('fish');

    expect(result).toEqual({ applied: true, note: 'sets its own STARSHIP_CONFIG' });
    const written = lastWrittenContent();
    expect(written).toContain('set -gx STARSHIP_CONFIG ~/mine.toml');
    expect(written).toContain('starship init fish | source');
    expect(written).not.toContain('set -e STARSHIP_CONFIG');
  });

  it('ignores a commented-out export when deciding to add the guard', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => '# export STARSHIP_CONFIG=x\n');

    expect(resetSharedShellConfig('bash').applied).toBe(true);
  });

  it('returns a manual note for shells without an rc file', () => {
    const result = resetSharedShellConfig('nushell');

    expect(result.applied).toBe(false);
    expect(result.note).toBeTruthy();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('creates the rc parent directory when it does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.readFileSync).mockImplementation(() => '');

    resetSharedShellConfig('fish');

    expect(fs.mkdirSync).toHaveBeenCalled();
  });
});

describe('removing ShellConfigurator lines', () => {
  const bashrc = getShell('bash')!.rcFile!;

  function rcHolds(content: string): void {
    vi.mocked(fs.existsSync).mockImplementation((p) => p === bashrc);
    vi.mocked(fs.readFileSync).mockImplementation(() => content);
  }

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(fs.mkdirSync).mockReset();
  });

  it('finds a managed block', () => {
    const io = {
      exists: () => true,
      readFile: () => 'alias ll=ls\n\n# Added by ShellConfigurator\neval "$(starship init bash)"\n',
    };
    expect(hasManagedRcBlock('bash', io)).toBe(true);
  });

  it('finds nothing in an rc without a managed block, a missing rc or a manual shell', () => {
    expect(
      hasManagedRcBlock('bash', {
        exists: () => true,
        readFile: () => 'eval "$(starship init bash)"\n',
      })
    ).toBe(false);
    expect(hasManagedRcBlock('bash', { exists: () => false, readFile: () => '' })).toBe(false);
    expect(
      hasManagedRcBlock('nushell', {
        exists: () => true,
        readFile: () => '# Added by ShellConfigurator\n',
      })
    ).toBe(false);
  });

  it('restores the rc a fresh install appended to, without copying it aside', () => {
    rcHolds(
      `alias ll=ls\n\n# Added by ShellConfigurator\nexport STARSHIP_CONFIG='/h/.config/starship/bash.toml'\neval "$(starship init bash)"\n`
    );

    const result = removeManagedRcBlocks('bash');

    expect(result.removed).toBe(true);
    expect(fs.copyFileSync).not.toHaveBeenCalled();
    expect(lastWrittenContent()).toBe('alias ll=ls\n');
    expect(result.note).toBeUndefined();
  });

  it('removes adopt blocks and unset guards too', () => {
    rcHolds(
      '# Added by ShellConfigurator (shared config)\neval "$(starship init bash)"\n\n# Added by ShellConfigurator\nunset STARSHIP_CONFIG\n'
    );

    removeManagedRcBlocks('bash');

    expect(lastWrittenContent()).not.toContain('ShellConfigurator');
    expect(lastWrittenContent()).not.toContain('starship');
  });

  it("keeps the user's own init line and the PATH line it needs", () => {
    rcHolds(
      `# Added by ShellConfigurator\nexport PATH=${ownBin}:"$PATH"\nexport STARSHIP_CONFIG='/h/s.toml'\n\neval "$(starship init bash)"\n`
    );

    const result = removeManagedRcBlocks('bash');

    expect(lastWrittenContent()).toBe(
      `export PATH=${ownBin}:"$PATH"\neval "$(starship init bash)"\n`
    );
    expect(result.note).toBe('your own Starship init line stays; kept the PATH line it needs');
  });

  it('keeps the PATH line a fish conf.d init still needs', () => {
    const fishRc = getShell('fish')!.rcFile!;
    const confD = path.join(path.dirname(fishRc), 'conf.d', 'starship.fish');
    vi.mocked(fs.existsSync).mockImplementation((p) => p === fishRc || p === confD);
    vi.mocked(fs.readFileSync).mockImplementation(
      () =>
        `set -g fish_greeting\n\n# Added by ShellConfigurator\nfish_add_path ${ownBin}\nset -gx STARSHIP_CONFIG '/h/fish.toml'\n`
    );

    const result = removeManagedRcBlocks('fish');

    expect(lastWrittenContent()).toBe(`set -g fish_greeting\nfish_add_path ${ownBin}\n`);
    expect(result.note).toBe('your conf.d/starship.fish init stays; kept the PATH line it needs');
  });

  it('keeps lines of the user written right under the block', () => {
    rcHolds(
      `export EDITOR=vim\n\n# Added by ShellConfigurator\nexport STARSHIP_CONFIG='/h/bash.toml'\neval "$(starship init bash)"\nexport PATH="$HOME/go/bin:$PATH"\nexport PATH="$HOME/.local/bin:$PATH"\nalias gs="git status"\n`
    );

    removeManagedRcBlocks('bash');

    expect(lastWrittenContent()).toBe(
      `export EDITOR=vim\n\nexport PATH="$HOME/go/bin:$PATH"\nexport PATH="$HOME/.local/bin:$PATH"\nalias gs="git status"\n`
    );
  });

  it("keeps the user's own export and init line right under a block", () => {
    rcHolds(
      `# Added by ShellConfigurator\nunset STARSHIP_CONFIG\nexport STARSHIP_CONFIG=~/dots/starship.toml\neval "$(starship init bash)"\n`
    );

    const result = removeManagedRcBlocks('bash');

    expect(lastWrittenContent()).toBe(
      `export STARSHIP_CONFIG=~/dots/starship.toml\neval "$(starship init bash)"\n`
    );
    expect(result.note).toBe('your own Starship init line stays');
  });

  it.each([
    `export PATH='/home/other/.local/bin':"$PATH"`,
    'export PATH="/home/other/.local/bin:$PATH"',
  ])('removes a whole block whose PATH line names another home folder: %s', (pathLine) => {
    rcHolds(
      `# Added by ShellConfigurator\n${pathLine}\nexport STARSHIP_CONFIG='/h/bash.toml'\neval "$(starship init bash)"\n`
    );

    removeManagedRcBlocks('bash');

    expect(lastWrittenContent()).toBe('');
  });

  it('still removes a PATH line written by a version before 1.3.0', () => {
    const bin = path.join(os.homedir(), '.local', 'bin');
    rcHolds(
      `# Added by ShellConfigurator\nexport PATH="${bin}:$PATH"\nexport STARSHIP_CONFIG="/h/bash.toml"\neval "$(starship init bash)"\n`
    );

    removeManagedRcBlocks('bash');

    expect(lastWrittenContent()).toBe('');
  });

  it('writes nothing when the rc has no managed block', () => {
    rcHolds('eval "$(starship init bash)"\n');

    expect(removeManagedRcBlocks('bash')).toEqual({
      removed: false,
      note: `no ShellConfigurator lines in ${bashrc}`,
    });
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('reports a missing rc and a manual shell without touching anything', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    expect(removeManagedRcBlocks('bash')).toEqual({
      removed: false,
      note: `${bashrc} does not exist`,
    });
    expect(removeManagedRcBlocks('nushell')).toEqual({ removed: false, note: 'no rc file' });
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('deletes a generated per-shell config without keeping a copy', () => {
    const config = getShellConfigPath('zsh');
    vi.mocked(fs.existsSync).mockImplementation((p) => p === config);
    vi.mocked(fs.readFileSync).mockReturnValue('# Generated by ShellConfigurator\n');

    expect(removeShellConfigFile('zsh')).toEqual({ removed: true });
    expect(fs.copyFileSync).not.toHaveBeenCalled();
    expect(fs.rmSync).toHaveBeenCalledWith(config);
  });

  it('keeps the original of a hand-written per-shell config before deleting it', () => {
    const config = getShellConfigPath('zsh');
    vi.mocked(fs.existsSync).mockImplementation((p) => p === config);
    vi.mocked(fs.readFileSync).mockReturnValue('format = "$all"\n');

    removeShellConfigFile('zsh');

    expect(fs.copyFileSync).toHaveBeenCalledWith(
      config,
      `${config}.pre-shell-configurator`,
      fs.constants.COPYFILE_EXCL
    );
    const copyOrder = vi.mocked(fs.copyFileSync).mock.invocationCallOrder[0]!;
    const removeOrder = vi.mocked(fs.rmSync).mock.invocationCallOrder[0]!;
    expect(copyOrder).toBeLessThan(removeOrder);
  });

  it('leaves a missing per-shell config alone', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    expect(removeShellConfigFile('zsh').removed).toBe(false);
    expect(fs.rmSync).not.toHaveBeenCalled();
  });
});
