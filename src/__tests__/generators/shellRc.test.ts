import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  appendFileSync: vi.fn(),
  copyFileSync: vi.fn(),
}));

import * as fs from 'fs';
import {
  applyShellConfig,
  getShellConfigPath,
  resetSharedShellConfig,
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

    expect(fs.writeFileSync).toHaveBeenCalledWith(expectedConfigPath, toml, 'utf8');
    expect(result.path).toBe(expectedConfigPath);
  });

  it('writes to the XDG location when one is configured', () => {
    process.env.XDG_CONFIG_HOME = '/home/u/.dotfiles/config';
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const result = writeShellConfig('x', 'fish');

    const expected = path.join('/home/u/.dotfiles/config', 'starship', 'fish.toml');
    expect(fs.writeFileSync).toHaveBeenCalledWith(expected, 'x', 'utf8');
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

describe('applyShellConfig', () => {
  beforeEach(() => vi.clearAllMocks());

  it('appends init line to shell rc file', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => '# existing content');

    const result = applyShellConfig('zsh');

    expect(result.applied).toBe(true);
    expect(fs.appendFileSync).toHaveBeenCalled();
    const appendedContent = vi.mocked(fs.appendFileSync).mock.calls[0]?.[1] as string;
    expect(appendedContent).toContain('starship init zsh');
  });

  it('points STARSHIP_CONFIG at the per-shell config before the init line', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => '');

    const result = applyShellConfig('zsh');

    expect(result.applied).toBe(true);
    const appendedContent = vi.mocked(fs.appendFileSync).mock.calls[0]?.[1] as string;
    const expected = `export STARSHIP_CONFIG="${expectedConfigPath}"`;
    expect(appendedContent).toContain(expected);
    // The env must be set before `starship init` runs.
    expect(appendedContent.indexOf(expected)).toBeLessThan(
      appendedContent.indexOf('starship init')
    );
  });

  it('uses fish syntax for the STARSHIP_CONFIG line', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => '');

    applyShellConfig('fish');

    const appendedContent = vi.mocked(fs.appendFileSync).mock.calls[0]?.[1] as string;
    const expected = `set -gx STARSHIP_CONFIG ${path.join(os.homedir(), '.config', 'starship', 'fish.toml')}`;
    expect(appendedContent).toContain(expected);
  });

  it('is idempotent — skips when the STARSHIP_CONFIG line is already present', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(
      () => `export STARSHIP_CONFIG="${expectedConfigPath}"\neval "$(starship init zsh)"`
    );

    const result = applyShellConfig('zsh');

    expect(result.applied).toBe(false);
    expect(result.note).toBe('already configured');
    expect(fs.appendFileSync).not.toHaveBeenCalled();
  });

  it('adds the missing STARSHIP_CONFIG line but not a duplicate init line', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    // A shell set up by an old wizard run has the init line but no per-shell config line.
    vi.mocked(fs.readFileSync).mockImplementation(() => 'eval "$(starship init zsh)"');

    const result = applyShellConfig('zsh');

    expect(result.applied).toBe(true);
    const appendedContent = vi.mocked(fs.appendFileSync).mock.calls[0]?.[1] as string;
    expect(appendedContent).toContain(`export STARSHIP_CONFIG="${expectedConfigPath}"`);
    expect(appendedContent).not.toContain('starship init zsh');
  });

  it('works for bash', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => '');

    const result = applyShellConfig('bash');

    expect(result.applied).toBe(true);
    const appendedContent = vi.mocked(fs.appendFileSync).mock.calls[0]?.[1] as string;
    expect(appendedContent).toContain('starship init bash');
  });

  it('works for fish', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => '');

    const result = applyShellConfig('fish');

    expect(result.applied).toBe(true);
    const appendedContent = vi.mocked(fs.appendFileSync).mock.calls[0]?.[1] as string;
    expect(appendedContent).toContain('starship init fish');
  });

  it('returns manual note for nushell (no rc file)', () => {
    const result = applyShellConfig('nushell');

    expect(result.applied).toBe(false);
    expect(result.note).toBeTruthy();
    expect(fs.appendFileSync).not.toHaveBeenCalled();
  });

  it('returns manual note for powershell (no rc file)', () => {
    const result = applyShellConfig('powershell');

    expect(result.applied).toBe(false);
    expect(result.note).toBeTruthy();
    expect(fs.appendFileSync).not.toHaveBeenCalled();
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
    expect(fs.appendFileSync).toHaveBeenCalled();
  });

  it('appends the ShellConfigurator banner before the init line', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => '');

    const result = applyShellConfig('zsh');

    expect(result.applied).toBe(true);
    const appendedContent = vi.mocked(fs.appendFileSync).mock.calls[0]?.[1] as string;
    expect(appendedContent).toContain('# Added by ShellConfigurator');
    expect(appendedContent).toContain('eval "$(starship init zsh)"');
  });

  it('throws with a helpful message when the rc directory cannot be created', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    expect(() => applyShellConfig('zsh')).toThrow('Cannot create directory');
    expect(() => applyShellConfig('zsh')).toThrow('EACCES: permission denied');
    expect(fs.appendFileSync).not.toHaveBeenCalled();
  });

  it('adds a PATH line before the init line when starship is not reachable', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => '');

    const result = applyShellConfig('zsh', { ensurePathDir: '/home/u/.local/bin' });

    const appended = vi.mocked(fs.appendFileSync).mock.calls[0]?.[1] as string;
    expect(appended).toContain('export PATH="/home/u/.local/bin:$PATH"');
    // Order matters: `starship init` cannot resolve before PATH is set.
    expect(appended.indexOf('export PATH')).toBeLessThan(appended.indexOf('starship init'));
    expect(result.note).toContain('/home/u/.local/bin');
  });

  it('uses fish syntax for the PATH line', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => '');

    applyShellConfig('fish', { ensurePathDir: '/home/u/.local/bin' });

    const appended = vi.mocked(fs.appendFileSync).mock.calls[0]?.[1] as string;
    expect(appended).toContain('fish_add_path /home/u/.local/bin');
    expect(appended).not.toContain('export PATH');
  });

  it('omits the PATH line when starship is already reachable', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => '');

    const result = applyShellConfig('zsh', { ensurePathDir: null });

    const appended = vi.mocked(fs.appendFileSync).mock.calls[0]?.[1] as string;
    expect(appended).not.toContain('export PATH');
    expect(result.note).toBeUndefined();
  });

  it('does not duplicate a PATH line that is already present', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => 'export PATH="/home/u/.local/bin:$PATH"');

    applyShellConfig('zsh', { ensurePathDir: '/home/u/.local/bin' });

    const appended = vi.mocked(fs.appendFileSync).mock.calls[0]?.[1] as string;
    expect(appended).not.toContain('export PATH');
    expect(appended).toContain('starship init zsh');
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
    expect(fs.appendFileSync).not.toHaveBeenCalled();
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
    expect(fs.appendFileSync).not.toHaveBeenCalled();
    const written = vi.mocked(fs.writeFileSync).mock.calls[0]?.[1] as string;
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
    const written = vi.mocked(fs.writeFileSync).mock.calls[0]?.[1] as string;
    expect(written).toBe('# Existing user content\n');
    const appended = vi.mocked(fs.appendFileSync).mock.calls[0]?.[1] as string;
    expect(appended).toContain('export STARSHIP_CONFIG');
    expect(appended).toContain('starship init bash');
  });

  it('drops only the stale unset block when both generations of config coexist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(
      () =>
        `\n# Added by ShellConfigurator\neval "$(starship init zsh)"\n\n# Added by ShellConfigurator\nexport STARSHIP_CONFIG="${expectedConfigPath}"\n\n# Added by ShellConfigurator\nunset STARSHIP_CONFIG\n`
    );

    const result = applyShellConfig('zsh');

    expect(result.applied).toBe(false);
    expect(fs.appendFileSync).not.toHaveBeenCalled();
    const written = vi.mocked(fs.writeFileSync).mock.calls[0]?.[1] as string;
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
    const appended = vi.mocked(fs.appendFileSync).mock.calls[0]?.[1] as string;
    expect(appended).toContain('unset STARSHIP_CONFIG');
    expect(appended).toContain('# Added by ShellConfigurator');
  });

  it('uses fish syntax for the unset line', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => '');

    resetSharedShellConfig('fish');

    const appended = vi.mocked(fs.appendFileSync).mock.calls[0]?.[1] as string;
    expect(appended).toContain('set -e STARSHIP_CONFIG');
    expect(appended).not.toContain('unset STARSHIP_CONFIG');
  });

  it('is idempotent — skips when the unset line is already present', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => 'unset STARSHIP_CONFIG\n');

    const result = resetSharedShellConfig('bash');

    expect(result.applied).toBe(false);
    expect(result.note).toBe('already configured');
    expect(fs.appendFileSync).not.toHaveBeenCalled();
  });

  it('removes a stale per-shell block before adding the unset guard', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(
      () =>
        `# Existing content\n# Added by ShellConfigurator\nexport STARSHIP_CONFIG="${expectedConfigPath}"\neval "$(starship init zsh)"\n`
    );

    const result = resetSharedShellConfig('zsh');

    expect(result.applied).toBe(true);
    const written = vi.mocked(fs.writeFileSync).mock.calls[0]?.[1] as string;
    expect(written).toBe('# Existing content');
    const appended = vi.mocked(fs.appendFileSync).mock.calls[0]?.[1] as string;
    expect(appended).toContain('unset STARSHIP_CONFIG');
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
    expect(fs.appendFileSync).not.toHaveBeenCalled();
    const written = vi.mocked(fs.writeFileSync).mock.calls[0]?.[1] as string;
    expect(written).not.toContain('set -gx STARSHIP_CONFIG');
    expect(written).not.toContain('starship init fish | source');
    expect(written).toContain('set -e STARSHIP_CONFIG');
  });

  it('returns a manual note for shells without an rc file', () => {
    const result = resetSharedShellConfig('nushell');

    expect(result.applied).toBe(false);
    expect(result.note).toBeTruthy();
    expect(fs.appendFileSync).not.toHaveBeenCalled();
  });

  it('creates the rc parent directory when it does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.readFileSync).mockImplementation(() => '');

    resetSharedShellConfig('fish');

    expect(fs.mkdirSync).toHaveBeenCalled();
  });
});
