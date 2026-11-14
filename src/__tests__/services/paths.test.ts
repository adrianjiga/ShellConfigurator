import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cacheDir, homeDir, stateDir } from '../../services/paths.ts';

vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/real/home'),
  userInfo: vi.fn(() => ({ homedir: '/real/home' })),
}));

import * as os from 'node:os';
import { restoreEnv } from '../helpers/env.ts';

const savedEnv = { ...process.env };
afterEach(() => {
  restoreEnv(savedEnv);
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

  it('ignores a relative XDG_STATE_HOME, as the XDG spec requires', () => {
    process.env.XDG_STATE_HOME = 'relative/state';
    vi.mocked(os.homedir).mockReturnValue('/home/someone');
    expect(stateDir()).toBe(path.join('/home/someone', '.local', 'state', 'shell-configurator'));
  });

  it('treats a whitespace-only XDG_STATE_HOME as unset', () => {
    process.env.XDG_STATE_HOME = '  \t ';
    vi.mocked(os.homedir).mockReturnValue('/home/someone');
    expect(stateDir()).toBe(path.join('/home/someone', '.local', 'state', 'shell-configurator'));
  });

  it('trims spaces around an absolute XDG_STATE_HOME', () => {
    process.env.XDG_STATE_HOME = ' /srv/state ';
    expect(stateDir()).toBe(path.join('/srv/state', 'shell-configurator'));
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

describe('homeDir', () => {
  it('uses the passwd entry when HOME is set but empty', () => {
    vi.mocked(os.homedir).mockReturnValue('');
    vi.mocked(os.userInfo).mockReturnValue({ homedir: '/home/from-passwd' } as never);
    expect(homeDir()).toBe('/home/from-passwd');
  });
});
