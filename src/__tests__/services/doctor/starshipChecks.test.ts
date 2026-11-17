import { describe, expect, it, vi } from 'vitest';
import { getShell } from '../../../config/shells.ts';
import { getShellConfigPath } from '../../../generators/configPaths.ts';
import { starshipConfigLine } from '../../../generators/rcPlan.ts';
import type { DoctorDeps } from '../../../services/doctor/types.ts';
import { runDoctor } from '../../../services/doctor.ts';
import { DEFAULT_STATE, type WizardState } from '../../../types.ts';

const ZSH_RC = getShell('zsh')!.rcFile!;
const ZSH_CONFIG = getShellConfigPath('zsh');
const ZSH_INIT = getShell('zsh')!.initLine;
const ZSH_CONFIG_LINE = starshipConfigLine('zsh')!;

function wired(files: Map<string, string>): Map<string, string> {
  files.set(ZSH_RC, `${ZSH_INIT}\n${ZSH_CONFIG_LINE}\n`);
  files.set(ZSH_CONFIG, 'add_newline = true\n');
  return files;
}

function makeDeps(
  files = new Map<string, string>(),
  overrides: Partial<DoctorDeps> = {}
): DoctorDeps {
  return {
    isStarshipInstalled: vi.fn().mockResolvedValue({ installed: true, version: 'starship 1.20.0' }),
    getMissingStarshipPathDir: vi.fn().mockReturnValue(null),
    readStarshipVersion: vi.fn().mockResolvedValue(null),
    detectCurrentShell: vi.fn().mockResolvedValue('zsh'),
    readCachedStarshipVersion: vi.fn().mockReturnValue(null),
    detectInstalledShells: vi.fn().mockResolvedValue(['zsh']),
    lastRunShells: vi.fn().mockReturnValue(null),
    detectTerminal: vi.fn().mockResolvedValue('kitty'),
    readFontFamily: vi.fn().mockReturnValue('JetBrainsMono Nerd Font'),
    hasBundledNerdFonts: vi.fn().mockResolvedValue(false),
    verifyConfig: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn((p: string) => files.get(p) ?? ''),
    exists: vi.fn((p: string) => files.has(p)),
    hasNerdFonts: vi.fn().mockReturnValue(true),
    isContainer: vi.fn().mockResolvedValue(false),
    env: { LANG: 'en_US.UTF-8' },
    ...overrides,
  };
}

function baseState(overrides: Partial<WizardState> = {}): WizardState {
  return {
    ...DEFAULT_STATE,
    selectedShells: ['zsh'],
    nerdFontToInstall: { kind: 'install', id: 'JetBrainsMono' },
    hasNerdFont: true,
    ...overrides,
  };
}

function find(report: Awaited<ReturnType<typeof runDoctor>>, id: string) {
  const finding = report.findings.find((f) => f.id === id);
  if (!finding) throw new Error(`no finding '${id}' in ${report.findings.map((f) => f.id).join()}`);
  return finding;
}

describe('runDoctor: Starship', () => {
  it('fails and suggests a reinstall when starship is missing', async () => {
    const deps = makeDeps(wired(new Map()), {
      isStarshipInstalled: vi.fn().mockResolvedValue({ installed: false }),
    });
    const report = await runDoctor(baseState(), deps);
    expect(report.ok).toBe(false);
    expect(find(report, 'starship')).toMatchObject({
      status: 'fail',
      fix: { kind: 'reinstall-starship' },
    });
  });

  it('passes when a script install is present but not on PATH', async () => {
    const deps = makeDeps(wired(new Map()), {
      isStarshipInstalled: vi.fn().mockResolvedValue({ installed: false }),
      getMissingStarshipPathDir: vi.fn().mockReturnValue('/home/u/.local/bin'),
      readStarshipVersion: vi.fn().mockResolvedValue('starship 1.20.0'),
    });
    const report = await runDoctor(baseState(), deps);
    expect(find(report, 'starship')).toMatchObject({ status: 'pass' });
    expect(find(report, 'starship').detail).toContain('/home/u/.local/bin');
  });

  it('does not offer a reinstall when the card skipped installing starship', async () => {
    const deps = makeDeps(wired(new Map()), {
      isStarshipInstalled: vi.fn().mockResolvedValue({ installed: false }),
    });
    const report = await runDoctor(baseState({ skipStarshipInstall: true }), deps);
    expect(find(report, 'starship').fix).toBeUndefined();
  });

  it('asks starship for its version once per run', async () => {
    const deps = makeDeps(wired(new Map()), {
      readCachedStarshipVersion: vi.fn().mockReturnValue('starship 1.20.0'),
    });
    await runDoctor(baseState(), deps);
    expect(deps.isStarshipInstalled).toHaveBeenCalledOnce();
  });

  it('does not blame the config when starship cannot be reached', async () => {
    const deps = makeDeps(wired(new Map()), {
      isStarshipInstalled: vi.fn().mockResolvedValue({ installed: false }),
      verifyConfig: vi.fn().mockRejectedValue(new Error('spawn starship ENOENT')),
    });
    const report = await runDoctor(baseState(), deps);
    expect(find(report, 'config')).toMatchObject({ status: 'warn' });
    expect(find(report, 'config').detail).toMatch(/not reachable/);
    expect(deps.verifyConfig).not.toHaveBeenCalled();
  });

  it('still verifies with the script install dir when PATH lacks it', async () => {
    const deps = makeDeps(wired(new Map()), {
      isStarshipInstalled: vi.fn().mockResolvedValue({ installed: false }),
      getMissingStarshipPathDir: vi.fn().mockReturnValue('/home/u/.local/bin'),
      readStarshipVersion: vi.fn().mockResolvedValue('starship 1.20.0'),
    });
    const report = await runDoctor(baseState(), deps);
    expect(find(report, 'config')).toMatchObject({ status: 'pass' });
  });

  it('passes version drift when nothing was recorded yet', async () => {
    const deps = makeDeps(wired(new Map()));
    const report = await runDoctor(baseState(), deps);
    expect(find(report, 'version-drift').status).toBe('pass');
    expect(find(report, 'version-drift').detail).toMatch(/no prior install recorded/);
  });

  it('passes version drift when the installed version still matches the record', async () => {
    const deps = makeDeps(wired(new Map()), {
      readCachedStarshipVersion: vi.fn().mockReturnValue('starship 1.20.0'),
    });
    const report = await runDoctor(baseState(), deps);
    expect(find(report, 'version-drift').status).toBe('pass');
    expect(find(report, 'version-drift').detail).toContain('starship 1.20.0');
  });

  it('warns on version drift when starship changed out from under the record', async () => {
    const deps = makeDeps(wired(new Map()), {
      readCachedStarshipVersion: vi.fn().mockReturnValue('starship 1.19.0'),
    });
    const report = await runDoctor(baseState(), deps);
    expect(find(report, 'version-drift')).toMatchObject({
      status: 'warn',
      detail: expect.stringContaining('1.20.0'),
    });
    expect(find(report, 'version-drift').detail).toContain('starship 1.19.0');
  });

  it('warns on version drift when the record exists but starship is gone', async () => {
    const deps = makeDeps(wired(new Map()), {
      readCachedStarshipVersion: vi.fn().mockReturnValue('starship 1.20.0'),
      isStarshipInstalled: vi.fn().mockResolvedValue({ installed: false }),
    });
    const report = await runDoctor(baseState(), deps);
    expect(find(report, 'version-drift')).toMatchObject({ status: 'warn' });
  });
});

describe('runDoctor and the Starship version', () => {
  it('warns about a Starship too old for the generated config', async () => {
    const deps = makeDeps(wired(new Map()), {
      isStarshipInstalled: vi
        .fn()
        .mockResolvedValue({ installed: true, version: 'starship 1.19.3' }),
    });
    expect(find(await runDoctor(baseState(), deps), 'starship')).toMatchObject({
      status: 'warn',
      detail: expect.stringContaining('older than 1.20.0'),
    });
  });
});
