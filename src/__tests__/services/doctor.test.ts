import { describe, expect, it, vi } from 'vitest';
import { getShell } from '../../config/shells.ts';
import {
  getSharedConfigPath,
  getShellConfigPath,
  starshipConfigLine,
} from '../../generators/shellRc.ts';
import { type DoctorDeps, formatDoctorReport, runDoctor } from '../../services/doctor.ts';
import { DEFAULT_STATE, type WizardState } from '../../types.ts';

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
    detectCurrentShell: vi.fn().mockResolvedValue('zsh'),
    readCachedStarshipVersion: vi.fn().mockReturnValue(null),
    detectInstalledShells: vi.fn().mockResolvedValue(['zsh']),
    detectTerminal: vi.fn().mockResolvedValue('kitty'),
    readFontFamily: vi.fn().mockReturnValue('JetBrainsMono Nerd Font'),
    verifyConfig: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn((p: string) => files.get(p) ?? ''),
    exists: vi.fn((p: string) => files.has(p)),
    hasFontFiles: vi.fn().mockReturnValue(true),
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

describe('runDoctor', () => {
  it('reports all green for a healthy setup', async () => {
    const report = await runDoctor(baseState(), makeDeps(wired(new Map())));
    expect(report.ok).toBe(true);
    expect(report.findings.map((f) => f.status)).toEqual(
      Array(report.findings.length).fill('pass')
    );
  });

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

  it('warns when no locale is set, passes a UTF-8 one', async () => {
    const missing = await runDoctor(baseState(), makeDeps(wired(new Map()), { env: {} }));
    expect(find(missing, 'locale').status).toBe('warn');
    const latin = await runDoctor(
      baseState(),
      makeDeps(wired(new Map()), { env: { LANG: 'en_US.ISO-8859-1' } })
    );
    expect(find(latin, 'locale').status).toBe('warn');
    expect(find(latin, 'locale').detail).toMatch(/not UTF-8/);
  });

  it('warns when a shell rc has no init line', async () => {
    const report = await runDoctor(baseState(), makeDeps(new Map()));
    expect(find(report, 'shell:zsh')).toMatchObject({
      status: 'warn',
      fix: { kind: 'configure-shell', shellId: 'zsh' },
    });
  });

  it('fails when the rc init line points at a missing config', async () => {
    const files = new Map<string, string>();
    files.set(ZSH_RC, `${ZSH_INIT}\n${ZSH_CONFIG_LINE}\n`);
    const report = await runDoctor(baseState(), makeDeps(files));
    expect(find(report, 'shell:zsh')).toMatchObject({ status: 'fail' });
    expect(find(report, 'shell:zsh').detail).toContain(ZSH_CONFIG);
  });

  it('fails when the init line has no STARSHIP_CONFIG export', async () => {
    const files = new Map<string, string>();
    files.set(ZSH_RC, `${ZSH_INIT}\n`);
    files.set(ZSH_CONFIG, 'x\n');
    const report = await runDoctor(baseState(), makeDeps(files));
    expect(find(report, 'shell:zsh')).toMatchObject({ status: 'fail' });
    expect(find(report, 'shell:zsh').detail).toMatch(/STARSHIP_CONFIG/);
  });

  it('passes a shell that points at the shared config in adopt mode', async () => {
    const files = new Map<string, string>();
    files.set(ZSH_RC, `${ZSH_INIT}\n`);
    files.set(getSharedConfigPath(), 'x\n');
    const report = await runDoctor(baseState({ keepExistingConfig: true }), makeDeps(files));
    expect(find(report, 'shell:zsh').status).toBe('pass');
    expect(find(report, 'config').status).toBe('pass');
  });

  it('fails when starship cannot load a config file', async () => {
    const deps = makeDeps(wired(new Map()), {
      verifyConfig: vi.fn().mockRejectedValue(new Error('invalid TOML')),
    });
    const report = await runDoctor(baseState(), deps);
    expect(find(report, 'config')).toMatchObject({ status: 'fail' });
    expect(find(report, 'config').detail).toMatch(/invalid TOML/);
    expect(report.ok).toBe(false);
  });

  it('warns when no config file exists at all', async () => {
    const report = await runDoctor(baseState(), makeDeps(new Map(), { verifyConfig: vi.fn() }));
    expect(find(report, 'config').status).toBe('warn');
  });

  it('warns and offers a reinstall when the selected font is not present', async () => {
    const deps = makeDeps(wired(new Map()), { hasFontFiles: vi.fn().mockReturnValue(false) });
    const report = await runDoctor(baseState(), deps);
    expect(find(report, 'font-installed')).toMatchObject({
      status: 'warn',
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

  it('detects installed shells when no state card is given', async () => {
    const deps = makeDeps(wired(new Map()), {
      detectInstalledShells: vi.fn().mockResolvedValue(['bash']),
    });
    const report = await runDoctor(null, deps);
    expect(report.findings.some((f) => f.id === 'shell:bash')).toBe(true);
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

  it('passes the running-shell check when it is configured and wired', async () => {
    const report = await runDoctor(baseState(), makeDeps(wired(new Map())));
    expect(find(report, 'current-shell')).toMatchObject({ status: 'pass' });
  });

  it('warns when the running shell is not one of the configured shells', async () => {
    const deps = makeDeps(wired(new Map()), {
      detectCurrentShell: vi.fn().mockResolvedValue('bash'),
    });
    const report = await runDoctor(baseState(), deps);
    expect(find(report, 'current-shell')).toMatchObject({
      status: 'warn',
      detail: expect.stringContaining('not configured'),
    });
  });

  it('warns when the running shell rc has no starship init line', async () => {
    const files = wired(new Map());
    files.set(getShell('bash')!.rcFile!, `# already has content\n`);
    const deps = makeDeps(files, {
      detectCurrentShell: vi.fn().mockResolvedValue('bash'),
      detectInstalledShells: vi.fn().mockResolvedValue(['bash']),
    });
    const report = await runDoctor(baseState({ selectedShells: ['bash'] }), deps);
    expect(find(report, 'current-shell')).toMatchObject({
      status: 'warn',
      detail: expect.stringContaining('does not init Starship'),
    });
  });

  it('warns when the running shell cannot be identified', async () => {
    const deps = makeDeps(wired(new Map()), {
      detectCurrentShell: vi.fn().mockResolvedValue(null),
    });
    const report = await runDoctor(baseState(), deps);
    expect(find(report, 'current-shell')).toMatchObject({ status: 'warn' });
  });
});

describe('formatDoctorReport', () => {
  it('renders one line per finding and a tally', () => {
    const text = formatDoctorReport({
      ok: false,
      findings: [
        { id: 'a', title: 'A', status: 'pass', detail: 'fine' },
        { id: 'b', title: 'B', status: 'fail', detail: 'broken' },
      ],
    });
    expect(text).toContain('PASS  A — fine');
    expect(text).toContain('FAIL  B — broken');
    expect(text).toContain('1 passed, 0 warning(s), 1 failed');
  });
});
