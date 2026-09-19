import { describe, expect, it, vi } from 'vitest';
import { buildTaskList, runInstallTasks } from '../../services/installTasks.ts';
import { DEFAULT_STATE, NO_NERD_FONT, type WizardState } from '../../types.ts';
import { fakeDeps } from '../helpers/installTasks.ts';

function state(overrides: Partial<WizardState> = {}): WizardState {
  return { ...DEFAULT_STATE, packageManager: 'apt', ...overrides };
}

describe('runInstallTasks', () => {
  it('installs starship when it is missing and not skipped', async () => {
    const deps = fakeDeps();
    const results = await runInstallTasks(state(), deps, vi.fn());

    expect(deps.installStarship).toHaveBeenCalledWith('apt');
    expect(results.find((t) => t.id === 'starship')?.status).toBe('done');
  });

  it('skips the install when starship is already present', async () => {
    const deps = fakeDeps({
      isStarshipInstalled: vi.fn().mockResolvedValue({ installed: true, version: 'starship 1.20' }),
    });
    const results = await runInstallTasks(state(), deps, vi.fn());

    expect(deps.installStarship).not.toHaveBeenCalled();
    const starship = results.find((t) => t.id === 'starship');
    expect(starship?.status).toBe('skipped');
    expect(starship?.label).toContain('starship 1.20');
  });

  it('does not install or list starship when skipStarshipInstall is set', async () => {
    const deps = fakeDeps();
    const results = await runInstallTasks(state({ skipStarshipInstall: true }), deps, vi.fn());

    expect(deps.installStarship).not.toHaveBeenCalled();
    expect(results.some((t) => t.id === 'starship')).toBe(false);
  });

  it('installs a concrete nerd font but ignores the sentinel', async () => {
    const deps = fakeDeps();
    const withFont = await runInstallTasks(
      state({ nerdFontToInstall: { kind: 'install' as const, id: 'JetBrainsMono' } }),
      deps,
      vi.fn()
    );
    const withSentinel = await runInstallTasks(
      state({ nerdFontToInstall: NO_NERD_FONT }),
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

  it('writes a per-shell toml for each selected shell', async () => {
    const deps = fakeDeps();
    const results = await runInstallTasks(
      state({ selectedShells: ['bash', 'zsh'] }),
      deps,
      vi.fn()
    );

    expect(deps.generateToml).toHaveBeenCalledWith(expect.objectContaining({ step: 'welcome' }));
    expect(deps.writeShellConfig).toHaveBeenCalledWith('format = "$character"', 'bash');
    expect(deps.writeShellConfig).toHaveBeenCalledWith('format = "$character"', 'zsh');
    expect(results.find((t) => t.id === 'config')?.status).toBe('done');
  });

  it('reports the backup path when an existing per-shell config was replaced', async () => {
    const deps = fakeDeps({
      writeShellConfig: vi.fn(() => ({
        path: '/home/u/.config/starship/zsh.toml',
        backedUpTo: '/home/u/.config/starship/zsh.toml.bak-2026',
      })),
    });
    const results = await runInstallTasks(state({ selectedShells: ['zsh'] }), deps, vi.fn());

    expect(results.find((t) => t.id === 'config')?.note).toContain('zsh.toml.bak-2026');
  });

  it('backs up the shared config and reports it in the config note', async () => {
    const deps = fakeDeps({
      backupSharedConfig: vi.fn(() => '/home/u/.config/starship.toml.bak-2026'),
    });
    const results = await runInstallTasks(state({ selectedShells: ['zsh'] }), deps, vi.fn());

    expect(deps.backupSharedConfig).toHaveBeenCalled();
    expect(results.find((t) => t.id === 'config')?.note).toContain('shared config saved to');
    expect(results.find((t) => t.id === 'config')?.note).toContain('starship.toml.bak-2026');
  });

  it('keeps the config write going when the shared backup fails', async () => {
    const deps = fakeDeps({
      backupSharedConfig: vi.fn(() => {
        throw new Error('EACCES');
      }),
    });
    const results = await runInstallTasks(state({ selectedShells: ['zsh'] }), deps, vi.fn());

    const config = results.find((t) => t.id === 'config');
    expect(config?.status).toBe('done');
    expect(config?.note ?? '').not.toContain('shared config saved to');
    expect(deps.writeShellConfig).toHaveBeenCalled();
  });

  it('adopt mode keeps the shared config instead of writing per-shell files', async () => {
    const deps = fakeDeps();
    const results = await runInstallTasks(
      state({ keepExistingConfig: true, selectedShells: ['zsh'] }),
      deps,
      vi.fn()
    );

    const config = results.find((t) => t.id === 'config');
    expect(config?.label).toBe('Keep existing Starship config');
    expect(config?.status).toBe('done');
    expect(config?.note).toContain('keeping the existing config untouched');
    expect(deps.backupSharedConfig).toHaveBeenCalled();
    expect(deps.generateToml).not.toHaveBeenCalled();
    expect(deps.writeShellConfig).not.toHaveBeenCalled();
    expect(deps.writeSharedConfig).not.toHaveBeenCalled();
  });

  it('adopt mode wires shells to the shared config without a STARSHIP_CONFIG export', async () => {
    const deps = fakeDeps();
    await runInstallTasks(
      state({ keepExistingConfig: true, selectedShells: ['zsh', 'bash'] }),
      deps,
      vi.fn()
    );

    expect(deps.applyShellConfig).toHaveBeenCalledWith('zsh', {
      ensurePathDir: null,
      pointAtSharedConfig: true,
    });
    expect(deps.applyShellConfig).toHaveBeenCalledWith('bash', {
      ensurePathDir: null,
      pointAtSharedConfig: true,
    });
  });

  it('adopt mode places an imported config as the shared starship.toml', async () => {
    const deps = fakeDeps();
    const results = await runInstallTasks(
      state({
        keepExistingConfig: true,
        sharedConfigToml: '[character]\nsuccess_symbol = "…"',
        selectedShells: ['zsh'],
      }),
      deps,
      vi.fn()
    );

    expect(deps.writeSharedConfig).toHaveBeenCalledWith('[character]\nsuccess_symbol = "…"');
    expect(deps.writeShellConfig).not.toHaveBeenCalled();
    expect(deps.generateToml).not.toHaveBeenCalled();
    expect(results.find((t) => t.id === 'config')?.status).toBe('done');
  });

  it('adopt mode reports when an imported config replaced an existing one', async () => {
    const deps = fakeDeps({
      writeSharedConfig: vi.fn(() => ({
        path: '/home/u/.config/starship.toml',
        backedUpTo: '/home/u/.config/starship.toml.bak-2026',
      })),
    });
    const results = await runInstallTasks(
      state({ keepExistingConfig: true, sharedConfigToml: '# import', selectedShells: ['zsh'] }),
      deps,
      vi.fn()
    );

    expect(results.find((t) => t.id === 'config')?.note).toContain('starship.toml.bak-2026');
  });

  it('verifies each written config through the real starship binary', async () => {
    const deps = fakeDeps({
      isStarshipInstalled: vi.fn().mockResolvedValue({ installed: true, version: 'starship 1.20' }),
    });
    const results = await runInstallTasks(
      state({ selectedShells: ['zsh', 'bash'], installedShells: ['zsh', 'bash'] }),
      deps,
      vi.fn()
    );

    expect(deps.verifyConfig).toHaveBeenCalledTimes(2);
    expect(deps.verifyConfig).toHaveBeenCalledWith(expect.stringContaining('zsh.toml'));
    expect(deps.verifyConfig).toHaveBeenCalledWith(expect.stringContaining('bash.toml'));
    expect(results.find((t) => t.id === 'verify')?.status).toBe('done');
  });

  it('verifies the imported shared config in adopt mode', async () => {
    const deps = fakeDeps({
      isStarshipInstalled: vi.fn().mockResolvedValue({ installed: true, version: 'starship 1.20' }),
    });
    const results = await runInstallTasks(
      state({
        keepExistingConfig: true,
        sharedConfigToml: '[character]\nsuccess_symbol = "…"',
        selectedShells: ['zsh'],
        installedShells: ['zsh'],
      }),
      deps,
      vi.fn()
    );

    expect(deps.verifyConfig).toHaveBeenCalledTimes(1);
    expect(deps.verifyConfig).toHaveBeenCalledWith(expect.stringContaining('starship.toml'));
    expect(results.find((t) => t.id === 'verify')?.status).toBe('done');
  });

  it('skips verification when keeping an untouched existing config', async () => {
    const deps = fakeDeps({
      isStarshipInstalled: vi.fn().mockResolvedValue({ installed: true, version: 'starship 1.20' }),
    });
    const results = await runInstallTasks(
      state({ keepExistingConfig: true, selectedShells: ['zsh'], installedShells: ['zsh'] }),
      deps,
      vi.fn()
    );

    expect(deps.verifyConfig).not.toHaveBeenCalled();
    const verify = results.find((t) => t.id === 'verify');
    expect(verify?.status).toBe('skipped');
    expect(verify?.note).toBe('nothing written to verify');
  });

  it('skips verification when starship is not on PATH', async () => {
    const deps = fakeDeps();
    const results = await runInstallTasks(
      state({ selectedShells: ['zsh'], installedShells: ['zsh'] }),
      deps,
      vi.fn()
    );

    expect(deps.verifyConfig).not.toHaveBeenCalled();
    expect(results.find((t) => t.id === 'verify')?.note).toBe('starship not on PATH');
  });

  it('skips verification when the config write already failed', async () => {
    const deps = fakeDeps({
      isStarshipInstalled: vi.fn().mockResolvedValue({ installed: true, version: 'starship 1.20' }),
      writeShellConfig: vi.fn(() => {
        throw new Error('permission denied');
      }),
    });
    const results = await runInstallTasks(state({ selectedShells: ['zsh'] }), deps, vi.fn());

    expect(deps.verifyConfig).not.toHaveBeenCalled();
    const verify = results.find((t) => t.id === 'verify');
    expect(verify?.status).toBe('skipped');
    expect(verify?.note).toBe('no config was written');
  });

  it('fails the verify task when starship rejects a written config', async () => {
    const deps = fakeDeps({
      isStarshipInstalled: vi.fn().mockResolvedValue({ installed: true, version: 'starship 1.20' }),
      verifyConfig: vi.fn().mockRejectedValue(new Error('TOML parse error at line 3')),
    });
    const results = await runInstallTasks(state({ selectedShells: ['zsh'] }), deps, vi.fn());

    const verify = results.find((t) => t.id === 'verify');
    expect(verify?.status).toBe('failed');
    expect(verify?.error).toContain('TOML parse error');
  });

  it('regenerates the config without nerd font glyphs when the font install fails', async () => {
    const deps = fakeDeps({
      installNerdFont: vi.fn().mockRejectedValue(new Error('no network')),
    });
    const results = await runInstallTasks(
      state({
        selectedShells: ['zsh'],
        nerdFontToInstall: { kind: 'install' as const, id: 'JetBrainsMono' },
        hasNerdFont: true,
      }),
      deps,
      vi.fn()
    );

    expect(deps.generateToml).toHaveBeenCalledWith(expect.objectContaining({ hasNerdFont: false }));
    expect(results.find((t) => t.id === 'config')?.note).toContain('without Nerd Font glyphs');
  });

  it('keeps nerd font glyphs when the font install succeeds', async () => {
    const deps = fakeDeps();
    await runInstallTasks(
      state({
        selectedShells: ['zsh'],
        nerdFontToInstall: { kind: 'install' as const, id: 'JetBrainsMono' },
        hasNerdFont: true,
      }),
      deps,
      vi.fn()
    );

    expect(deps.generateToml).toHaveBeenCalledWith(expect.objectContaining({ hasNerdFont: true }));
  });

  it('fails the rc steps instead of running them when the config write failed', async () => {
    const deps = fakeDeps({
      writeShellConfig: vi.fn(() => {
        throw new Error('permission denied');
      }),
    });
    const results = await runInstallTasks(
      state({ selectedShells: ['zsh', 'bash'] }),
      deps,
      vi.fn()
    );

    const config = results.find((t) => t.id === 'config');
    expect(config?.status).toBe('failed');
    expect(config?.error).toContain('permission denied');
    // Wiring a shell to a config that was never written would init Starship
    // against a missing file — the rc step must fail, not run.
    expect(deps.applyShellConfig).not.toHaveBeenCalled();
    expect(results.find((t) => t.id === 'rc_zsh')?.status).toBe('failed');
    expect(results.find((t) => t.id === 'rc_zsh')?.error).toContain('permission denied');
    expect(results.find((t) => t.id === 'rc_bash')?.status).toBe('failed');
  });

  it('still applies rc files after a successful config write', async () => {
    const deps = fakeDeps();
    const results = await runInstallTasks(state({ selectedShells: ['zsh'] }), deps, vi.fn());

    expect(deps.applyShellConfig).toHaveBeenCalledWith('zsh', expect.anything());
    expect(results.find((t) => t.id === 'rc_zsh')?.status).toBe('done');
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
      pointAtSharedConfig: false,
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
    expect(deps.writeShellConfig).not.toHaveBeenCalled();
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

    expect(deps.writeShellConfig).toHaveBeenCalled();
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

  it('resets STARSHIP_CONFIG on starship shells not given their own config', async () => {
    const deps = fakeDeps({
      getShellsUsingStarship: vi.fn().mockResolvedValue(['bash', 'fish', 'zsh']),
    });
    await runInstallTasks(
      state({ selectedShells: ['zsh'], installedShells: ['zsh'] }),
      deps,
      vi.fn()
    );

    // bash and fish are not getting their own config, so they must be reset so they
    // never inherit zsh's exported STARSHIP_CONFIG. zsh is selected, so it is skipped.
    expect(deps.resetSharedShellConfig).toHaveBeenCalledWith('bash');
    expect(deps.resetSharedShellConfig).toHaveBeenCalledWith('fish');
    expect(deps.resetSharedShellConfig).not.toHaveBeenCalledWith('zsh');
  });

  it('does not reset shells when starship install is skipped', async () => {
    const deps = fakeDeps({
      getShellsUsingStarship: vi.fn().mockResolvedValue(['bash', 'zsh']),
    });
    await runInstallTasks(
      state({ skipStarshipInstall: true, selectedShells: ['zsh'], installedShells: ['zsh'] }),
      deps,
      vi.fn()
    );

    expect(deps.resetSharedShellConfig).not.toHaveBeenCalled();
  });
});

describe('buildTaskList', () => {
  it('adds an install task with a plain label when the package manager has the shell', () => {
    const tasks = buildTaskList(
      state({ packageManager: 'apt', selectedShells: ['zsh'], installedShells: [] })
    );

    const shellTask = tasks.find((t) => t.id === 'shell_zsh');
    expect(shellTask?.label).toBe('Install zsh');
  });

  it('tags a shell the package manager cannot install as manual', () => {
    const tasks = buildTaskList(
      state({ packageManager: 'apt', selectedShells: ['powershell'], installedShells: [] })
    );

    const shellTask = tasks.find((t) => t.id === 'shell_powershell');
    expect(shellTask?.label).toBe('Install powershell (manual)');
  });

  it('tags every missing shell as manual under the script fallback', () => {
    const tasks = buildTaskList(
      state({ packageManager: 'script', selectedShells: ['zsh', 'bash'], installedShells: [] })
    );

    expect(tasks.find((t) => t.id === 'shell_zsh')?.label).toBe('Install zsh (manual)');
    expect(tasks.find((t) => t.id === 'shell_bash')?.label).toBe('Install bash (manual)');
  });

  it('appends a verify task when starship will be installed', () => {
    const tasks = buildTaskList(state({ selectedShells: ['zsh'], installedShells: ['zsh'] }));

    expect(tasks.find((t) => t.id === 'verify')?.label).toBe('Verify config');
  });

  it('omits the verify task when starship install is skipped', () => {
    const tasks = buildTaskList(state({ skipStarshipInstall: true }));

    expect(tasks.some((t) => t.id === 'verify')).toBe(false);
  });
});
