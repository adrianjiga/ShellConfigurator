import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  collectDebugInfo,
  type DebugInfoDeps,
  formatDebugInfo,
  redactHome,
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
        command: `apply --state ${home}/card.json`,
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
      'apply at 2026-11-14T10:00:00.000Z, exit 1 (`apply --state ~/card.json`)'
    );
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

describe('redactHome', () => {
  it('replaces every occurrence of the home directory', () => {
    expect(redactHome('/home/ana/.zshrc and /home/ana/.bashrc', '/home/ana')).toBe(
      '~/.zshrc and ~/.bashrc'
    );
  });

  it('leaves text alone when home is the root directory', () => {
    expect(redactHome('/etc/shells', '/')).toBe('/etc/shells');
  });
});
