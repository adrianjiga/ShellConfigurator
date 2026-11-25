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

describe('runDoctor: fonts and terminal', () => {
  it('only warns about a missing Nerd Font when no card asked for one', async () => {
    const report = await runDoctor(
      null,
      makeDeps(wired(new Map()), { hasNerdFonts: vi.fn(() => false) })
    );
    const finding = find(report, 'font-installed');
    expect(finding).toMatchObject({ status: 'warn', detail: 'no Nerd Font found' });
    expect(finding.fix).toBeUndefined();
  });

  it('warns without a card when the terminal font is not a Nerd Font', async () => {
    const report = await runDoctor(
      null,
      makeDeps(wired(new Map()), { readFontFamily: vi.fn(() => 'Menlo') })
    );
    const finding = find(report, 'font-selected');
    expect(finding).toMatchObject({
      status: 'warn',
      detail: 'kitty uses "Menlo", which is not a Nerd Font',
    });
    expect(finding.fix).toBeUndefined();
  });

  it('passes the font checks when the setup chose no Nerd Font', async () => {
    const report = await runDoctor(
      baseState({ nerdFontToInstall: { kind: 'none' }, hasNerdFont: false }),
      makeDeps(wired(new Map()), { hasNerdFonts: vi.fn().mockReturnValue(false) })
    );
    expect(find(report, 'font-installed').status).toBe('pass');
    expect(find(report, 'font-selected').status).toBe('pass');
  });

  it('skips font checks in a container', async () => {
    const deps = makeDeps(wired(new Map()), {
      hasNerdFonts: vi.fn().mockReturnValue(false),
      isContainer: vi.fn().mockResolvedValue(true),
    });
    const report = await runDoctor(baseState(), deps);
    expect(find(report, 'font-installed')).toMatchObject({ status: 'pass' });
    expect(find(report, 'font-selected')).toMatchObject({ status: 'pass' });
    expect(find(report, 'font-installed').fix).toBeUndefined();
  });

  it('passes a terminal that draws Nerd Font symbols itself', async () => {
    const deps = makeDeps(wired(new Map()), {
      detectTerminal: vi.fn().mockResolvedValue('ghostty'),
      readFontFamily: vi.fn().mockReturnValue(null),
      hasBundledNerdFonts: vi.fn().mockResolvedValue(true),
    });
    const report = await runDoctor(baseState(), deps);
    expect(find(report, 'font-selected')).toMatchObject({ status: 'pass' });
    expect(find(report, 'font-selected').fix).toBeUndefined();
  });

  it('still warns for a terminal without the bundled symbols', async () => {
    const deps = makeDeps(wired(new Map()), {
      detectTerminal: vi.fn().mockResolvedValue('kitty'),
      readFontFamily: vi.fn().mockReturnValue(null),
      hasBundledNerdFonts: vi.fn().mockResolvedValue(false),
    });
    const report = await runDoctor(baseState(), deps);
    expect(find(report, 'font-selected')).toMatchObject({ status: 'warn' });
  });

  it('accepts a width variant of the selected family', async () => {
    const deps = makeDeps(wired(new Map()), {
      readFontFamily: vi.fn().mockReturnValue('JetBrainsMono Nerd Font Mono'),
    });
    const report = await runDoctor(baseState(), deps);
    expect(find(report, 'font-selected')).toMatchObject({ status: 'pass' });
  });

  it('fails and offers a reinstall when the font the card asked for is not present', async () => {
    const deps = makeDeps(wired(new Map()), { hasNerdFonts: vi.fn().mockReturnValue(false) });
    const report = await runDoctor(baseState(), deps);
    expect(report.ok).toBe(false);
    expect(find(report, 'font-installed')).toMatchObject({
      status: 'fail',
      fix: { kind: 'reinstall-font', fontId: 'JetBrainsMono' },
    });
  });

  it('warns when the terminal font differs from the selected one', async () => {
    const deps = makeDeps(wired(new Map()), {
      readFontFamily: vi.fn().mockReturnValue('Hack Nerd Font'),
    });
    const report = await runDoctor(baseState(), deps);
    expect(find(report, 'font-selected')).toMatchObject({
      status: 'warn',
      fix: { kind: 'wire-font', terminalId: 'kitty', family: 'JetBrainsMono Nerd Font' },
    });
  });

  it('warns when the terminal has no font set', async () => {
    const deps = makeDeps(wired(new Map()), { readFontFamily: vi.fn().mockReturnValue(null) });
    const report = await runDoctor(baseState(), deps);
    expect(find(report, 'font-selected')).toMatchObject({
      status: 'warn',
      fix: { kind: 'wire-font', terminalId: 'kitty', family: 'JetBrainsMono Nerd Font' },
    });
  });

  it('treats WezTerm as manual (its config is Lua)', async () => {
    const readFontFamily = vi.fn();
    const deps = makeDeps(wired(new Map()), {
      detectTerminal: vi.fn().mockResolvedValue('wezterm'),
      readFontFamily,
    });
    const report = await runDoctor(baseState(), deps);
    expect(find(report, 'font-selected').status).toBe('warn');
    expect(find(report, 'font-selected').detail).toMatch(/Lua/);
    expect(readFontFamily).not.toHaveBeenCalled();
  });

  it('warns when no supported terminal is detected', async () => {
    const deps = makeDeps(wired(new Map()), { detectTerminal: vi.fn().mockResolvedValue(null) });
    const report = await runDoctor(baseState(), deps);
    expect(find(report, 'font-selected')).toMatchObject({ status: 'warn' });
    expect(find(report, 'font-selected').detail).toMatch(/no supported terminal/);
  });
});
