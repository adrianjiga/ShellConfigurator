import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cacheDir, stateDir } from '../../services/paths.ts';

vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/real/home'),
}));

import * as os from 'node:os';

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
  vi.clearAllMocks();
});

describe('stateDir', () => {
  it('defaults to ~/.local/state/shell-configurator', () => {
    delete process.env.XDG_STATE_HOME;
    vi.mocked(os.homedir).mockReturnValue('/home/someone');
    expect(stateDir()).toBe(path.join('/home/someone', '.local', 'state', 'shell-configurator'));
  });

  it('honours XDG_STATE_HOME', () => {
    process.env.XDG_STATE_HOME = '/home/someone/.var/state';
    vi.mocked(os.homedir).mockReturnValue('/home/other');
    expect(stateDir()).toBe(path.join('/home/someone/.var/state', 'shell-configurator'));
  });

  it('reads the env live, not once at import', () => {
    process.env.XDG_STATE_HOME = '/first/value';
    const first = stateDir();
    process.env.XDG_STATE_HOME = '/second/value';
    expect(stateDir()).not.toBe(first);
  });
});

describe('cacheDir', () => {
  it('defaults to ~/.cache/shell-configurator', () => {
    delete process.env.XDG_CACHE_HOME;
    vi.mocked(os.homedir).mockReturnValue('/home/someone');
    expect(cacheDir()).toBe(path.join('/home/someone', '.cache', 'shell-configurator'));
  });

  it('honours XDG_CACHE_HOME', () => {
    process.env.XDG_CACHE_HOME = '/home/someone/.var/cache';
    vi.mocked(os.homedir).mockReturnValue('/home/other');
    expect(cacheDir()).toBe(path.join('/home/someone/.var/cache', 'shell-configurator'));
  });
});
