import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

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

/** The content of the module's last atomic write (the temp-file write). */
function lastWrittenContent(): string {
  return vi.mocked(fs.writeFileSync).mock.calls.at(-1)?.[1] as string;
}

import * as fs from 'node:fs';
import { getShell } from '../../config/shells.ts';
import {
  applyShellConfig,
  backupPath,
  backupSharedConfig,
  getSharedConfigPath,
  getShellConfigPath,
  hasStarshipInit,
  plannedRcBlock,
  resetSharedShellConfig,
  restoreConfigBackups,
  shellsWithStarshipInit,
  writeSharedConfig,
  writeShellConfig,
} from '../../generators/shellRc.ts';

const expectedConfigPath = path.join(os.homedir(), '.config', 'starship', 'zsh.toml');
const expectedConfigDir = path.join(os.homedir(), '.config', 'starship');

describe('getShellConfigPath', () => {
  const savedEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...savedEnv };
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

describe('writeShellConfig', () => {
  const savedEnv = { ...process.env };
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.STARSHIP_CONFIG;
    delete process.env.XDG_CONFIG_HOME;
  });
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('writes toml content to the per-shell config path', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const toml = '[character]\nsuccess_symbol = "❯"';

    const result = writeShellConfig(toml, 'zsh');

    // The content goes to a temp file that is renamed over the target.
    const tmpPath = expect.stringMatching(
      new RegExp(`/\\.${path.basename(expectedConfigPath)}\\.\\d+\\.[0-9a-f]+\\.tmp$`)
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

  it('backs up an existing per-shell config before overwriting it', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const result = writeShellConfig('new content', 'zsh');

    expect(result.backedUpTo).toMatch(/zsh\.toml\.bak-/);
    expect(fs.copyFileSync).toHaveBeenCalledWith(expectedConfigPath, result.backedUpTo);
    // The backup must be taken before the overwrite, not after.
    const copyOrder = vi.mocked(fs.copyFileSync).mock.invocationCallOrder[0] ?? 0;
    const writeOrder = vi.mocked(fs.writeFileSync).mock.invocationCallOrder[0] ?? 0;
    expect(copyOrder).toBeLessThan(writeOrder);
  });

  it('does not back up when there is no existing config', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = writeShellConfig('', 'zsh');

    expect(fs.copyFileSync).not.toHaveBeenCalled();
    expect(result.backedUpTo).toBeUndefined();
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
    vi.clearAllMocks();
    delete process.env.STARSHIP_CONFIG;
    delete process.env.XDG_CONFIG_HOME;
  });
  afterEach(() => {
    process.env = { ...savedEnv };
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

  it('backs up an existing shared config before overwriting it', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const result = writeSharedConfig('# imported');

    expect(result.backedUpTo).toContain(sharedPath);
    expect(fs.copyFileSync).toHaveBeenCalledWith(sharedPath, expect.stringContaining(sharedPath));
  });

  it('does not back up when there is no existing shared config', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = writeSharedConfig('# imported');

    expect(result.backedUpTo).toBeUndefined();
    expect(fs.copyFileSync).not.toHaveBeenCalled();
  });
});

describe('shellsWithStarshipInit', () => {
  const rcFiles = {
    zsh: getShell('zsh')?.rcFile ?? '',
    fish: getShell('fish')?.rcFile ?? '',
  };

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
          [rcFiles.zsh]: 'eval "$(starship init zsh)"\n',
          [rcFiles.fish]: 'set -gx EDITOR vim\n',
        })
      )
    ).toEqual(['zsh']);
  });

  it('sees fish loading starship from its conf.d drop-in', () => {
    expect(
      shellsWithStarshipInit(
        ['fish'],
        io({
          [rcFiles.fish]: '',
          [path.join(path.dirname(rcFiles.fish), 'conf.d', 'starship.fish')]: '',
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
        io({ [rcFiles.zsh]: '# eval "$(starship init zsh)"\n' })
      )
    ).toEqual([]);
  });
});

describe('hasStarshipInit', () => {
  it('accepts every spelling of a shell init', () => {
    expect(hasStarshipInit('eval "$(starship init zsh)"', 'zsh')).toBe(true);
    expect(hasStarshipInit('source <(starship init zsh)', 'zsh')).toBe(true);
    expect(hasStarshipInit('eval "$(/opt/homebrew/bin/starship init zsh)"', 'zsh')).toBe(true);
    expect(hasStarshipInit('starship init fish | source', 'fish')).toBe(true);
  });

  it('ignores commented-out init lines', () => {
    expect(hasStarshipInit('# eval "$(starship init zsh)"', 'zsh')).toBe(false);
    expect(hasStarshipInit('  # starship init fish | source', 'fish')).toBe(false);
  });

  it('does not match another shell init', () => {
    expect(hasStarshipInit('eval "$(starship init bash)"', 'zsh')).toBe(false);
  });
});

describe('applyShellConfig', () => {
  beforeEach(() => vi.clearAllMocks());

  it('appends init line to shell rc file', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => '# existing content');

    const result = applyShellConfig('zsh');

    expect(result.applied).toBe(true);
    expect(lastWrittenContent()).toContain('starship init zsh');
    expect(fs.renameSync).toHaveBeenCalled();
  });

  it('points STARSHIP_CONFIG at the per-shell config before the init line', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => '');

    const result = applyShellConfig('zsh');

    expect(result.applied).toBe(true);
    const finalContent = lastWrittenContent();
    const expected = `export STARSHIP_CONFIG='${expectedConfigPath}'`;
    expect(finalContent).toContain(expected);
    // The env must be set before `starship init` runs.
    expect(finalContent.indexOf(expected)).toBeLessThan(finalContent.indexOf('starship init'));
  });

  it('drops a stale unset guard from a CRLF rc file', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(
      () => '# mine\r\n# Added by ShellConfigurator\r\nunset STARSHIP_CONFIG\r\n'
    );

    applyShellConfig('zsh');

    expect(lastWrittenContent()).not.toContain('unset STARSHIP_CONFIG');
  });

  it('replaces an export an earlier run wrote for a different config path', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(
      () =>
        '# Added by ShellConfigurator\nexport STARSHIP_CONFIG="/old/xdg/starship/zsh.toml"\neval "$(starship init zsh)"\n'
    );

    const result = applyShellConfig('zsh');

    expect(result.applied).toBe(true);
    const content = lastWrittenContent();
    expect(content).not.toContain('/old/xdg/');
    expect(content).toContain(`export STARSHIP_CONFIG='${expectedConfigPath}'`);
    expect(content.match(/starship init zsh/g)).toHaveLength(1);
  });

  it('leaves a user comment that only starts like the marker alone', () => {
    const own = '# Added by ShellConfigurator users: keep this\nunset STARSHIP_CONFIG\n';
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => own);

    applyShellConfig('zsh');

    expect(lastWrittenContent().startsWith(own)).toBe(true);
  });

  it("moves an earlier run's double-quoted export to the quoted form", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(
      () =>
        `# Added by ShellConfigurator\nexport STARSHIP_CONFIG="${expectedConfigPath}"\neval "$(starship init zsh)"\n`
    );

    expect(applyShellConfig('zsh').applied).toBe(true);
    const content = lastWrittenContent();
    expect(content).not.toContain(`STARSHIP_CONFIG="`);
    expect(content).toContain(`export STARSHIP_CONFIG='${expectedConfigPath}'`);
    expect(content.match(/starship init zsh/g)).toHaveLength(1);
  });

  it('quotes a path with spaces and dollar signs so the shell takes it literally', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => '');

    applyShellConfig('fish', { ensurePathDir: "/Users/J Doe/$bin/it's" });

    expect(lastWrittenContent()).toContain(`fish_add_path '/Users/J Doe/$bin/it'\\''s'`);
  });

  it('keeps the PATH line of a per-shell block when switching to adopt mode', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(
      () =>
        `# Added by ShellConfigurator\nexport PATH='/home/u/.local/bin':"$PATH"\nexport STARSHIP_CONFIG='${expectedConfigPath}'\neval "$(starship init zsh)"\n`
    );

    applyShellConfig('zsh', { pointAtSharedConfig: true });

    expect(lastWrittenContent()).toBe(
      `# Added by ShellConfigurator (shared config)\nexport PATH='/home/u/.local/bin':"$PATH"\neval "$(starship init zsh)"\n`
    );
  });

  it('keeps the closing fi of a user if-block wrapped around a removed block', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() =>
      [
        'if command -v starship >/dev/null; then',
        '# Added by ShellConfigurator',
        'unset STARSHIP_CONFIG',
        'fi',
        '',
      ].join('\n')
    );

    applyShellConfig('zsh');

    const content = lastWrittenContent();
    expect(content).not.toContain('unset STARSHIP_CONFIG');
    expect(content).toMatch(/then\nfi\n/);
  });

  it('uses fish syntax for the STARSHIP_CONFIG line', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => '');

    applyShellConfig('fish');

    const finalContent = lastWrittenContent();
    const expected = `set -gx STARSHIP_CONFIG '${path.join(os.homedir(), '.config', 'starship', 'fish.toml')}'`;
    expect(finalContent).toContain(expected);
  });

  it('omits the STARSHIP_CONFIG line when pointing at the shared config', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => '');

    const result = applyShellConfig('zsh', { pointAtSharedConfig: true });

    expect(result.applied).toBe(true);
    const finalContent = lastWrittenContent();
    expect(finalContent).not.toContain('STARSHIP_CONFIG');
    expect(finalContent).toContain('starship init zsh');
  });

  it('treats an rc that only has the init line as already configured in adopt mode', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => 'eval "$(starship init zsh)"');

    const result = applyShellConfig('zsh', { pointAtSharedConfig: true });

    expect(result.applied).toBe(false);
    expect(result.note).toBe('already configured');
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('adopt mode repairs an rc left pointing at a per-shell config', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() =>
      [
        '# Added by ShellConfigurator',
        `export STARSHIP_CONFIG='${expectedConfigPath}'`,
        'eval "$(starship init zsh)"',
      ].join('\n')
    );

    const result = applyShellConfig('zsh', { pointAtSharedConfig: true });

    expect(result.applied).toBe(true);
    const finalContent = lastWrittenContent();
    expect(finalContent).toContain('starship init zsh');
    expect(finalContent).not.toContain('STARSHIP_CONFIG');
  });

  it('stays idempotent across a second adopt run', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() =>
      ['# Added by ShellConfigurator (shared config)', 'eval "$(starship init zsh)"'].join('\n')
    );

    const result = applyShellConfig('zsh', { pointAtSharedConfig: true });

    expect(result.applied).toBe(false);
    expect(result.note).toBe('already configured');
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('non-adopt mode replaces an init-only block left by an adopt run', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() =>
      ['# Added by ShellConfigurator (shared config)', 'eval "$(starship init zsh)"'].join('\n')
    );

    const result = applyShellConfig('zsh');

    expect(result.applied).toBe(true);
    const finalContent = lastWrittenContent();
    expect(finalContent.indexOf('STARSHIP_CONFIG')).toBeLessThan(
      finalContent.indexOf('starship init zsh')
    );
  });

  it('keeps user lines glued directly under a stale adopt block', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() =>
      [
        '# Added by ShellConfigurator (shared config)',
        'eval "$(starship init zsh)"',
        'export EDITOR=vim',
      ].join('\n')
    );

    const result = applyShellConfig('zsh');

    expect(result.applied).toBe(true);
    const finalContent = lastWrittenContent();
    expect(finalContent).toContain('export EDITOR=vim');
    expect(finalContent.match(/starship init zsh/g)).toHaveLength(1);
    expect(finalContent).toContain('STARSHIP_CONFIG');
  });

  it('keeps user lines glued under the per-shell block an adopt run removes', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() =>
      [
        '# Added by ShellConfigurator',
        `export STARSHIP_CONFIG='${expectedConfigPath}'`,
        'eval "$(starship init zsh)"',
        'export EDITOR=vim',
      ].join('\n')
    );

    const result = applyShellConfig('zsh', { pointAtSharedConfig: true });

    expect(result.applied).toBe(true);
    const finalContent = lastWrittenContent();
    expect(finalContent).toContain('export EDITOR=vim');
    expect(finalContent).not.toContain('STARSHIP_CONFIG');
    expect(finalContent.match(/starship init zsh/g)).toHaveLength(1);
  });

  it('puts a needed PATH line above a user init line, not after it', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(
      () => `# mine\nexport STARSHIP_CONFIG='${expectedConfigPath}'\neval "$(starship init zsh)"\n`
    );

    applyShellConfig('zsh', { ensurePathDir: '/home/u/.local/bin' });

    const content = lastWrittenContent();
    expect(content.indexOf(`export PATH='/home/u/.local/bin':"$PATH"`)).toBeLessThan(
      content.indexOf('starship init zsh')
    );
  });

  it('adds a missing export inside its own managed block, above the init line', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(
      () => '# Added by ShellConfigurator\neval "$(starship init zsh)"\n'
    );

    applyShellConfig('zsh');

    expect(lastWrittenContent()).toBe(
      `# Added by ShellConfigurator\nexport STARSHIP_CONFIG='${expectedConfigPath}'\neval "$(starship init zsh)"\n`
    );
  });

  it('keeps user lines glued under the unset block a per-shell run removes', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() =>
      ['# Added by ShellConfigurator', 'unset STARSHIP_CONFIG', 'export EDITOR=vim'].join('\n')
    );

    const result = applyShellConfig('bash');

    expect(result.applied).toBe(true);
    const finalContent = lastWrittenContent();
    expect(finalContent).toContain('export EDITOR=vim');
    expect(finalContent).not.toContain('unset STARSHIP_CONFIG');
  });

  it('is idempotent — skips when the STARSHIP_CONFIG line is already present', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(
      () => `export STARSHIP_CONFIG='${expectedConfigPath}'\neval "$(starship init zsh)"`
    );

    const result = applyShellConfig('zsh');

    expect(result.applied).toBe(false);
    expect(result.note).toBe('already configured');
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('still recognises managed lines that gained trailing spaces', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(
      () =>
        `# Added by ShellConfigurator  \nexport STARSHIP_CONFIG='${expectedConfigPath}'  \neval "$(starship init zsh)"  \n`
    );

    const result = applyShellConfig('zsh');

    expect(result).toMatchObject({ applied: false, note: 'already configured' });
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('creates the rc when its folder exists but the file does not', () => {
    const rcPath = getShell('zsh')!.rcFile!;
    vi.mocked(fs.existsSync).mockImplementation((p) => String(p) !== rcPath);

    const result = applyShellConfig('zsh');

    expect(result.applied).toBe(true);
    expect(fs.readFileSync).not.toHaveBeenCalledWith(rcPath, 'utf8');
    expect(lastWrittenContent()).toBe(
      `# Added by ShellConfigurator\nexport STARSHIP_CONFIG='${expectedConfigPath}'\neval "$(starship init zsh)"\n`
    );
  });

  it('adds the missing STARSHIP_CONFIG line but not a duplicate init line', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    // A shell set up by an old wizard run has the init line but no per-shell config line.
    vi.mocked(fs.readFileSync).mockImplementation(() => 'eval "$(starship init zsh)"');

    const result = applyShellConfig('zsh');

    expect(result.applied).toBe(true);
    const finalContent = lastWrittenContent();
    expect(finalContent).toContain(`export STARSHIP_CONFIG='${expectedConfigPath}'`);
    // The init line was already in the rc and must not be added a second time.
    expect(finalContent.match(/starship init zsh/g)).toHaveLength(1);
    // Above the user's init line, closed by a blank line so that line stays theirs.
    expect(finalContent).toBe(
      `# Added by ShellConfigurator\nexport STARSHIP_CONFIG='${expectedConfigPath}'\n\neval "$(starship init zsh)"`
    );
  });

  it('works for bash', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => '');

    const result = applyShellConfig('bash');

    expect(result.applied).toBe(true);
    expect(lastWrittenContent()).toContain('starship init bash');
  });

  it('works for fish', () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => !String(p).includes('conf.d'));
    vi.mocked(fs.readFileSync).mockImplementation(() => '');

    const result = applyShellConfig('fish');

    expect(result.applied).toBe(true);
    expect(lastWrittenContent()).toContain('starship init fish');
  });

  it('adds only the fish export when conf.d already inits starship', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => '');

    applyShellConfig('fish');

    expect(lastWrittenContent()).toContain('set -gx STARSHIP_CONFIG');
    expect(lastWrittenContent()).not.toContain('starship init fish');
  });

  it('adds back an init line that was removed after an earlier run', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(
      () => `# Added by ShellConfigurator\nexport STARSHIP_CONFIG='${expectedConfigPath}'\n`
    );

    const result = applyShellConfig('zsh');

    expect(result.applied).toBe(true);
    expect(lastWrittenContent()).toContain('eval "$(starship init zsh)"');
  });

  it('does not count a commented-out export as present', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(
      () => `# export STARSHIP_CONFIG='${expectedConfigPath}'\neval "$(starship init zsh)"\n`
    );

    const result = applyShellConfig('zsh');

    expect(result.applied).toBe(true);
    expect(lastWrittenContent()).toMatch(/^export STARSHIP_CONFIG=/m);
  });

  it('only notes the PATH change when the PATH line was really added', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(
      () => `export PATH='/home/u/.local/bin':"$PATH"\n`
    );

    const result = applyShellConfig('zsh', { ensurePathDir: '/home/u/.local/bin' });

    expect(result.applied).toBe(true);
    expect(result.note).toBeUndefined();
  });

  it('returns manual note for nushell (no rc file)', () => {
    const result = applyShellConfig('nushell');

    expect(result.applied).toBe(false);
    expect(result.note).toBeTruthy();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('provides a Nushell setup command that Bash can parse', async () => {
    const { execFileSync } = await import('node:child_process');
    const command = getShell('nushell')!.initLine;

    expect(command).toMatch(/^nu -c '/);
    expect(() => execFileSync('bash', ['-n', '-c', command])).not.toThrow();
  });

  it('returns manual note for powershell (no rc file)', () => {
    const result = applyShellConfig('powershell');

    expect(result.applied).toBe(false);
    expect(result.note).toBeTruthy();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('pins STARSHIP_CONFIG to the per-shell config in the powershell init line', () => {
    const line = getShell('powershell')!.initLine;

    expect(line).toContain('$env:STARSHIP_CONFIG =');
    expect(line).toContain('starship/powershell.toml');
    expect(line).toContain('Invoke-Expression (&starship init powershell)');
  });

  it('reports nushell as already configured when its autoload file exists', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const result = applyShellConfig('nushell');

    expect(result.applied).toBe(false);
    expect(result.note).toBe('already configured');
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('reports adopt-mode Nushell configured only once the per-shell pin is gone', () => {
    const pin = getShell('nushell')!.additionalInitPaths![0]!;
    vi.mocked(fs.existsSync).mockImplementation((p) => String(p) !== pin);
    expect(applyShellConfig('nushell', { pointAtSharedConfig: true }).note).toBe(
      'already configured'
    );

    vi.mocked(fs.existsSync).mockReturnValue(true);
    expect(applyShellConfig('nushell', { pointAtSharedConfig: true }).note).not.toBe(
      'already configured'
    );
  });

  it('does not report Nushell configured if only one autoload file exists', () => {
    const nushell = getShell('nushell')!;
    vi.mocked(fs.existsSync).mockImplementation((file) => file === nushell.initPath);

    const result = applyShellConfig('nushell');

    expect(result.note).not.toBe('already configured');
  });

  it('reports powershell as already configured when $PROFILE contains the init line', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => `${getShell('powershell')!.initLine}\n`);

    const result = applyShellConfig('powershell');

    expect(result.applied).toBe(false);
    expect(result.note).toBe('already configured');
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('finds the powershell init line in the all-hosts profile.ps1', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation((p) =>
      String(p).endsWith('profile.ps1') && !String(p).includes('Microsoft')
        ? 'Invoke-Expression (&starship init powershell)\n'
        : ''
    );

    expect(applyShellConfig('powershell').note).toBe('already configured');
  });

  it('keeps the manual note when powershell $PROFILE exists but lacks the init line', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => '# my profile\n');

    const result = applyShellConfig('powershell');

    expect(result.applied).toBe(false);
    expect(result.note).not.toBe('already configured');
    expect(result.note).toContain('$PROFILE');
  });

  it('keeps the manual note when the powershell profile cannot be read', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('EACCES');
    });

    const result = applyShellConfig('powershell');

    expect(result.applied).toBe(false);
    expect(result.note).not.toBe('already configured');
    expect(result.note).toContain('$PROFILE');
  });

  it('creates rc parent directory if it does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.readFileSync).mockImplementation(() => '');

    applyShellConfig('fish');

    expect(fs.mkdirSync).toHaveBeenCalled();
  });

  it('still applies config when starship init appears only in a comment', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(
      () => '# starship init was removed\n# See https://starship.rs'
    );

    const result = applyShellConfig('zsh');

    expect(result.applied).toBe(true);
    expect(lastWrittenContent()).toContain('starship init zsh');
  });

  it('appends the ShellConfigurator banner before the init line', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => '');

    const result = applyShellConfig('zsh');

    expect(result.applied).toBe(true);
    const finalContent = lastWrittenContent();
    expect(finalContent).toContain('# Added by ShellConfigurator');
    expect(finalContent).toContain('eval "$(starship init zsh)"');
  });

  it('throws with a helpful message when the rc directory cannot be created', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    expect(() => applyShellConfig('zsh')).toThrow('Cannot create directory');
    expect(() => applyShellConfig('zsh')).toThrow('EACCES: permission denied');
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('adds a PATH line before the init line when starship is not reachable', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => '');

    const result = applyShellConfig('zsh', { ensurePathDir: '/home/u/.local/bin' });

    const finalContent = lastWrittenContent();
    expect(finalContent).toContain(`export PATH='/home/u/.local/bin':"$PATH"`);
    // Order matters: `starship init` cannot resolve before PATH is set.
    expect(finalContent.indexOf('export PATH')).toBeLessThan(finalContent.indexOf('starship init'));
    expect(result.note).toContain('/home/u/.local/bin');
  });

  it('uses fish syntax for the PATH line', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => '');

    applyShellConfig('fish', { ensurePathDir: '/home/u/.local/bin' });

    const finalContent = lastWrittenContent();
    expect(finalContent).toContain("fish_add_path '/home/u/.local/bin'");
    expect(finalContent).not.toContain('export PATH');
  });

  it('omits the PATH line when starship is already reachable', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => '');

    const result = applyShellConfig('zsh', { ensurePathDir: null });

    expect(lastWrittenContent()).not.toContain('export PATH');
    expect(result.note).toBeUndefined();
  });

  it('does not duplicate a PATH line that is already present', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => `export PATH='/home/u/.local/bin':"$PATH"`);

    applyShellConfig('zsh', { ensurePathDir: '/home/u/.local/bin' });

    const finalContent = lastWrittenContent();
    // The PATH line was already in the rc; a rewrite must not duplicate it.
    expect(finalContent.match(/export PATH='\/home\/u\/\.local\/bin':"\$PATH"/g)).toHaveLength(1);
    expect(finalContent).toContain('starship init zsh');
  });

  it('is idempotent for fish', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(
      () =>
        `set -gx STARSHIP_CONFIG '${path.join(os.homedir(), '.config', 'starship', 'fish.toml')}'\nstarship init fish | source`
    );

    const result = applyShellConfig('fish');

    expect(result.applied).toBe(false);
    expect(result.note).toBe('already configured');
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('removes a stale unset guard so the per-shell config takes effect', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const fishConfig = path.join(os.homedir(), '.config', 'starship', 'fish.toml');
    // A later wizard run reset fish to the shared config, leaving a stale guard
    // that stomps on the per-shell wiring added earlier.
    vi.mocked(fs.readFileSync).mockImplementation(
      () =>
        `\n# Added by ShellConfigurator\nset -gx STARSHIP_CONFIG '${fishConfig}'\nstarship init fish | source\n\n# Added by ShellConfigurator\nset -e STARSHIP_CONFIG\n`
    );

    const result = applyShellConfig('fish');

    expect(result.applied).toBe(false);
    expect(result.note).toBe('already configured');
    const written = lastWrittenContent();
    expect(written).toContain(`set -gx STARSHIP_CONFIG '${fishConfig}'`);
    expect(written).toContain('starship init fish | source');
    expect(written).not.toContain('set -e STARSHIP_CONFIG');
  });

  it('repairs a shell whose rc only has the stale unset guard', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(
      () => '# Existing user content\n\n# Added by ShellConfigurator\nunset STARSHIP_CONFIG\n'
    );

    const result = applyShellConfig('bash');

    expect(result.applied).toBe(true);
    const written = lastWrittenContent();
    expect(written).toContain('# Existing user content');
    expect(written).toContain('export STARSHIP_CONFIG');
    expect(written).toContain('starship init bash');
    expect(written).not.toContain('unset STARSHIP_CONFIG');
  });

  it('drops only the stale unset block when both generations of config coexist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(
      () =>
        `\n# Added by ShellConfigurator\neval "$(starship init zsh)"\n\n# Added by ShellConfigurator\nexport STARSHIP_CONFIG='${expectedConfigPath}'\n\n# Added by ShellConfigurator\nunset STARSHIP_CONFIG\n`
    );

    const result = applyShellConfig('zsh');

    expect(result.applied).toBe(false);
    const written = lastWrittenContent();
    expect(written).toContain('eval "$(starship init zsh)"');
    expect(written).toContain(`export STARSHIP_CONFIG='${expectedConfigPath}'`);
    expect(written).not.toContain('unset STARSHIP_CONFIG');
  });
});

describe('resetSharedShellConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('keeps an adopt block and adds the unset guard as a block of its own', () => {
    const adopt = '# Added by ShellConfigurator (shared config)\neval "$(starship init bash)"\n';
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => adopt);

    const result = resetSharedShellConfig('bash');

    expect(result.applied).toBe(true);
    expect(lastWrittenContent()).toBe(
      `${adopt}\n# Added by ShellConfigurator\nunset STARSHIP_CONFIG\n`
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

  it('leaves a shell wired to its own per-shell config by an earlier run alone', () => {
    const original = `# Existing content\n# Added by ShellConfigurator\nexport STARSHIP_CONFIG='${expectedConfigPath}'\neval "$(starship init zsh)"\n`;
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => original);

    const result = resetSharedShellConfig('zsh');

    expect(result).toEqual({ applied: false, note: 'sets its own STARSHIP_CONFIG' });
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it.each([
    ['bash', 'export STARSHIP_CONFIG=~/my-starship.toml\n'],
    ['bash', 'STARSHIP_CONFIG="$HOME/s.toml"\n'],
    ['fish', 'set -Ux STARSHIP_CONFIG ~/my-starship.toml\n'],
  ] as const)("does not override a user's own %s export", (shell, rc) => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => rc);

    const result = resetSharedShellConfig(shell);

    expect(result.applied).toBe(false);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it("drops a stale unset guard that would cancel the shell's own export", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const fishConfig = path.join(os.homedir(), '.config', 'starship', 'fish.toml');
    vi.mocked(fs.readFileSync).mockImplementation(
      () =>
        `\n# Added by ShellConfigurator\nset -gx STARSHIP_CONFIG '${fishConfig}'\nstarship init fish | source\n\n# Added by ShellConfigurator\nset -e STARSHIP_CONFIG\n`
    );

    const result = resetSharedShellConfig('fish');

    expect(result.applied).toBe(false);
    const written = lastWrittenContent();
    expect(written).toContain(`set -gx STARSHIP_CONFIG '${fishConfig}'`);
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

describe('backupSharedConfig', () => {
  const savedEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...savedEnv };
    vi.resetAllMocks();
  });

  it('returns null when there is no shared config to protect', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    expect(backupSharedConfig()).toBeNull();
    expect(fs.copyFileSync).not.toHaveBeenCalled();
  });

  it('snapshots the shared config to a stamped backup path', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const backup = backupSharedConfig();

    expect(backup).toMatch(/starship\.toml\.bak-/);
    expect(fs.copyFileSync).toHaveBeenCalledWith(getSharedConfigPath(), backup);
  });

  it('reuses the newest backup instead of copying an unchanged shared config again', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([
      'starship.toml.bak-2026-01-01T00-00-00-000Z',
    ] as unknown as ReturnType<typeof fs.readdirSync>);
    vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('format = "$all"\n'));

    const backup = backupSharedConfig();

    expect(backup).toBe(
      path.join(path.dirname(getSharedConfigPath()), 'starship.toml.bak-2026-01-01T00-00-00-000Z')
    );
    expect(fs.copyFileSync).not.toHaveBeenCalled();
  });

  it('makes a fresh backup once the shared config has changed', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([
      'starship.toml.bak-2026-01-01T00-00-00-000Z',
    ] as unknown as ReturnType<typeof fs.readdirSync>);
    vi.mocked(fs.readFileSync)
      .mockReturnValueOnce(Buffer.from('old\n'))
      .mockReturnValueOnce(Buffer.from('new\n'));

    const backup = backupSharedConfig();

    expect(backup).not.toContain('2026-01-01');
    expect(fs.copyFileSync).toHaveBeenCalledWith(getSharedConfigPath(), backup);
  });

  it('ignores XDG_CONFIG_HOME for the shared config, as Starship does', () => {
    process.env.XDG_CONFIG_HOME = '/home/u/.dotfiles/config';
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const backup = backupSharedConfig();

    expect(backup).toMatch(
      new RegExp(`^${path.join(os.homedir(), '.config', 'starship.toml.bak-')}`)
    );
  });

  it('is best-effort — returns null when the copy fails', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.copyFileSync).mockImplementation(() => {
      throw new Error('EACCES');
    });

    expect(backupSharedConfig()).toBeNull();
  });
});

describe('restoreConfigBackups', () => {
  const base = path.join(os.homedir(), '.config');
  const shellsDir = path.join(base, 'starship');
  const savedEnv = { ...process.env };
  // readdirSync has buffer/Dirent overloads; the module only reads string
  // paths, so pin the mock to the simple signature.
  const readdirSyncMock = fs.readdirSync as unknown as Mock<(dir: string) => string[]>;

  afterEach(() => {
    process.env = { ...savedEnv };
    vi.resetAllMocks();
  });

  it('returns nothing when no backups exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    readdirSyncMock.mockReturnValue([]);

    expect(restoreConfigBackups()).toEqual({ restored: [], failed: [] });
    expect(fs.copyFileSync).not.toHaveBeenCalled();
  });

  it('restores the newest shared backup over the live config', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    readdirSyncMock.mockImplementation((dir) => {
      if (dir === base) {
        return [
          'starship.toml.bak-2026-09-08T10-00-00-000Z',
          'starship.toml.bak-2026-09-09T09-30-00-000Z',
        ];
      }
      return [];
    });

    const { restored, failed } = restoreConfigBackups();

    expect(failed).toEqual([]);
    expect(restored).toHaveLength(1);
    expect(restored[0]?.what).toBe('shared');
    expect(restored[0]?.restoredTo).toBe(getSharedConfigPath());
    expect(restored[0]?.restoredFrom).toContain('2026-09-09T09-30-00-000Z');
    expect(fs.copyFileSync).toHaveBeenCalledWith(restored[0]?.restoredFrom, getSharedConfigPath());
  });

  it('ignores hand-made .bak files and orders same-millisecond backups by suffix', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    readdirSyncMock.mockImplementation((dir) =>
      dir === base
        ? [
            'starship.toml.bak-old',
            'starship.toml.bak-2026-09-09T09-30-00-000Z',
            'starship.toml.bak-2026-09-09T09-30-00-000Z-2',
            'starship.toml.bak-2026-09-08T10-00-00-000Z',
          ]
        : []
    );

    const { restored } = restoreConfigBackups();

    expect(restored[0]?.restoredFrom).toBe(
      path.join(base, 'starship.toml.bak-2026-09-09T09-30-00-000Z-2')
    );
  });

  it('saves the live file before restoring over it', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    readdirSyncMock.mockImplementation((dir) =>
      dir === base ? ['starship.toml.bak-2026-09-09T09-30-00-000Z'] : []
    );

    const { restored } = restoreConfigBackups();

    const saved = restored[0]?.previousSavedTo;
    expect(saved).toMatch(/starship\.toml\.pre-restore-/);
    const calls = vi.mocked(fs.copyFileSync).mock.calls;
    expect(calls[0]).toEqual([getSharedConfigPath(), saved]);
    expect(calls[1]).toEqual([restored[0]?.restoredFrom, getSharedConfigPath()]);
  });

  it('only restores the shells it is told the last run touched', () => {
    readdirSyncMock.mockImplementation((dir) =>
      dir === shellsDir
        ? ['zsh.toml.bak-2026-09-09T09-30-00-000Z', 'bash.toml.bak-2026-09-09T09-31-00-000Z']
        : []
    );
    vi.mocked(fs.existsSync).mockImplementation((p) => p === shellsDir);

    const { restored } = restoreConfigBackups(['bash']);

    expect(restored.map((r) => r.what)).toEqual(['bash']);
  });

  it('restores the newest backup for every per-shell config that has one', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    readdirSyncMock.mockImplementation((dir) => {
      if (dir === shellsDir) {
        return [
          'zsh.toml.bak-2026-09-08T10-00-00-000Z',
          'zsh.toml.bak-2026-09-09T09-30-00-000Z',
          'bash.toml.bak-2026-09-09T09-31-00-000Z',
        ];
      }
      return [];
    });

    const { restored, failed } = restoreConfigBackups();

    expect(failed).toEqual([]);
    expect(restored.map((r) => r.what).sort()).toEqual(['bash', 'zsh']);
    const zsh = restored.find((r) => r.what === 'zsh');
    expect(zsh?.restoredFrom).toContain('2026-09-09T09-30-00-000Z');
    expect(zsh?.restoredTo).toBe(getShellConfigPath('zsh'));
    // Each live file is saved aside, then the backup copied over it.
    expect(fs.copyFileSync).toHaveBeenCalledTimes(4);
  });

  it('reports a failing copy and still restores the rest', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    readdirSyncMock.mockImplementation((dir) => {
      if (dir === shellsDir) {
        return ['zsh.toml.bak-2026-09-09T09-30-00-000Z', 'bash.toml.bak-2026-09-09T09-31-00-000Z'];
      }
      return [];
    });
    const copyFileSyncMock = fs.copyFileSync as unknown as Mock<
      (src: string, dest: string) => void
    >;
    copyFileSyncMock.mockImplementation((_src: string, dest: string) => {
      if (dest === getShellConfigPath('zsh')) throw new Error('EACCES: permission denied');
    });

    const { restored, failed } = restoreConfigBackups();

    expect(restored.map((r) => r.what)).toEqual(['bash']);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.what).toBe('zsh');
    expect(failed[0]?.restoredFrom).toContain('zsh.toml.bak-2026-09-09T09-30-00-000Z');
    expect(failed[0]?.error).toContain('EACCES');
  });

  it('ignores files that are not config backups and unknown shell ids', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    readdirSyncMock.mockImplementation((dir) => {
      if (dir === shellsDir) {
        return ['notes.toml.bak-1', 'notashell.toml.bak-2026-09-09T00-00-00-000Z', 'README.md'];
      }
      return [];
    });

    expect(restoreConfigBackups()).toEqual({ restored: [], failed: [] });
    expect(fs.copyFileSync).not.toHaveBeenCalled();
  });
});

describe('backupPath', () => {
  afterEach(() => vi.resetAllMocks());

  it('adds a suffix instead of reusing a backup name taken in the same millisecond', () => {
    vi.mocked(fs.existsSync).mockReturnValueOnce(true).mockReturnValueOnce(false);

    expect(backupPath('/home/u/.zshrc')).toMatch(/\.zshrc\.bak-[\dT-]+Z-2$/);
  });
});

describe('plannedRcBlock', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ['zsh', false, null],
    ['bash', false, '/home/u/.local/bin'],
    ['zsh', true, '/home/u/.local/bin'],
  ] as const)(
    'matches what %s gets on an empty rc (adopt %s, PATH %s)',
    (shellId, adopt, pathDir) => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation(() => '');

      applyShellConfig(shellId, { pointAtSharedConfig: adopt, ensurePathDir: pathDir });

      const block = plannedRcBlock(shellId, adopt, pathDir);
      expect(block).toContain(getShell(shellId)!.initLine);
      expect(lastWrittenContent()).toContain(block.join('\n'));
    }
  );

  it('is empty for a shell without an rc file', () => {
    expect(plannedRcBlock('nushell', false, null)).toEqual([]);
  });
});
