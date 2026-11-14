import { describe, expect, it, vi } from 'vitest';
import { generateToml } from '../../generators/starship.ts';
import { buildTaskList, configIfFontFails, runInstallTasks } from '../../services/installTasks.ts';
import { DEFAULT_STATE, NO_NERD_FONT, type WizardState } from '../../types.ts';
import { fakeDeps } from '../helpers/installTasks.ts';

function state(overrides: Partial<WizardState> = {}): WizardState {
  return { ...DEFAULT_STATE, packageManager: 'apt', ...overrides };
}

describe('runInstallTasks', () => {
  it('installs starship when it is missing and not skipped', async () => {
    const deps = fakeDeps();
    const results = await runInstallTasks(state(), deps, vi.fn());

    expect(deps.installStarship).toHaveBeenCalledWith('apt', undefined);
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

  it('passes the cancel signal to the install steps', async () => {
    const controller = new AbortController();
    const deps = fakeDeps();

    await runInstallTasks(
      state({
        selectedShells: ['zsh'],
        installedShells: [],
        nerdFontToInstall: { kind: 'install' as const, id: 'JetBrainsMono' },
      }),
      deps,
      vi.fn(),
      controller.signal
    );

    expect(deps.installStarship).toHaveBeenCalledWith('apt', controller.signal);
    expect(deps.installNerdFont).toHaveBeenCalledWith('JetBrainsMono', controller.signal);
    expect(deps.installShell).toHaveBeenCalledWith('zsh', 'apt', controller.signal);
  });

  it('does not install or list starship when skipStarshipInstall is set', async () => {
    const deps = fakeDeps();
    const results = await runInstallTasks(state({ skipStarshipInstall: true }), deps, vi.fn());

    expect(deps.installStarship).not.toHaveBeenCalled();
    expect(results.some((t) => t.id === 'starship')).toBe(false);
  });

  it('records the version a fresh install produced, for the doctor drift check', async () => {
    const deps = fakeDeps({
      isStarshipInstalled: vi
        .fn()
        .mockResolvedValueOnce({ installed: false })
        .mockResolvedValue({ installed: true, version: 'starship 1.21.0' }),
    });
    await runInstallTasks(state(), deps, vi.fn());

    expect(deps.recordStarshipVersion).toHaveBeenCalledWith('starship 1.21.0');
  });

  it('records the version of a script install that PATH cannot see yet', async () => {
    const deps = fakeDeps({
      // Nothing is there before the install; the script then lands it off PATH.
      getMissingStarshipPathDir: vi
        .fn<() => string | null>()
        .mockReturnValueOnce(null)
        .mockReturnValue('/home/u/.local/bin'),
      readStarshipVersion: vi.fn().mockResolvedValue('starship 1.21.0'),
    });
    await runInstallTasks(state(), deps, vi.fn());

    expect(deps.readStarshipVersion).toHaveBeenCalledWith('/home/u/.local/bin');
    expect(deps.recordStarshipVersion).toHaveBeenCalledWith('starship 1.21.0');
  });

  it('does not fail the install when the version cache cannot be written', async () => {
    const deps = fakeDeps({
      isStarshipInstalled: vi
        .fn()
        .mockResolvedValueOnce({ installed: false })
        .mockResolvedValue({ installed: true, version: 'starship 1.21.0' }),
      recordStarshipVersion: vi.fn(() => {
        throw new Error('EACCES');
      }),
    });
    const results = await runInstallTasks(state(), deps, vi.fn());

    expect(results.find((t) => t.id === 'starship')?.status).toBe('done');
  });

  it('does not record a version when the fresh install cannot report one', async () => {
    const deps = fakeDeps({
      isStarshipInstalled: vi.fn().mockResolvedValue({ installed: false }),
    });
    await runInstallTasks(state(), deps, vi.fn());

    expect(deps.recordStarshipVersion).not.toHaveBeenCalled();
  });

  it('installs a concrete nerd font and none when no font was chosen', async () => {
    const deps = fakeDeps();
    const withFont = await runInstallTasks(
      state({ nerdFontToInstall: { kind: 'install' as const, id: 'JetBrainsMono' } }),
      deps,
      vi.fn()
    );
    const withoutFont = await runInstallTasks(
      state({ nerdFontToInstall: NO_NERD_FONT }),
      deps,
      vi.fn()
    );

    expect(deps.installNerdFont).toHaveBeenCalledTimes(1);
    expect(deps.installNerdFont).toHaveBeenCalledWith('JetBrainsMono', undefined);
    expect(withFont.find((t) => t.id === 'font')?.status).toBe('done');
    expect(withoutFont.some((t) => t.id === 'font')).toBe(false);
  });

  it('skips the font install inside a container', async () => {
    const deps = fakeDeps();
    const results = await runInstallTasks(
      state({
        nerdFontToInstall: { kind: 'install' as const, id: 'JetBrainsMono' },
        container: true,
      }),
      deps,
      vi.fn()
    );

    expect(deps.installNerdFont).not.toHaveBeenCalled();
    expect(results.some((t) => t.id === 'font')).toBe(false);
    expect(results.some((t) => t.id === 'terminal')).toBe(false);
  });

  it('installs only the shells that are missing', async () => {
    const deps = fakeDeps();
    const results = await runInstallTasks(
      state({ selectedShells: ['bash', 'zsh'], installedShells: ['bash'] }),
      deps,
      vi.fn()
    );

    expect(deps.installShell).toHaveBeenCalledTimes(1);
    expect(deps.installShell).toHaveBeenCalledWith('zsh', 'apt', undefined);
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

  it('does not write rc files when the Starship install failed', async () => {
    const deps = fakeDeps({
      installStarship: vi.fn().mockRejectedValue(new Error('no route to host')),
    });
    const results = await runInstallTasks(state({ selectedShells: ['zsh'] }), deps, vi.fn());

    expect(deps.applyShellConfig).not.toHaveBeenCalled();
    expect(results.find((t) => t.id === 'rc_zsh')).toMatchObject({
      status: 'failed',
      error: 'Starship was not installed',
    });
  });

  it('does not write the rc file of a shell whose install failed', async () => {
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

    expect(deps.applyShellConfig).toHaveBeenCalledTimes(1);
    expect(deps.applyShellConfig).toHaveBeenCalledWith('fish', expect.anything());
    expect(results.find((t) => t.id === 'rc_zsh')).toMatchObject({
      status: 'failed',
      error: 'Install of zsh failed',
    });
  });

  it('does not run chsh for a shell whose install failed', async () => {
    const deps = fakeDeps({
      installShell: vi.fn().mockRejectedValue(new Error('no package')),
    });
    const results = await runInstallTasks(
      state({ selectedShells: ['zsh'], installedShells: [], setDefaultShell: 'zsh' }),
      deps,
      vi.fn()
    );

    expect(deps.setDefaultShell).not.toHaveBeenCalled();
    expect(results.find((t) => t.id === 'chsh')).toMatchObject({ status: 'failed' });
    expect(results.find((t) => t.id === 'chsh')?.error).toMatch(/its install failed/);
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
    expect(deps.setDefaultShell).toHaveBeenCalledWith('zsh', undefined);
    expect(results.find((t) => t.id === 'chsh')?.status).toBe('done');
  });

  it('skips chsh inside a container', async () => {
    const deps = fakeDeps();
    const results = await runInstallTasks(
      state({ setDefaultShell: 'zsh', container: true }),
      deps,
      vi.fn()
    );

    expect(deps.setDefaultShell).not.toHaveBeenCalled();
    expect(results.some((t) => t.id === 'chsh')).toBe(false);
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

  it('adopt mode says Starship falls back to its defaults when no shared config exists', async () => {
    const deps = fakeDeps({ sharedConfigExists: vi.fn(() => false) });
    const results = await runInstallTasks(
      state({ keepExistingConfig: true, selectedShells: ['zsh'] }),
      deps,
      vi.fn()
    );

    const config = results.find((t) => t.id === 'config');
    expect(config?.status).toBe('done');
    expect(config?.note).toContain('Starship will use its defaults');
    expect(config?.note).not.toContain('keeping the existing config untouched');
    expect(deps.backupSharedConfig).not.toHaveBeenCalled();
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

  it('runs verification after the rc steps, matching the plan order', async () => {
    const order: string[] = [];
    const deps = fakeDeps({
      isStarshipInstalled: vi.fn().mockResolvedValue({ installed: true, version: 'starship 1.20' }),
      applyShellConfig: vi.fn(() => {
        order.push('rc');
        return { applied: true };
      }),
      verifyConfig: vi.fn(() => {
        order.push('verify');
        return Promise.resolve();
      }),
    });
    const onUpdate = vi.fn();
    await runInstallTasks(
      state({ selectedShells: ['zsh'], installedShells: ['zsh'] }),
      deps,
      onUpdate
    );

    expect(order).toEqual(['rc', 'verify']);
    // And the task status transitions confirm verify did not run before rc.
    const running = onUpdate.mock.calls.filter(([, p]) => p.status === 'running');
    expect(running.map(([id]) => id)).toEqual(
      expect.arrayContaining([expect.stringContaining('rc_'), 'verify'])
    );
  });

  it('wires the detected terminal to the installed nerd font', async () => {
    const deps = fakeDeps();
    const results = await runInstallTasks(
      state({
        selectedShells: ['zsh'],
        nerdFontToInstall: { kind: 'install' as const, id: 'JetBrainsMono' },
        terminal: 'kitty',
      }),
      deps,
      vi.fn()
    );

    expect(deps.wireTerminalFont).toHaveBeenCalledWith('kitty', 'JetBrainsMono Nerd Font');
    expect(results.find((t) => t.id === 'terminal')?.status).toBe('done');
  });

  it('skips terminal wiring when the font install failed', async () => {
    const deps = fakeDeps({
      installNerdFont: vi.fn().mockRejectedValue(new Error('no network')),
    });
    const results = await runInstallTasks(
      state({
        selectedShells: ['zsh'],
        nerdFontToInstall: { kind: 'install' as const, id: 'JetBrainsMono' },
        terminal: 'kitty',
      }),
      deps,
      vi.fn()
    );

    expect(deps.wireTerminalFont).not.toHaveBeenCalled();
    const terminal = results.find((t) => t.id === 'terminal');
    expect(terminal?.status).toBe('skipped');
    expect(terminal?.note).toBe('font install failed');
  });

  it('reports a manual terminal (wezterm) as skipped with its snippet', async () => {
    const deps = fakeDeps({
      wireTerminalFont: vi.fn(() => ({
        applied: false,
        note: 'add config.font = wezterm.font(...)',
      })),
    });
    const results = await runInstallTasks(
      state({
        selectedShells: ['zsh'],
        nerdFontToInstall: { kind: 'install' as const, id: 'JetBrainsMono' },
        terminal: 'wezterm',
      }),
      deps,
      vi.fn()
    );

    expect(deps.wireTerminalFont).toHaveBeenCalledWith('wezterm', 'JetBrainsMono Nerd Font');
    const terminal = results.find((t) => t.id === 'terminal');
    expect(terminal?.status).toBe('skipped');
    expect(terminal?.note).toContain('wezterm.font');
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

  it('verifies every written config and names each one that fails', async () => {
    const deps = fakeDeps({
      isStarshipInstalled: vi.fn().mockResolvedValue({ installed: true, version: 'starship 1.20' }),
      verifyConfig: vi.fn(async (configPath: string) => {
        if (configPath.endsWith('zsh.toml')) throw new Error('unknown key');
      }),
    });
    const results = await runInstallTasks(
      state({ selectedShells: ['zsh', 'bash'] }),
      deps,
      vi.fn()
    );

    expect(deps.verifyConfig).toHaveBeenCalledTimes(2);
    const verify = results.find((t) => t.id === 'verify');
    expect(verify?.status).toBe('failed');
    expect(verify?.error).toMatch(/zsh\.toml: unknown key$/);
    expect(verify?.error).not.toContain('bash.toml');
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

  it('still wires the shells whose config was written when another shell fails', async () => {
    const deps = fakeDeps({
      isStarshipInstalled: vi.fn().mockResolvedValue({ installed: true, version: 'starship 1.20' }),
      writeShellConfig: vi.fn((_toml: string, shellId: string) => {
        if (shellId === 'bash') throw new Error('permission denied');
        return { path: `/home/u/.config/starship/${shellId}.toml` };
      }),
    });
    const results = await runInstallTasks(
      state({ selectedShells: ['zsh', 'bash'] }),
      deps,
      vi.fn()
    );

    const config = results.find((t) => t.id === 'config');
    expect(config?.status).toBe('failed');
    expect(config?.error).toBe('bash: permission denied');
    expect(results.find((t) => t.id === 'rc_zsh')?.status).toBe('done');
    expect(results.find((t) => t.id === 'rc_bash')?.status).toBe('failed');
    expect(deps.applyShellConfig).toHaveBeenCalledTimes(1);
    expect(deps.verifyConfig).toHaveBeenCalledTimes(1);
    expect(deps.verifyConfig).toHaveBeenCalledWith(expect.stringContaining('zsh.toml'));
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

  it('runs nothing and leaves nothing pending when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const deps = fakeDeps();

    const results = await runInstallTasks(
      state({ selectedShells: ['zsh'], installedShells: ['zsh'] }),
      deps,
      vi.fn(),
      controller.signal
    );

    expect(deps.getShellsUsingStarship).not.toHaveBeenCalled();
    expect(deps.installStarship).not.toHaveBeenCalled();
    expect(deps.writeShellConfig).not.toHaveBeenCalled();
    expect(results.every((t) => t.status === 'failed' && t.error === 'Cancelled')).toBe(true);
  });

  it('fails the config step when no shell was selected', async () => {
    const results = await runInstallTasks(state({ selectedShells: [] }), fakeDeps(), vi.fn());
    expect(results.find((t) => t.id === 'config')).toMatchObject({
      status: 'failed',
      error: 'No shells selected — nothing to configure',
    });
  });

  it('keeps a fresh install done when its version cannot be recorded', async () => {
    const deps = fakeDeps({
      isStarshipInstalled: vi
        .fn()
        .mockResolvedValueOnce({ installed: false })
        .mockResolvedValue({ installed: true, version: 'starship 1.27.0' }),
      recordStarshipVersion: vi.fn(() => {
        throw new Error('EROFS');
      }),
    });

    const results = await runInstallTasks(state({ selectedShells: ['zsh'] }), deps, vi.fn());

    expect(deps.recordStarshipVersion).toHaveBeenCalledWith('starship 1.27.0');
    expect(results.find((t) => t.id === 'starship')?.status).toBe('done');
  });

  it('plans no reset rows when probing for Starship shells fails', async () => {
    const deps = fakeDeps({ getShellsUsingStarship: vi.fn().mockRejectedValue(new Error('ps')) });

    const results = await runInstallTasks(state({ selectedShells: ['zsh'] }), deps, vi.fn());

    expect(results.some((t) => t.id.startsWith('reset_'))).toBe(false);
    expect(results.find((t) => t.id === 'config')?.status).toBe('done');
  });

  it('verifies through the script install dir and says so', async () => {
    const deps = fakeDeps({ getMissingStarshipPathDir: vi.fn(() => '/home/u/.local/bin') });

    const results = await runInstallTasks(
      state({ selectedShells: ['zsh'], installedShells: ['zsh'] }),
      deps,
      vi.fn()
    );

    expect(deps.verifyConfig).toHaveBeenCalledWith(expect.any(String), '/home/u/.local/bin');
    expect(results.find((t) => t.id === 'verify')?.note).toBe(
      'verified 1 config(s) (via /home/u/.local/bin)'
    );
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

  it('lists each reset as its own task and survives one failing shell', async () => {
    const deps = fakeDeps({
      getShellsUsingStarship: vi.fn().mockResolvedValue(['bash', 'fish']),
      resetSharedShellConfig: vi
        .fn()
        .mockImplementationOnce(() => {
          throw new Error('rc is a directory');
        })
        .mockReturnValueOnce({ applied: true }),
    });
    const results = await runInstallTasks(
      state({ selectedShells: ['zsh'], installedShells: ['zsh'] }),
      deps,
      vi.fn()
    );

    expect(deps.resetSharedShellConfig).toHaveBeenCalledTimes(2);
    expect(results.find((t) => t.id === 'reset_bash')).toMatchObject({
      status: 'failed',
      error: 'rc is a directory',
    });
    expect(results.find((t) => t.id === 'reset_fish')?.status).toBe('done');
  });

  it('puts the reset rows in the plan before any task runs', async () => {
    const onUpdate = vi.fn();
    const deps = fakeDeps({ getShellsUsingStarship: vi.fn().mockResolvedValue(['bash', 'zsh']) });

    await runInstallTasks(
      state({ selectedShells: ['zsh'], installedShells: ['zsh', 'bash'] }),
      deps,
      onUpdate
    );

    expect(onUpdate.mock.calls[0]).toEqual([
      'reset_bash',
      { label: 'Clear old STARSHIP_CONFIG in bash', status: 'pending' },
    ]);
    expect(deps.resetSharedShellConfig).toHaveBeenCalledTimes(1);
    expect(deps.resetSharedShellConfig).toHaveBeenCalledWith('bash');
  });

  it('marks planned reset rows cancelled when the run is aborted before them', async () => {
    const controller = new AbortController();
    const deps = fakeDeps({
      getShellsUsingStarship: vi.fn().mockResolvedValue(['bash']),
      installStarship: vi.fn(async () => {
        controller.abort();
      }),
    });

    const results = await runInstallTasks(
      state({ selectedShells: ['zsh'], installedShells: ['zsh', 'bash'] }),
      deps,
      vi.fn(),
      controller.signal
    );

    const reset = results.find((t) => t.id === 'reset_bash');
    expect(reset?.status).toBe('failed');
    expect(reset?.error).toBe('Cancelled');
    expect(deps.resetSharedShellConfig).not.toHaveBeenCalled();
  });

  it('does not probe reset shells after the run was cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const deps = fakeDeps();

    const results = await runInstallTasks(
      state({ selectedShells: ['zsh'], installedShells: ['zsh'] }),
      deps,
      vi.fn(),
      controller.signal
    );

    expect(deps.getShellsUsingStarship).not.toHaveBeenCalled();
    expect(results.every((t) => t.status !== 'pending')).toBe(true);
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

describe('existing script install', () => {
  it('does not install Starship again when it sits off PATH in the script bin dir', async () => {
    const deps = fakeDeps({
      getMissingStarshipPathDir: vi.fn(() => '/home/u/.local/bin'),
      readStarshipVersion: vi.fn().mockResolvedValue('starship 1.27.0'),
    });
    const results = await runInstallTasks(state({ selectedShells: ['zsh'] }), deps, vi.fn());

    expect(deps.installStarship).not.toHaveBeenCalled();
    const task = results.find((t) => t.id === 'starship');
    expect(task).toMatchObject({ status: 'skipped', label: 'Starship (starship 1.27.0)' });
    expect(deps.applyShellConfig).toHaveBeenCalledWith(
      'zsh',
      expect.objectContaining({ ensurePathDir: '/home/u/.local/bin' })
    );
  });
});

describe('buildTaskList', () => {
  it('lists a reset row after verify for each unselected shell to clear', () => {
    const tasks = buildTaskList(state({ selectedShells: ['zsh'] }), ['bash', 'zsh']);

    expect(tasks.map((t) => t.id).slice(-2)).toEqual(['verify', 'reset_bash']);
    expect(tasks.at(-1)?.label).toBe('Clear old STARSHIP_CONFIG in bash');
  });

  it('plans no reset rows when Starship is skipped', () => {
    const tasks = buildTaskList(state({ skipStarshipInstall: true, selectedShells: ['zsh'] }), [
      'bash',
    ]);

    expect(tasks.some((t) => t.id === 'reset_bash')).toBe(false);
  });

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

  it('adds a terminal font task when a font and terminal are known', () => {
    const tasks = buildTaskList(
      state({
        nerdFontToInstall: { kind: 'install' as const, id: 'FiraCode' },
        terminal: 'ghostty',
      })
    );

    expect(tasks.find((t) => t.id === 'terminal')?.label).toBe('Set Ghostty font');
  });

  it('omits the terminal task without a detected terminal', () => {
    const tasks = buildTaskList(
      state({ nerdFontToInstall: { kind: 'install' as const, id: 'FiraCode' } })
    );

    expect(tasks.some((t) => t.id === 'terminal')).toBe(false);
  });

  it('omits the font, terminal and chsh tasks inside a container', () => {
    const tasks = buildTaskList(
      state({
        nerdFontToInstall: { kind: 'install' as const, id: 'FiraCode' },
        terminal: 'ghostty',
        setDefaultShell: 'zsh',
        container: true,
      })
    );

    expect(tasks.some((t) => t.id === 'font')).toBe(false);
    expect(tasks.some((t) => t.id === 'terminal')).toBe(false);
    expect(tasks.some((t) => t.id === 'chsh')).toBe(false);
    expect(tasks.some((t) => t.id === 'config')).toBe(true);
  });

  it('includes starship and config tasks by default', () => {
    const tasks = buildTaskList(DEFAULT_STATE);
    expect(tasks.map((t) => t.id)).toContain('starship');
    expect(tasks.map((t) => t.id)).toContain('config');
  });

  it('emits one rc task per selected shell', () => {
    const tasks = buildTaskList({ ...DEFAULT_STATE, selectedShells: ['zsh', 'fish'] });
    expect(tasks.map((t) => t.id)).toContain('rc_zsh');
    expect(tasks.map((t) => t.id)).toContain('rc_fish');
    expect(tasks.map((t) => t.id)).not.toContain('rc');
  });

  it('omits the starship task when skipStarshipInstall is set', () => {
    const tasks = buildTaskList({ ...DEFAULT_STATE, skipStarshipInstall: true });
    expect(tasks.map((t) => t.id)).not.toContain('starship');
  });

  it('omits the font task when no font is being installed', () => {
    const tasks = buildTaskList({ ...DEFAULT_STATE, nerdFontToInstall: NO_NERD_FONT });
    expect(tasks.map((t) => t.id)).not.toContain('font');
  });

  it('adds a font task with the font label for a concrete font id', () => {
    const tasks = buildTaskList({
      ...DEFAULT_STATE,
      nerdFontToInstall: { kind: 'install' as const, id: 'JetBrainsMono' },
    });
    const font = tasks.find((t) => t.id === 'font');
    expect(font?.label).toBe('Nerd Font (JetBrains Mono)');
    expect(font?.status).toBe('pending');
  });

  it('falls back to the raw id when the font is unknown', () => {
    const tasks = buildTaskList({
      ...DEFAULT_STATE,
      nerdFontToInstall: { kind: 'install' as const, id: 'SomeFont' },
    });
    expect(tasks.find((t) => t.id === 'font')?.label).toBe('Nerd Font (SomeFont)');
  });

  it('adds shell install tasks only for shells not already installed', () => {
    const tasks = buildTaskList({
      ...DEFAULT_STATE,
      selectedShells: ['zsh', 'bash'],
      installedShells: ['zsh'],
    });
    const ids = tasks.map((t) => t.id);
    expect(ids).not.toContain('shell_zsh');
    expect(ids).toContain('shell_bash');
  });

  it('does not add shell install tasks when all selected shells are installed', () => {
    const tasks = buildTaskList({
      ...DEFAULT_STATE,
      selectedShells: ['zsh'],
      installedShells: ['zsh'],
    });
    expect(tasks.map((t) => t.id)).not.toContain('shell_zsh');
  });

  it('adds a chsh task when a default shell is selected', () => {
    const tasks = buildTaskList({ ...DEFAULT_STATE, setDefaultShell: 'zsh' });
    const chsh = tasks.find((t) => t.id === 'chsh');
    expect(chsh?.label).toBe('Set zsh as default shell');
  });

  it('omits the chsh task when no default shell is selected', () => {
    const tasks = buildTaskList({ ...DEFAULT_STATE, setDefaultShell: null });
    expect(tasks.map((t) => t.id)).not.toContain('chsh');
  });

  it('builds the full task set for a complete run', () => {
    const tasks = buildTaskList({
      ...DEFAULT_STATE,
      selectedShells: ['zsh', 'bash'],
      installedShells: ['zsh'],
      nerdFontToInstall: { kind: 'install' as const, id: 'FiraCode' },
      setDefaultShell: 'zsh',
    });
    const ids = tasks.map((t) => t.id);
    expect(ids).toEqual([
      'starship',
      'font',
      'shell_bash',
      'chsh',
      'config',
      'rc_zsh',
      'rc_bash',
      'verify',
    ]);
    expect(tasks.every((t) => t.status === 'pending')).toBe(true);
  });
});

describe('configIfFontFails', () => {
  const withFont: WizardState = {
    ...DEFAULT_STATE,
    hasNerdFont: true,
    nerdFontToInstall: { kind: 'install', id: 'JetBrainsMono' },
  };

  it('is the glyph-free config a failed font install leads to', () => {
    const fallback = configIfFontFails(withFont);
    expect(fallback).toBe(generateToml({ ...withFont, hasNerdFont: false }));
    expect(fallback).not.toBe(generateToml(withFont));
  });

  it('is null without a font install, in a container, or in adopt mode', () => {
    expect(configIfFontFails({ ...withFont, nerdFontToInstall: NO_NERD_FONT })).toBeNull();
    expect(configIfFontFails({ ...withFont, container: true })).toBeNull();
    expect(configIfFontFails({ ...withFont, keepExistingConfig: true })).toBeNull();
  });
});
