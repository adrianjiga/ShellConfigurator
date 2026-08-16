import { describe, it, expect, vi } from 'vitest';
import { runInstallTasks, InstallTaskDeps } from '../../services/installTasks.js';
import { DEFAULT_STATE, FONT_SELECT_SENTINEL, WizardState, InstallTask } from '../../types.js';

function fakeDeps(overrides: Partial<InstallTaskDeps> = {}): InstallTaskDeps {
  return {
    isStarshipInstalled: vi.fn().mockResolvedValue({ installed: false }),
    installStarship: vi.fn().mockResolvedValue(undefined),
    installNerdFont: vi.fn().mockResolvedValue(undefined),
    installShell: vi.fn().mockResolvedValue(undefined),
    setDefaultShell: vi.fn().mockResolvedValue(undefined),
    generateToml: vi.fn(() => 'format = "$character"'),
    writeStarshipConfig: vi.fn(() => ({ path: '/home/u/.config/starship.toml' })),
    applyShellConfig: vi.fn(() => ({ applied: true })),
    getMissingStarshipPathDir: vi.fn(() => null),
    ...overrides,
  };
}

function state(overrides: Partial<WizardState> = {}): WizardState {
  return { ...DEFAULT_STATE, packageManager: 'apt', ...overrides };
}

const task = (results: InstallTask[]) => results;

describe('runInstallTasks', () => {
  it('installs starship when it is missing and not skipped', async () => {
    const deps = fakeDeps();
    const results = await runInstallTasks(state(), deps, vi.fn());

    expect(deps.installStarship).toHaveBeenCalledWith('apt');
    expect(task(results).find((t) => t.id === 'starship')?.status).toBe('done');
  });

  it('skips the install when starship is already present', async () => {
    const deps = fakeDeps({
      isStarshipInstalled: vi.fn().mockResolvedValue({ installed: true, version: 'starship 1.20' }),
    });
    const results = await runInstallTasks(state(), deps, vi.fn());

    expect(deps.installStarship).not.toHaveBeenCalled();
    const starship = task(results).find((t) => t.id === 'starship');
    expect(starship?.status).toBe('skipped');
    expect(starship?.label).toContain('starship 1.20');
  });

  it('does not install or list starship when skipStarshipInstall is set', async () => {
    const deps = fakeDeps();
    const results = await runInstallTasks(state({ skipStarshipInstall: true }), deps, vi.fn());

    expect(deps.installStarship).not.toHaveBeenCalled();
    expect(task(results).some((t) => t.id === 'starship')).toBe(false);
  });

  it('installs a concrete nerd font but ignores the sentinel', async () => {
    const deps = fakeDeps();
    const withFont = await runInstallTasks(
      state({ nerdFontToInstall: 'JetBrainsMono' }),
      deps,
      vi.fn()
    );
    const withSentinel = await runInstallTasks(
      state({ nerdFontToInstall: FONT_SELECT_SENTINEL }),
      deps,
      vi.fn()
    );

    expect(deps.installNerdFont).toHaveBeenCalledTimes(1);
    expect(deps.installNerdFont).toHaveBeenCalledWith('JetBrainsMono');
    expect(withFont.find((t) => t.id === 'font')?.status).toBe('done');
    expect(withSentinel.some((t) => t.id === 'font')).toBe(false);
  });

  it('installs only the shells that are missing', async () => {
    const deps = fakeDeps();
    const results = await runInstallTasks(
      state({ selectedShells: ['bash', 'zsh'], installedShells: ['bash'] }),
      deps,
      vi.fn()
    );

    expect(deps.installShell).toHaveBeenCalledTimes(1);
    expect(deps.installShell).toHaveBeenCalledWith('zsh', 'apt');
    expect(results.find((t) => t.id === 'shell_bash')).toBeUndefined();
    expect(results.find((t) => t.id === 'shell_zsh')?.status).toBe('done');
  });

  it('records per-shell install failures', async () => {
    const deps = fakeDeps({
      installShell: vi
        .fn()
        .mockRejectedValueOnce(new Error('no package'))
        .mockResolvedValue(undefined),
    });
    const results = await runInstallTasks(
      state({ selectedShells: ['zsh', 'fish'], installedShells: [] }),
      deps,
      vi.fn()
    );

    expect(results.find((t) => t.id === 'shell_zsh')?.status).toBe('failed');
    expect(results.find((t) => t.id === 'shell_zsh')?.error).toContain('no package');
    expect(results.find((t) => t.id === 'shell_fish')?.status).toBe('done');
  });

  it('sets the default shell and records its failure', async () => {
    const failing = fakeDeps({
      setDefaultShell: vi.fn().mockRejectedValue(new Error('chsh denied')),
    });
    const failingResults = await runInstallTasks(
      state({ setDefaultShell: 'zsh' }),
      failing,
      vi.fn()
    );
    expect(failingResults.find((t) => t.id === 'chsh')?.status).toBe('failed');

    const deps = fakeDeps();
    const results = await runInstallTasks(state({ setDefaultShell: 'zsh' }), deps, vi.fn());
    expect(deps.setDefaultShell).toHaveBeenCalledWith('zsh');
    expect(results.find((t) => t.id === 'chsh')?.status).toBe('done');
  });

  it('writes the generated toml', async () => {
    const deps = fakeDeps();
    const results = await runInstallTasks(state(), deps, vi.fn());

    expect(deps.generateToml).toHaveBeenCalledWith(expect.objectContaining({ step: 'welcome' }));
    expect(deps.writeStarshipConfig).toHaveBeenCalledWith('format = "$character"');
    expect(results.find((t) => t.id === 'config')?.status).toBe('done');
  });

  it('reports the backup path when an existing config was replaced', async () => {
    const deps = fakeDeps({
      writeStarshipConfig: vi.fn(() => ({
        path: '/home/u/.config/starship.toml',
        backedUpTo: '/home/u/.config/starship.toml.bak-2026',
      })),
    });
    const results = await runInstallTasks(state(), deps, vi.fn());

    expect(results.find((t) => t.id === 'config')?.note).toContain('starship.toml.bak-2026');
  });

  it('regenerates the config without nerd font glyphs when the font install fails', async () => {
    const deps = fakeDeps({
      installNerdFont: vi.fn().mockRejectedValue(new Error('no network')),
    });
    const results = await runInstallTasks(
      state({ nerdFontToInstall: 'JetBrainsMono', hasNerdFont: true }),
      deps,
      vi.fn()
    );

    expect(deps.generateToml).toHaveBeenCalledWith(expect.objectContaining({ hasNerdFont: false }));
    expect(results.find((t) => t.id === 'config')?.note).toContain('without Nerd Font glyphs');
  });

  it('keeps nerd font glyphs when the font install succeeds', async () => {
    const deps = fakeDeps();
    await runInstallTasks(
      state({ nerdFontToInstall: 'JetBrainsMono', hasNerdFont: true }),
      deps,
      vi.fn()
    );

    expect(deps.generateToml).toHaveBeenCalledWith(expect.objectContaining({ hasNerdFont: true }));
  });

  it('isolates rc failures to the shell that failed', async () => {
    const deps = fakeDeps({
      applyShellConfig: vi.fn().mockImplementation((shellId: string) => {
        if (shellId === 'fish') throw new Error('mkdir failed');
        return { applied: true };
      }),
    });
    const results = await runInstallTasks(
      state({ selectedShells: ['bash', 'fish'] }),
      deps,
      vi.fn()
    );

    expect(deps.applyShellConfig).toHaveBeenCalledWith('bash', expect.anything());
    expect(deps.applyShellConfig).toHaveBeenCalledWith('fish', expect.anything());
    expect(results.find((t) => t.id === 'rc_bash')?.status).toBe('done');
    const fish = results.find((t) => t.id === 'rc_fish');
    expect(fish?.status).toBe('failed');
    expect(fish?.error).toContain('mkdir failed');
  });

  it('passes the missing PATH directory through to the rc step', async () => {
    const deps = fakeDeps({
      getMissingStarshipPathDir: vi.fn(() => '/home/u/.local/bin'),
    });
    await runInstallTasks(state({ selectedShells: ['zsh'] }), deps, vi.fn());

    expect(deps.applyShellConfig).toHaveBeenCalledWith('zsh', {
      ensurePathDir: '/home/u/.local/bin',
    });
  });

  it('does not probe for a PATH fix when starship was skipped', async () => {
    const deps = fakeDeps({ getMissingStarshipPathDir: vi.fn(() => '/home/u/.local/bin') });
    await runInstallTasks(
      state({ skipStarshipInstall: true, selectedShells: ['zsh'] }),
      deps,
      vi.fn()
    );

    expect(deps.getMissingStarshipPathDir).not.toHaveBeenCalled();
  });

  it('records a shell that needs manual setup as skipped and keeps its note', async () => {
    const deps = fakeDeps({
      applyShellConfig: vi.fn(() => ({ applied: false, note: 'Run the above command once.' })),
    });
    const results = await runInstallTasks(state({ selectedShells: ['nushell'] }), deps, vi.fn());

    const rc = results.find((t) => t.id === 'rc_nushell');
    expect(rc?.status).toBe('skipped');
    expect(rc?.note).toBe('Run the above command once.');
  });

  it('records an already-configured shell as skipped rather than freshly applied', async () => {
    const deps = fakeDeps({
      applyShellConfig: vi.fn(() => ({ applied: false, note: 'already configured' })),
    });
    const results = await runInstallTasks(state({ selectedShells: ['zsh'] }), deps, vi.fn());

    const rc = results.find((t) => t.id === 'rc_zsh');
    expect(rc?.status).toBe('skipped');
    expect(rc?.note).toBe('already configured');
  });

  it('fails the rc task for an unknown shell', async () => {
    const deps = fakeDeps({ applyShellConfig: vi.fn(() => ({ applied: false })) });
    const results = await runInstallTasks(state({ selectedShells: ['zsh'] }), deps, vi.fn());

    expect(results.find((t) => t.id === 'rc_zsh')?.status).toBe('failed');
  });

  it('skips rc configs when skipStarshipInstall is set', async () => {
    const deps = fakeDeps();
    const results = await runInstallTasks(
      state({ skipStarshipInstall: true, selectedShells: ['bash'] }),
      deps,
      vi.fn()
    );

    expect(deps.applyShellConfig).not.toHaveBeenCalled();
    const rc = results.find((t) => t.id === 'rc_bash');
    expect(rc?.status).toBe('skipped');
    expect(rc?.label).toContain('install Starship first');
  });

  it('stops the chain and marks unrun tasks as cancelled when aborted', async () => {
    const controller = new AbortController();
    const deps = fakeDeps({
      installStarship: vi.fn(async () => {
        controller.abort();
      }),
    });

    const results = await runInstallTasks(
      state({ selectedShells: ['zsh'], installedShells: [] }),
      deps,
      vi.fn(),
      controller.signal
    );

    // Nothing after the abort point may run.
    expect(deps.installShell).not.toHaveBeenCalled();
    expect(deps.writeStarshipConfig).not.toHaveBeenCalled();
    expect(deps.applyShellConfig).not.toHaveBeenCalled();

    // And no unrun task may be left looking successful.
    expect(results.find((t) => t.id === 'config')?.status).toBe('failed');
    expect(results.find((t) => t.id === 'config')?.error).toBe('Cancelled');
    expect(results.find((t) => t.id === 'rc_zsh')?.status).toBe('failed');
    expect(results.every((t) => t.status !== 'pending')).toBe(true);
  });

  it('runs to completion when the signal never aborts', async () => {
    const controller = new AbortController();
    const deps = fakeDeps();

    const results = await runInstallTasks(
      state({ selectedShells: ['zsh'], installedShells: ['zsh'] }),
      deps,
      vi.fn(),
      controller.signal
    );

    expect(deps.writeStarshipConfig).toHaveBeenCalled();
    expect(results.find((t) => t.id === 'rc_zsh')?.status).toBe('done');
  });

  it('reports every task transition through onUpdate', async () => {
    const deps = fakeDeps();
    const onUpdate = vi.fn();
    await runInstallTasks(state({ selectedShells: ['zsh'] }), deps, onUpdate);

    expect(onUpdate).toHaveBeenCalledWith('starship', { status: 'running' });
    expect(onUpdate).toHaveBeenCalledWith('starship', { status: 'done' });
    expect(onUpdate).toHaveBeenCalledWith('config', { status: 'done' });
    expect(onUpdate).toHaveBeenCalledWith('rc_zsh', { status: 'done' });
  });
});
