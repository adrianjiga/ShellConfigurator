import { describe, expect, it, vi } from 'vitest';
import type { DoctorFix, DoctorReport } from '../../services/doctor.ts';
import { formatRepairReport, type RepairDeps, runRepair } from '../../services/repair.ts';
import type { TerminalFontResult } from '../../services/terminalFont.ts';
import { DEFAULT_STATE, type WizardState } from '../../types.ts';

function report(findings: DoctorReport['findings']): DoctorReport {
  return { ok: findings.every((f) => f.status !== 'fail'), findings };
}

function finding(fix: DoctorFix): DoctorReport['findings'][number] {
  return { id: fix.kind, title: fix.kind, status: 'fail', detail: 'broken', fix };
}

function makeDeps(
  before: DoctorReport,
  after: DoctorReport = report([]),
  overrides: Partial<RepairDeps> = {}
): RepairDeps {
  return {
    runDoctor: vi.fn().mockResolvedValueOnce(before).mockResolvedValue(after),
    shellPointsAtShared: vi.fn().mockReturnValue(false),
    applyShellConfig: vi.fn().mockReturnValue({ applied: true }),
    installStarship: vi.fn().mockResolvedValue(undefined),
    installNerdFont: vi.fn().mockResolvedValue(undefined),
    wireTerminalFont: vi.fn().mockReturnValue({ applied: true } as TerminalFontResult),
    detectPackageManager: vi.fn().mockResolvedValue('apt'),
    generateToml: vi.fn().mockReturnValue('add_newline = true\n'),
    writeShellConfig: vi.fn().mockReturnValue({ path: '/home/u/.config/starship/zsh.toml' }),
    recordStarshipVersion: vi.fn(),
    getMissingStarshipPathDir: vi.fn().mockReturnValue(null),
    readStarshipVersion: vi.fn().mockResolvedValue('starship 1.20.0'),
    ...overrides,
  };
}

const state = (overrides: Partial<WizardState> = {}): WizardState => ({
  ...DEFAULT_STATE,
  ...overrides,
});

describe('runRepair', () => {
  it('does nothing when there are no actionable findings', async () => {
    const deps = makeDeps(report([{ id: 'a', title: 'A', status: 'pass', detail: 'fine' }]));
    const result = await runRepair(null, deps);
    expect(result.actions).toEqual([]);
    expect(result.ok).toBe(true);
    expect(deps.applyShellConfig).not.toHaveBeenCalled();
  });

  it('leaves warnings alone even when they carry a fix', async () => {
    const deps = makeDeps(
      report([
        {
          id: 'a',
          title: 'A',
          status: 'warn',
          detail: 'maybe',
          fix: { kind: 'reinstall-starship' },
        },
      ])
    );
    const result = await runRepair(null, deps);
    expect(result.actions).toEqual([]);
    expect(deps.applyShellConfig).not.toHaveBeenCalled();
    expect(deps.installStarship).not.toHaveBeenCalled();
  });

  it('plans fixes without applying them in dry-run', async () => {
    const before = report([finding({ kind: 'configure-shell', shellId: 'zsh' })]);
    const deps = makeDeps(before);
    const result = await runRepair(null, deps, { dryRun: true });
    expect(result.actions[0]).toMatchObject({ status: 'planned', detail: expect.any(String) });
    expect(deps.applyShellConfig).not.toHaveBeenCalled();
    expect(result.after).toBe(before);
    expect(result.dryRun).toBe(true);
    expect(deps.runDoctor).toHaveBeenCalledOnce();
  });

  it('re-adds the init line for a shell', async () => {
    const deps = makeDeps(report([finding({ kind: 'configure-shell', shellId: 'zsh' })]));
    const result = await runRepair(null, deps);
    expect(deps.applyShellConfig).toHaveBeenCalledWith('zsh', { pointAtSharedConfig: false });
    expect(result.actions[0]).toMatchObject({ status: 'fixed' });
  });

  it('passes adopt mode through to the rc writer', async () => {
    const deps = makeDeps(report([finding({ kind: 'configure-shell', shellId: 'fish' })]));
    await runRepair(state({ keepExistingConfig: true }), deps);
    expect(deps.applyShellConfig).toHaveBeenCalledWith('fish', { pointAtSharedConfig: true });
  });

  it('reads the wiring mode from the rc when there is no state card', async () => {
    const deps = makeDeps(
      report([finding({ kind: 'configure-shell', shellId: 'zsh' })]),
      undefined,
      {
        shellPointsAtShared: vi.fn().mockReturnValue(true),
      }
    );
    await runRepair(null, deps);
    expect(deps.applyShellConfig).toHaveBeenCalledWith('zsh', { pointAtSharedConfig: true });
  });

  it('marks an already-configured shell as skipped', async () => {
    const deps = makeDeps(
      report([finding({ kind: 'configure-shell', shellId: 'zsh' })]),
      undefined,
      {
        applyShellConfig: vi.fn().mockReturnValue({ applied: false, note: 'already configured' }),
      }
    );
    const result = await runRepair(null, deps);
    expect(result.actions[0]).toMatchObject({ status: 'skipped', detail: 'already configured' });
  });

  it('reinstalls starship via the detected package manager', async () => {
    const deps = makeDeps(report([finding({ kind: 'reinstall-starship' })]), undefined, {
      detectPackageManager: vi.fn().mockResolvedValue('brew'),
    });
    const result = await runRepair(null, deps);
    expect(deps.installStarship).toHaveBeenCalledWith('brew');
    expect(result.actions[0]).toMatchObject({ status: 'fixed' });
  });

  it('records the fresh version and looks in the script install dir', async () => {
    const deps = makeDeps(report([finding({ kind: 'reinstall-starship' })]), undefined, {
      getMissingStarshipPathDir: vi.fn().mockReturnValue('/home/u/.local/bin'),
    });
    await runRepair(null, deps);
    expect(deps.readStarshipVersion).toHaveBeenCalledWith('/home/u/.local/bin');
    expect(deps.recordStarshipVersion).toHaveBeenCalledWith('starship 1.20.0');
  });

  it('regenerates a missing config from the state card', async () => {
    const deps = makeDeps(report([finding({ kind: 'write-config', shellId: 'zsh' })]));
    const result = await runRepair(state({ selectedShells: ['zsh'] }), deps);
    expect(deps.generateToml).toHaveBeenCalledWith(state({ selectedShells: ['zsh'] }));
    expect(deps.writeShellConfig).toHaveBeenCalledWith('add_newline = true\n', 'zsh');
    expect(result.actions[0]).toMatchObject({ status: 'fixed' });
  });

  it('skips a regenerate fix without a state card', async () => {
    const deps = makeDeps(report([finding({ kind: 'write-config', shellId: 'zsh' })]));
    const result = await runRepair(null, deps);
    expect(deps.writeShellConfig).not.toHaveBeenCalled();
    expect(result.actions[0]).toMatchObject({ status: 'skipped' });
  });

  it('reinstalls a missing font', async () => {
    const deps = makeDeps(report([finding({ kind: 'reinstall-font', fontId: 'JetBrainsMono' })]));
    const result = await runRepair(null, deps);
    expect(deps.installNerdFont).toHaveBeenCalledWith('JetBrainsMono');
    expect(result.actions[0]).toMatchObject({ status: 'fixed' });
  });

  it('wires the terminal font and reports when it cannot be edited', async () => {
    const wired = makeDeps(
      report([finding({ kind: 'wire-font', terminalId: 'wezterm', family: 'Hack Nerd Font' })])
    );
    expect((await runRepair(null, wired)).actions[0]).toMatchObject({ status: 'fixed' });

    const manual = makeDeps(
      report([finding({ kind: 'wire-font', terminalId: 'wezterm', family: 'Hack Nerd Font' })]),
      undefined,
      {
        wireTerminalFont: vi
          .fn()
          .mockReturnValue({ applied: false, note: 'add it to your Lua config' }),
      }
    );
    const result = await runRepair(null, manual);
    expect(result.actions[0]).toMatchObject({
      status: 'skipped',
      detail: 'add it to your Lua config',
    });
  });

  it('keeps going when one fix throws', async () => {
    const deps = makeDeps(
      report([
        { id: 'a', title: 'A', status: 'fail', detail: 'x', fix: { kind: 'reinstall-starship' } },
        {
          id: 'b',
          title: 'B',
          status: 'fail',
          detail: 'y',
          fix: { kind: 'reinstall-font', fontId: 'Hack' },
        },
      ]),
      undefined,
      { installStarship: vi.fn().mockRejectedValue(new Error('sudo denied')) }
    );
    const result = await runRepair(null, deps);
    expect(result.actions.map((a) => a.status)).toEqual(['failed', 'fixed']);
    expect(result.actions[0].detail).toMatch(/sudo denied/);
    expect(deps.installNerdFont).toHaveBeenCalledOnce();
    expect(result.ok).toBe(false);
  });

  it('does not wire a shell when the starship install failed', async () => {
    const deps = makeDeps(
      report([
        {
          id: 'starship',
          title: 'Starship',
          status: 'fail',
          detail: 'x',
          fix: { kind: 'reinstall-starship' },
        },
        finding({ kind: 'configure-shell', shellId: 'zsh' }),
      ]),
      undefined,
      { installStarship: vi.fn().mockRejectedValue(new Error('sudo denied')) }
    );
    const result = await runRepair(null, deps);
    expect(deps.applyShellConfig).not.toHaveBeenCalled();
    expect(result.actions[1]).toMatchObject({ status: 'skipped' });
    expect(result.actions[1].detail).toMatch(/would break new shells/);
  });

  it('does not point the terminal at a font that failed to install', async () => {
    const deps = makeDeps(
      report([
        finding({ kind: 'reinstall-font', fontId: 'Hack' }),
        finding({ kind: 'wire-font', terminalId: 'kitty', family: 'Hack Nerd Font' }),
      ]),
      undefined,
      { installNerdFont: vi.fn().mockRejectedValue(new Error('no space')) }
    );
    const result = await runRepair(null, deps);
    expect(deps.wireTerminalFont).not.toHaveBeenCalled();
    expect(result.actions[1]).toMatchObject({ status: 'skipped' });
    expect(result.actions[1].detail).toMatch(/left unchanged/);
  });

  it('reports failure when the checks still fail afterwards', async () => {
    const stillBroken = report([
      { id: 'starship', title: 'Starship', status: 'fail', detail: 'x' },
    ]);
    const deps = makeDeps(report([finding({ kind: 'reinstall-starship' })]), stillBroken);
    expect((await runRepair(null, deps)).ok).toBe(false);
  });
});

describe('formatRepairReport', () => {
  it('lists the actions then the post-repair report', () => {
    const text = formatRepairReport({
      before: report([]),
      after: report([{ id: 'a', title: 'Starship', status: 'pass', detail: 'starship 1.20' }]),
      actions: [{ findingId: 'x', title: 'Zsh', status: 'fixed', detail: 'rewired' }],
      ok: true,
      dryRun: false,
    });
    expect(text).toContain('FIXED   Zsh — rewired');
    expect(text).toContain('After repair:');
    expect(text).toContain('PASS  Starship — starship 1.20');
  });

  it('says there is nothing to repair when no action ran', () => {
    const text = formatRepairReport({
      before: report([]),
      after: report([]),
      actions: [],
      ok: true,
      dryRun: false,
    });
    expect(text).toContain('Nothing to repair.');
  });

  it('labels a dry run and skips the post-repair report', () => {
    const text = formatRepairReport({
      before: report([]),
      after: report([]),
      actions: [{ findingId: 'x', title: 'Zsh', status: 'planned', detail: 'rewire zsh' }],
      ok: false,
      dryRun: true,
    });
    expect(text).toContain('dry run — nothing was applied');
    expect(text).toContain('PLANNED Zsh — rewire zsh');
    expect(text).not.toContain('After repair:');
  });
});
