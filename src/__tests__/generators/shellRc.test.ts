import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

vi.mock('fs', () => ({
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

/** The content of the module's single atomic write (the temp-file write). */
function lastWrittenContent(): string {
  return vi.mocked(fs.writeFileSync).mock.calls[0]?.[1] as string;
}

import * as fs from 'node:fs';
import {
  applyShellConfig,
  backupSharedConfig,
  getSharedConfigPath,
  getShellConfigPath,
  resetSharedShellConfig,
  restoreConfigBackups,
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
    const tmpPath = expect.stringContaining(`.${path.basename(expectedConfigPath)}.tmp`);
    expect(fs.writeFileSync).toHaveBeenCalledWith(tmpPath, toml, 'utf8');
    expect(fs.renameSync).toHaveBeenCalledWith(tmpPath, expectedConfigPath);
    expect(result.path).toBe(expectedConfigPath);
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
    const expected = `export STARSHIP_CONFIG="${expectedConfigPath}"`;
    expect(finalContent).toContain(expected);
    // The env must be set before `starship init` runs.
    expect(finalContent.indexOf(expected)).toBeLessThan(finalContent.indexOf('starship init'));
  });

  it('uses fish syntax for the STARSHIP_CONFIG line', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => '');

    applyShellConfig('fish');

    const finalContent = lastWrittenContent();
    const expected = `set -gx STARSHIP_CONFIG ${path.join(os.homedir(), '.config', 'starship', 'fish.toml')}`;
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
        `export STARSHIP_CONFIG="${expectedConfigPath}"`,
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

  it('is idempotent — skips when the STARSHIP_CONFIG line is already present', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(
      () => `export STARSHIP_CONFIG="${expectedConfigPath}"\neval "$(starship init zsh)"`
    );

    const result = applyShellConfig('zsh');

    expect(result.applied).toBe(false);
    expect(result.note).toBe('already configured');
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('adds the missing STARSHIP_CONFIG line but not a duplicate init line', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    // A shell set up by an old wizard run has the init line but no per-shell config line.
    vi.mocked(fs.readFileSync).mockImplementation(() => 'eval "$(starship init zsh)"');

    const result = applyShellConfig('zsh');

    expect(result.applied).toBe(true);
    const finalContent = lastWrittenContent();
    expect(finalContent).toContain(`export STARSHIP_CONFIG="${expectedConfigPath}"`);
    // The init line was already in the rc and must not be added a second time.
    expect(finalContent.match(/starship init zsh/g)).toHaveLength(1);
  });

  it('works for bash', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => '');

    const result = applyShellConfig('bash');

    expect(result.applied).toBe(true);
    expect(lastWrittenContent()).toContain('starship init bash');
  });

  it('works for fish', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => '');

    const result = applyShellConfig('fish');

    expect(result.applied).toBe(true);
    expect(lastWrittenContent()).toContain('starship init fish');
  });

  it('returns manual note for nushell (no rc file)', () => {
    const result = applyShellConfig('nushell');

    expect(result.applied).toBe(false);
    expect(result.note).toBeTruthy();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('returns manual note for powershell (no rc file)', () => {
    const result = applyShellConfig('powershell');

    expect(result.applied).toBe(false);
    expect(result.note).toBeTruthy();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('reports nushell as already configured when its autoload file exists', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const result = applyShellConfig('nushell');

    expect(result.applied).toBe(false);
    expect(result.note).toBe('already configured');
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('reports powershell as already configured when $PROFILE contains the init line', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(
      () => 'Invoke-Expression (&starship init powershell)\n'
    );

    const result = applyShellConfig('powershell');

    expect(result.applied).toBe(false);
    expect(result.note).toBe('already configured');
    expect(fs.writeFileSync).not.toHaveBeenCalled();
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
    expect(finalContent).toContain('export PATH="/home/u/.local/bin:$PATH"');
    // Order matters: `starship init` cannot resolve before PATH is set.
    expect(finalContent.indexOf('export PATH')).toBeLessThan(finalContent.indexOf('starship init'));
    expect(result.note).toContain('/home/u/.local/bin');
  });

  it('uses fish syntax for the PATH line', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => '');

    applyShellConfig('fish', { ensurePathDir: '/home/u/.local/bin' });

    const finalContent = lastWrittenContent();
    expect(finalContent).toContain('fish_add_path /home/u/.local/bin');
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
    vi.mocked(fs.readFileSync).mockImplementation(() => 'export PATH="/home/u/.local/bin:$PATH"');

    applyShellConfig('zsh', { ensurePathDir: '/home/u/.local/bin' });

    const finalContent = lastWrittenContent();
    // The PATH line was already in the rc; a rewrite must not duplicate it.
    expect(finalContent.match(/export PATH="\/home\/u\/\.local\/bin:\$PATH"/g)).toHaveLength(1);
    expect(finalContent).toContain('starship init zsh');
  });

  it('is idempotent for fish', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(
      () =>
        `set -gx STARSHIP_CONFIG ${path.join(os.homedir(), '.config', 'starship', 'fish.toml')}\nstarship init fish | source`
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
        `\n# Added by ShellConfigurator\nset -gx STARSHIP_CONFIG ${fishConfig}\nstarship init fish | source\n\n# Added by ShellConfigurator\nset -e STARSHIP_CONFIG\n`
    );

    const result = applyShellConfig('fish');

    expect(result.applied).toBe(false);
    expect(result.note).toBe('already configured');
    const written = lastWrittenContent();
    expect(written).toContain(`set -gx STARSHIP_CONFIG ${fishConfig}`);
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
        `\n# Added by ShellConfigurator\neval "$(starship init zsh)"\n\n# Added by ShellConfigurator\nexport STARSHIP_CONFIG="${expectedConfigPath}"\n\n# Added by ShellConfigurator\nunset STARSHIP_CONFIG\n`
    );

    const result = applyShellConfig('zsh');

    expect(result.applied).toBe(false);
    const written = lastWrittenContent();
    expect(written).toContain('eval "$(starship init zsh)"');
    expect(written).toContain(`export STARSHIP_CONFIG="${expectedConfigPath}"`);
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

  it('removes a stale per-shell block before adding the unset guard', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(
      () =>
        `# Existing content\n# Added by ShellConfigurator\nexport STARSHIP_CONFIG="${expectedConfigPath}"\neval "$(starship init zsh)"\n`
    );

    const result = resetSharedShellConfig('zsh');

    expect(result.applied).toBe(true);
    expect(lastWrittenContent()).toBe(
      `# Existing content\n# Added by ShellConfigurator\nunset STARSHIP_CONFIG\n`
    );
  });

  it('keeps the unset guard and drops a stale per-shell block (idempotent)', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const fishConfig = path.join(os.homedir(), '.config', 'starship', 'fish.toml');
    vi.mocked(fs.readFileSync).mockImplementation(
      () =>
        `\n# Added by ShellConfigurator\nset -gx STARSHIP_CONFIG ${fishConfig}\nstarship init fish | source\n\n# Added by ShellConfigurator\nset -e STARSHIP_CONFIG\n`
    );

    const result = resetSharedShellConfig('fish');

    expect(result.applied).toBe(false);
    expect(result.note).toBe('already configured');
    const written = lastWrittenContent();
    expect(written).not.toContain('set -gx STARSHIP_CONFIG');
    expect(written).not.toContain('starship init fish | source');
    expect(written).toContain('set -e STARSHIP_CONFIG');
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

  it('honours XDG_CONFIG_HOME for the shared config', () => {
    process.env.XDG_CONFIG_HOME = '/home/u/.dotfiles/config';
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const backup = backupSharedConfig();

    expect(backup).toMatch(
      new RegExp(`^${path.join('/home/u/.dotfiles/config', 'starship.toml.bak-')}`)
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

    expect(restoreConfigBackups()).toEqual([]);
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

    const restored = restoreConfigBackups();

    expect(restored).toHaveLength(1);
    expect(restored[0]?.what).toBe('shared');
    expect(restored[0]?.restoredTo).toBe(getSharedConfigPath());
    expect(restored[0]?.restoredFrom).toContain('2026-09-09T09-30-00-000Z');
    expect(fs.copyFileSync).toHaveBeenCalledWith(restored[0]?.restoredFrom, getSharedConfigPath());
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

    const restored = restoreConfigBackups();

    expect(restored.map((r) => r.what).sort()).toEqual(['bash', 'zsh']);
    const zsh = restored.find((r) => r.what === 'zsh');
    expect(zsh?.restoredFrom).toContain('2026-09-09T09-30-00-000Z');
    expect(zsh?.restoredTo).toBe(getShellConfigPath('zsh'));
    expect(fs.copyFileSync).toHaveBeenCalledTimes(2);
  });

  it('ignores files that are not config backups and unknown shell ids', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    readdirSyncMock.mockImplementation((dir) => {
      if (dir === shellsDir) {
        return ['notes.toml.bak-1', 'notashell.toml.bak-2026-09-09T00-00-00-000Z', 'README.md'];
      }
      return [];
    });

    expect(restoreConfigBackups()).toEqual([]);
    expect(fs.copyFileSync).not.toHaveBeenCalled();
  });
});
