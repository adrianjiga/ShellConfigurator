import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  appendFileSync: vi.fn(),
  copyFileSync: vi.fn(),
}));

import * as fs from 'fs';
import { applyShellConfig, writeStarshipConfig, getConfigPath } from '../../generators/shellRc.js';

const expectedConfigPath = path.join(os.homedir(), '.config', 'starship.toml');
const expectedConfigDir = path.join(os.homedir(), '.config');

describe('getConfigPath', () => {
  const savedEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('defaults to starship.toml inside ~/.config', () => {
    delete process.env.STARSHIP_CONFIG;
    delete process.env.XDG_CONFIG_HOME;
    expect(getConfigPath()).toBe(expectedConfigPath);
  });

  it('honours XDG_CONFIG_HOME', () => {
    delete process.env.STARSHIP_CONFIG;
    process.env.XDG_CONFIG_HOME = '/home/u/.dotfiles/config';
    expect(getConfigPath()).toBe(path.join('/home/u/.dotfiles/config', 'starship.toml'));
  });

  it('honours STARSHIP_CONFIG over XDG_CONFIG_HOME', () => {
    process.env.XDG_CONFIG_HOME = '/home/u/.dotfiles/config';
    process.env.STARSHIP_CONFIG = '/home/u/custom-starship.toml';
    expect(getConfigPath()).toBe('/home/u/custom-starship.toml');
  });

  it('ignores empty environment values', () => {
    process.env.STARSHIP_CONFIG = '  ';
    process.env.XDG_CONFIG_HOME = '';
    expect(getConfigPath()).toBe(expectedConfigPath);
  });
});

describe('writeStarshipConfig', () => {
  const savedEnv = { ...process.env };
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.STARSHIP_CONFIG;
    delete process.env.XDG_CONFIG_HOME;
  });
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('writes toml content to the config path', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const toml = '[character]\nsuccess_symbol = "❯"';

    const result = writeStarshipConfig(toml);

    expect(fs.writeFileSync).toHaveBeenCalledWith(expectedConfigPath, toml, 'utf8');
    expect(result.path).toBe(expectedConfigPath);
  });

  it('writes to the XDG location when one is configured', () => {
    process.env.XDG_CONFIG_HOME = '/home/u/.dotfiles/config';
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const result = writeStarshipConfig('x');

    const expected = path.join('/home/u/.dotfiles/config', 'starship.toml');
    expect(fs.writeFileSync).toHaveBeenCalledWith(expected, 'x', 'utf8');
    expect(result.path).toBe(expected);
  });

  it('backs up an existing config before overwriting it', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const result = writeStarshipConfig('new content');

    expect(result.backedUpTo).toMatch(/starship\.toml\.bak-/);
    expect(fs.copyFileSync).toHaveBeenCalledWith(expectedConfigPath, result.backedUpTo);
    // The backup must be taken before the overwrite, not after.
    const copyOrder = vi.mocked(fs.copyFileSync).mock.invocationCallOrder[0] ?? 0;
    const writeOrder = vi.mocked(fs.writeFileSync).mock.invocationCallOrder[0] ?? 0;
    expect(copyOrder).toBeLessThan(writeOrder);
  });

  it('does not back up when there is no existing config', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = writeStarshipConfig('');

    expect(fs.copyFileSync).not.toHaveBeenCalled();
    expect(result.backedUpTo).toBeUndefined();
  });

  it('creates config directory when it does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    writeStarshipConfig('');

    expect(fs.mkdirSync).toHaveBeenCalledWith(expectedConfigDir, { recursive: true });
  });

  it('skips mkdir when config directory already exists', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    writeStarshipConfig('');

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

  it('is idempotent — skips if already configured', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => 'eval "$(starship init zsh)"');

    const result = applyShellConfig('zsh');

    expect(result.applied).toBe(false);
    expect(result.note).toBe('already configured');
    expect(fs.appendFileSync).not.toHaveBeenCalled();
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
    vi.mocked(fs.readFileSync).mockImplementation(() => 'starship init fish | source');

    const result = applyShellConfig('fish');

    expect(result.applied).toBe(false);
    expect(result.note).toBe('already configured');
    expect(fs.appendFileSync).not.toHaveBeenCalled();
  });
});
