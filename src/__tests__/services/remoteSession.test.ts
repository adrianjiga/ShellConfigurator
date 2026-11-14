import { describe, expect, it } from 'vitest';
import { detectRemoteSessionAsync } from '../../services/detector.ts';
import { buildTaskList, fontsElsewhere, plannedFont } from '../../services/installTasks.ts';
import { DEFAULT_STATE, type WizardState } from '../../types.ts';

describe('detectRemoteSessionAsync', () => {
  it.each([
    [{ SSH_CONNECTION: '10.0.0.2 51000 10.0.0.1 22' }, 'ssh'],
    [{ SSH_TTY: '/dev/pts/1' }, 'ssh'],
    [{ WSL_DISTRO_NAME: 'Ubuntu' }, 'wsl'],
    [{ WSL_INTEROP: '/run/WSL/1_interop' }, 'wsl'],
  ])('reads %o as %s', async (env, session) => {
    expect(await detectRemoteSessionAsync(env)).toBe(session);
  });

  it('finds no remote session on this machine with neither set', async () => {
    expect(await detectRemoteSessionAsync({})).toBeNull();
  });
});

describe('the font steps in a remote session', () => {
  const state = (remoteSession: WizardState['remoteSession']): WizardState => ({
    ...DEFAULT_STATE,
    selectedShells: ['zsh'],
    nerdFontToInstall: { kind: 'install', id: 'FiraCode' },
    terminal: 'kitty',
    remoteSession,
  });

  it.each([
    ['ssh', 'over SSH, fonts belong to the computer your terminal runs on'],
    ['wsl', 'in WSL, Windows Terminal uses fonts installed on Windows'],
  ] as const)('are left out over %s, and say why', (session, why) => {
    expect(fontsElsewhere(state(session))).toBe(why);
    expect(plannedFont(state(session))).toBeNull();
    const ids = buildTaskList(state(session)).map((task) => task.id);
    expect(ids).not.toContain('font');
    expect(ids).not.toContain('terminal');
  });

  it('stay on a local terminal', () => {
    expect(plannedFont(state(null))).toBe('FiraCode');
    expect(buildTaskList(state(null)).map((task) => task.id)).toContain('terminal');
  });
});
