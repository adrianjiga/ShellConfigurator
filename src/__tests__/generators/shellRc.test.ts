import { vi, describe, it, expect, beforeEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  appendFileSync: vi.fn(),
}));

import * as fs from 'fs';
import { applyShellConfig, writeStarshipConfig, getConfigPath } from '../../generators/shellRc.js';

const expectedConfigPath = path.join(os.homedir(), '.config', 'starship.toml');
const expectedConfigDir = path.join(os.homedir(), '.config');

describe('getConfigPath', () => {
  it('returns path to starship.toml inside ~/.config', () => {
    expect(getConfigPath()).toBe(expectedConfigPath);
  });
});

describe('writeStarshipConfig', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes toml content to the config path', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const toml = '[character]\nsuccess_symbol = "❯"';

    writeStarshipConfig(toml);

    expect(fs.writeFileSync).toHaveBeenCalledWith(expectedConfigPath, toml, 'utf8');
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
      () => '# starship init was removed\n# See https://starship.rs',
    );

    const result = applyShellConfig('zsh');

    expect(result.applied).toBe(true);
    expect(fs.appendFileSync).toHaveBeenCalled();
  });
});
