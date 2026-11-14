import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockReadFileSync, mockExistsSync } = vi.hoisted(() => ({
  mockReadFileSync: vi.fn(),
  mockExistsSync: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  mockReadFileSync.mockImplementation(actual.readFileSync);
  mockExistsSync.mockImplementation(actual.existsSync);
  return { ...actual, readFileSync: mockReadFileSync, existsSync: mockExistsSync };
});

import { quoteArgv } from '../../services/args.ts';
import {
  collectDebugInfo,
  DEFAULT_DEBUG_INFO_DEPS,
  type DebugInfoDeps,
  formatDebugInfo,
  redactHome,
  redactUrls,
} from '../../services/debugInfo.ts';
import { homeDir } from '../../services/paths.ts';
import type { ShellId } from '../../types.ts';

const home = homeDir();

function makeDeps(overrides: Partial<DebugInfoDeps> = {}): DebugInfoDeps {
  return {
    detectPackageManager: vi.fn().mockResolvedValue('brew'),
    detectInstalledShells: vi.fn().mockResolvedValue(['zsh', 'bash']),
    detectTerminal: vi.fn().mockResolvedValue('kitty'),
    detectContainer: vi.fn().mockResolvedValue(false),
    detectCurrentShell: vi.fn().mockResolvedValue('zsh'),
    findStarship: vi.fn().mockResolvedValue({ installed: true, version: 'starship 1.27.0' }),
    starshipPath: () => '/opt/homebrew/bin/starship',
    recordedStarshipVersion: () => 'starship 1.26.0',
    distro: () => 'Arch Linux',
    runDoctor: vi.fn().mockResolvedValue({
      ok: true,
      findings: [{ id: 'starship', title: 'Starship', status: 'pass', detail: 'starship 1.27.0' }],
    }),
    history: () => [
      { version: 1, timestamp: '2026-11-14T09:00:00.000Z', kind: 'install' },
      {
        version: 1,
        timestamp: '2026-11-14T10:00:00.000Z',
        kind: 'apply',
        exitCode: 1,
        command: `apply --state ${home}/card.json --import-url https://u:tok@example.com/s.toml?key=1`,
      },
    ],
    shellFacts: (id: ShellId) => ({
      startsStarship: id === 'zsh',
      managedBlock: id === 'zsh',
      config: id === 'zsh',
    }),
    hasStarshipIn: (dir) => dir === '/opt/homebrew/bin',
    env: {
      PATH: ['/opt/homebrew/bin', path.join(home, '.local', 'bin'), '/usr/bin'].join(
        path.delimiter
      ),
      TERM: 'xterm-kitty',
      LANG: 'en_US.UTF-8',
      STARSHIP_CONFIG: path.join(home, '.config', 'starship', 'zsh.toml'),
    },
    os: () => 'Linux 6.9.0 (linux/x64)',
    ...overrides,
  };
}

describe('collectDebugInfo', () => {
  it('gathers detection, Starship, shells, PATH, the last run and the doctor report', async () => {
    const info = await collectDebugInfo('1.3.0', makeDeps());

    expect(info).toMatchObject({
      version: '1.3.0',
      os: 'Linux 6.9.0 (linux/x64)',
      distro: 'Arch Linux',
      packageManager: 'brew',
      terminal: 'kitty',
      termProgram: null,
      term: 'xterm-kitty',
      locale: { LC_ALL: null, LC_CTYPE: null, LANG: 'en_US.UTF-8' },
      currentShell: 'zsh',
      starship: {
        installed: true,
        path: '/opt/homebrew/bin/starship',
        version: 'starship 1.27.0',
        offPathDir: null,
        recordedVersion: 'starship 1.26.0',
      },
      lastRun: { kind: 'apply', exitCode: 1 },
    });
    expect(info.shells.find((s) => s.id === 'zsh')).toMatchObject({
      installed: true,
      startsStarship: true,
      managedBlock: true,
      config: true,
    });
    expect(info.shells.find((s) => s.id === 'fish')!.installed).toBe(false);
    expect(info.path.map((p) => p.hasStarship)).toEqual([true, false, false]);
  });

  it('names the setup file of a hand-configured shell', async () => {
    const info = await collectDebugInfo('1.3.0', makeDeps());
    expect(info.shells.find((s) => s.id === 'nushell')!.rcFile).toMatch(/starship\.nu$/);
  });

  it('has no last run before anything was recorded', async () => {
    const info = await collectDebugInfo('1.3.0', makeDeps({ history: () => [] }));
    expect(info.lastRun).toBeNull();
  });
});

describe('formatDebugInfo', () => {
  it('renders Markdown with the home directory shown as ~', async () => {
    const text = formatDebugInfo(await collectDebugInfo('1.3.0', makeDeps()));

    expect(text).toContain('# shell-configurator debug info');
    expect(text).toContain('- OS: Linux 6.9.0 (linux/x64) — Arch Linux');
    expect(text).toContain('- Terminal: kitty (TERM_PROGRAM (none), TERM `xterm-kitty`)');
    expect(text).toContain('- Version recorded at install: starship 1.26.0');
    expect(text).toContain('- STARSHIP_CONFIG: `~/.config/starship/zsh.toml`');
    expect(text).toContain('| Zsh | yes | `~/.zshrc` | yes | yes | yes |');
    expect(text).toContain('- `/opt/homebrew/bin` — has `starship`');
    expect(text).toContain(
      'apply at 2026-11-14T10:00:00.000Z, exit 1 (`apply --state ~/card.json --import-url https://example.com/s.toml`)'
    );
    expect(text).not.toContain('tok');
    expect(text).toContain('```text\nStarship health check');
    expect(text).not.toContain(home);
  });

  it('says when Starship sits off PATH', async () => {
    const text = formatDebugInfo(
      await collectDebugInfo(
        '1.3.0',
        makeDeps({
          starshipPath: () => null,
          findStarship: vi.fn().mockResolvedValue({
            installed: true,
            version: 'starship 1.27.0',
            pathDir: `${home}/.local/bin`,
          }),
        })
      )
    );
    expect(text).toContain('- Installed: yes (in `~/.local/bin`, not on PATH)');
  });
});

describe('redactUrls', () => {
  it('drops the credentials, query and fragment of a URL', () => {
    expect(
      redactUrls(
        "apply --import-url 'https://ana:ghp_secret@gist.githubusercontent.com/ana/raw/s.toml?token=abc#x' --shells zsh"
      )
    ).toBe('apply --import-url https://gist.githubusercontent.com/ana/raw/s.toml --shells zsh');
  });

  it('drops credentials that contain a quote, as quoteArgv recorded them', () => {
    const recorded = quoteArgv([
      'apply',
      '--import-url',
      "https://ana:p'w@d@example.com/s.toml?token=abc",
      '--shells',
      'zsh',
    ]);
    const redacted = redactUrls(recorded);

    expect(redacted).toBe(
      quoteArgv(['apply', '--import-url', 'https://example.com/s.toml', '--shells', 'zsh'])
    );
    expect(redacted).not.toContain('ana');
  });

  it('drops credentials from a --flag=value URL', () => {
    expect(redactUrls(quoteArgv(['apply', '--import-url=https://u:tok@example.com/a?b=1']))).toBe(
      quoteArgv(['apply', '--import-url=https://example.com/a'])
    );
  });

  it('leaves a command without URLs alone', () => {
    expect(redactUrls('apply --state card.json')).toBe('apply --state card.json');
  });
});

describe('redactHome', () => {
  it('replaces every occurrence of the home directory', () => {
    expect(redactHome('/home/ana/.zshrc and /home/ana/.bashrc', '/home/ana')).toBe(
      '~/.zshrc and ~/.bashrc'
    );
  });

  it('only replaces the home directory itself, not a longer name that starts with it', () => {
    expect(
      redactHome('/home/al/.zshrc /home/alex/bin `/home/al` "/home/al",x /home/al', '/home/al')
    ).toBe('~/.zshrc /home/alex/bin `~` "~",x ~');
    expect(redactHome('/root/bin:/rootfs/bin', '/root')).toBe('~/bin:/rootfs/bin');
  });

  it('leaves text alone when home is the root directory', () => {
    expect(redactHome('/etc/shells', '/')).toBe('/etc/shells');
  });
});

describe('DEFAULT_DEBUG_INFO_DEPS', () => {
  const missing = () => {
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  };

  afterEach(() => {
    mockReadFileSync.mockReset();
    mockExistsSync.mockReset();
  });

  it('reads the distro name from os-release, falling back to the second file', () => {
    mockReadFileSync.mockImplementation((file: string) => {
      if (file === '/etc/os-release') missing();
      return 'NAME=Debian\nPRETTY_NAME="Debian GNU/Linux 12 (bookworm)"\n';
    });
    expect(DEFAULT_DEBUG_INFO_DEPS.distro()).toBe('Debian GNU/Linux 12 (bookworm)');
  });

  it('has no distro without an os-release file', () => {
    mockReadFileSync.mockImplementation(missing);
    expect(DEFAULT_DEBUG_INFO_DEPS.distro()).toBeNull();
  });

  it('reports no recorded version when the record cannot be read', () => {
    mockReadFileSync.mockImplementation(() => {
      throw Object.assign(new Error('EISDIR'), { code: 'EISDIR' });
    });
    expect(DEFAULT_DEBUG_INFO_DEPS.recordedStarshipVersion()).toBeNull();
  });

  it('reads the per-shell facts and PATH entries from disk', () => {
    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockImplementation(missing);
    expect(DEFAULT_DEBUG_INFO_DEPS.shellFacts('zsh')).toEqual({
      startsStarship: false,
      managedBlock: false,
      config: false,
    });
    mockExistsSync.mockImplementation((p: string) => p === path.join('/opt/bin', 'starship'));
    expect(DEFAULT_DEBUG_INFO_DEPS.hasStarshipIn('/opt/bin')).toBe(true);
    expect(DEFAULT_DEBUG_INFO_DEPS.hasStarshipIn('/usr/bin')).toBe(false);
  });

  it('describes the OS with the platform and architecture', () => {
    expect(DEFAULT_DEBUG_INFO_DEPS.os()).toContain(`(${process.platform}/${process.arch})`);
  });
});
