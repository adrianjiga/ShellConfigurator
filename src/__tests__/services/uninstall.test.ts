import { describe, expect, it, vi } from 'vitest';
import { getShell } from '../../config/shells.ts';
import { getShellConfigPath } from '../../generators/shellRc.ts';
import { getNerdFontsDir } from '../../services/installer.ts';
import {
  formatUninstallReport,
  planUninstall,
  runUninstall,
  type UninstallDeps,
} from '../../services/uninstall.ts';
import type { ShellId } from '../../types.ts';

function makeDeps(
  wired: ShellId[] = [],
  configs: ShellId[] = [],
  overrides: Partial<UninstallDeps> = {}
): UninstallDeps {
  return {
    hasManagedRcBlock: vi.fn((id: ShellId) => wired.includes(id)),
    hasShellConfig: vi.fn((id: ShellId) => configs.includes(id)),
    removeManagedRcBlocks: vi.fn(() => ({ removed: true, backedUpTo: '/h/.zshrc.bak-1' })),
    removeShellConfigFile: vi.fn(() => ({ removed: true, backedUpTo: '/h/zsh.toml.bak-1' })),
    detectPackageManager: vi.fn().mockResolvedValue('brew'),
    plannedStarshipRemoval: vi.fn(() => ({
      kind: 'package' as const,
      pm: 'brew' as const,
      command: ['brew', 'uninstall', 'starship'],
    })),
    removeStarship: vi.fn().mockResolvedValue(undefined),
    forgetStarshipVersion: vi.fn(),
    installedFontFiles: vi.fn().mockResolvedValue(['/f/A.ttf', '/f/B.ttf']),
    removeFontFiles: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const ids = (steps: { id: string }[]) => steps.map((s) => s.id);

describe('planUninstall', () => {
  it('covers every shell with an rc block or a config by default', async () => {
    const steps = await planUninstall({}, makeDeps(['zsh', 'fish'], ['zsh', 'bash']));
    expect(ids(steps)).toEqual(['rc_zsh', 'config_zsh', 'config_bash', 'rc_fish']);
  });

  it('reads each shell once', async () => {
    const deps = makeDeps(['zsh'], ['zsh']);
    await planUninstall({}, deps);
    expect(deps.hasManagedRcBlock).toHaveBeenCalledTimes(5);
    expect(deps.hasShellConfig).toHaveBeenCalledTimes(5);
  });

  it('plans nothing on a machine ShellConfigurator never touched', async () => {
    expect(await planUninstall({}, makeDeps())).toEqual([]);
  });

  it('says so for an explicitly named shell with nothing to remove', async () => {
    const [step] = await planUninstall({ shells: ['bash'] }, makeDeps(['zsh'], ['zsh']));
    expect(step).toEqual({
      id: 'rc_bash',
      title: 'Bash rc',
      detail: `no ShellConfigurator lines in ${getShell('bash')!.rcFile}`,
    });
  });

  it('leaves a hand-set-up shell to the user but still moves its config aside', async () => {
    const steps = await planUninstall({}, makeDeps([], ['nushell']));
    expect(ids(steps)).toEqual(['rc_nushell', 'config_nushell']);
    expect(steps[0]!.run).toBeUndefined();
    expect(steps[0]!.detail).toContain(getShell('nushell')!.initPath!);
    expect(steps[1]!.run).toBeDefined();
  });

  it('removes the font before Starship, after the shells', async () => {
    const steps = await planUninstall({ starship: true, fontId: 'FiraCode' }, makeDeps(['zsh']));
    expect(ids(steps)).toEqual(['rc_zsh', 'font', 'starship']);
    expect(steps[1]!.detail).toBe(`delete 2 font files from ${getNerdFontsDir()}`);
    expect(steps[2]!.detail).toBe('run brew uninstall starship');
  });

  it('leaves Starship and fonts alone unless asked', async () => {
    const deps = makeDeps(['zsh']);
    await planUninstall({}, deps);
    expect(deps.plannedStarshipRemoval).not.toHaveBeenCalled();
    expect(deps.installedFontFiles).not.toHaveBeenCalled();
  });

  it('cannot remove a font whose files it cannot tell apart', async () => {
    const deps = makeDeps([], [], { installedFontFiles: vi.fn().mockResolvedValue(null) });
    const [step] = await planUninstall({ fontId: 'FiraCode' }, deps);
    expect(step!.run).toBeUndefined();
    expect(step!.detail).toMatch(/no cached Fira Code archive/);
  });

  it('skips a font that is not installed', async () => {
    const deps = makeDeps([], [], { installedFontFiles: vi.fn().mockResolvedValue([]) });
    const [step] = await planUninstall({ fontId: 'FiraCode' }, deps);
    expect(step).toEqual({ id: 'font', title: 'Fira Code', detail: 'Fira Code is not installed' });
  });

  it.each([
    [{ kind: 'absent' as const }, 'Starship is not installed'],
    [{ kind: 'manual' as const, path: '/opt/starship' }, /\/opt\/starship was not installed/],
  ])('has nothing to run for Starship it cannot remove (%o)', async (plan, detail) => {
    const deps = makeDeps([], [], { plannedStarshipRemoval: vi.fn(() => plan) });
    const [step] = await planUninstall({ starship: true }, deps);
    expect(step!.run).toBeUndefined();
    expect(step!.detail).toMatch(detail);
  });
});

describe('runUninstall', () => {
  it('runs every step and reports what it removed', async () => {
    const deps = makeDeps(['zsh'], ['zsh']);
    const steps = await planUninstall({ starship: true, fontId: 'FiraCode' }, deps);

    const report = await runUninstall(steps);

    expect(report.ok).toBe(true);
    expect(report.actions.map((a) => [a.id, a.status, a.detail])).toEqual([
      [
        'rc_zsh',
        'removed',
        `removed the lines from ${getShell('zsh')!.rcFile}; backup: /h/.zshrc.bak-1`,
      ],
      ['config_zsh', 'removed', `removed ${getShellConfigPath('zsh')}; backup: /h/zsh.toml.bak-1`],
      ['font', 'removed', 'deleted 2 font files'],
      ['starship', 'removed', 'removed the brew package'],
    ]);
    expect(deps.removeFontFiles).toHaveBeenCalledWith(['/f/A.ttf', '/f/B.ttf']);
    expect(deps.forgetStarshipVersion).toHaveBeenCalled();
  });

  it('deletes a script install binary', async () => {
    const plan = { kind: 'script' as const, path: '/h/.local/bin/starship' };
    const deps = makeDeps([], [], { plannedStarshipRemoval: vi.fn(() => plan) });

    const report = await runUninstall(await planUninstall({ starship: true }, deps));

    expect(deps.removeStarship).toHaveBeenCalledWith(plan);
    expect(report.actions[0]!.detail).toBe('deleted /h/.local/bin/starship');
  });

  it('keeps going after a failed step and reports it', async () => {
    const deps = makeDeps(['zsh', 'bash'], [], {
      removeManagedRcBlocks: vi.fn((id: ShellId) => {
        if (id === 'zsh') throw new Error('read-only');
        return { removed: true };
      }),
    });

    const report = await runUninstall(await planUninstall({}, deps));

    expect(report.ok).toBe(false);
    expect(report.actions.map((a) => a.status)).toEqual(['failed', 'removed']);
    expect(report.actions[0]!.detail).toBe('read-only');
  });

  it("leaves a shell's config in place when its rc could not be cleaned", async () => {
    const deps = makeDeps(['zsh', 'bash'], ['zsh', 'bash'], {
      removeManagedRcBlocks: vi.fn((id: ShellId) => {
        if (id === 'zsh') throw new Error('read-only');
        return { removed: true };
      }),
    });

    const report = await runUninstall(await planUninstall({}, deps));

    expect(report.actions.map((a) => [a.id, a.status])).toEqual([
      ['rc_zsh', 'failed'],
      ['config_zsh', 'skipped'],
      ['rc_bash', 'removed'],
      ['config_bash', 'removed'],
    ]);
    expect(report.actions[1]!.detail).toBe('left in place: Zsh rc failed and still points at it');
    expect(deps.removeShellConfigFile).toHaveBeenCalledTimes(1);
  });

  it('keeps Starship recorded when its removal fails', async () => {
    const deps = makeDeps([], [], { removeStarship: vi.fn().mockRejectedValue(new Error('no')) });
    await runUninstall(await planUninstall({ starship: true }, deps));
    expect(deps.forgetStarshipVersion).not.toHaveBeenCalled();
  });

  it('passes on the note of a removal that changed nothing', async () => {
    const deps = makeDeps(['zsh'], [], {
      removeManagedRcBlocks: vi.fn(() => ({ removed: false, note: 'no ShellConfigurator lines' })),
    });
    const report = await runUninstall(await planUninstall({}, deps));
    expect(report.actions[0]!.detail).toBe('no ShellConfigurator lines');
  });

  it('only plans in a dry run', async () => {
    const deps = makeDeps(['zsh'], [], {
      plannedStarshipRemoval: vi.fn(() => ({ kind: 'absent' as const })),
    });

    const report = await runUninstall(await planUninstall({ starship: true }, deps), {
      dryRun: true,
    });

    expect(report.dryRun).toBe(true);
    expect(report.actions.map((a) => a.status)).toEqual(['planned', 'skipped']);
    expect(deps.removeManagedRcBlocks).not.toHaveBeenCalled();
  });
});

describe('formatUninstallReport', () => {
  it('lists each action under a status column', () => {
    const text = formatUninstallReport({
      ok: true,
      dryRun: false,
      actions: [{ id: 'rc_zsh', title: 'Zsh rc', status: 'removed', detail: 'removed the lines' }],
    });
    expect(text).toBe('Starship uninstall\n\nREMOVED Zsh rc — removed the lines\n');
  });

  it('says when there is nothing to do, and marks a dry run', () => {
    expect(formatUninstallReport({ ok: true, dryRun: true, actions: [] })).toBe(
      'Starship uninstall (dry run — nothing was changed)\n\nNothing to uninstall.\n'
    );
  });
});
