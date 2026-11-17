import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getShell } from '../../config/shells.ts';
import { getSharedConfigPath, getShellConfigPath } from '../../generators/configPaths.ts';
import { starshipConfigLine } from '../../generators/rcPlan.ts';
import {
  DEFAULT_DOCTOR_DEPS,
  type DoctorDeps,
  formatDoctorReport,
  runDoctor,
} from '../../services/doctor.ts';
import { type RepairDeps, runRepair } from '../../services/repair.ts';
import { DEFAULT_STATE, type WizardState } from '../../types.ts';
import { stubPlatform } from '../helpers/platform.ts';

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

  it('warns when no locale is set, passes a UTF-8 one', async () => {
    const missing = await runDoctor(baseState(), makeDeps(wired(new Map()), { env: {} }));
    expect(find(missing, 'locale').status).toBe('warn');
    const latin = await runDoctor(
      baseState(),
      makeDeps(wired(new Map()), { env: { LANG: 'en_US.ISO-8859-1' } })
    );
    expect(find(latin, 'locale').status).toBe('warn');
    expect(find(latin, 'locale').detail).toMatch(/not UTF-8/);
    const utf8 = await runDoctor(
      baseState(),
      makeDeps(wired(new Map()), { env: { LANG: 'en_US.utf8' } })
    );
    expect(find(utf8, 'locale')).toMatchObject({ status: 'pass', detail: 'en_US.utf8' });
  });

  it('accepts an init line spelled differently', async () => {
    const files = new Map<string, string>();
    files.set(ZSH_RC, `source <(starship init zsh)\n${ZSH_CONFIG_LINE}\n`);
    files.set(ZSH_CONFIG, 'x\n');
    const report = await runDoctor(baseState(), makeDeps(files));
    expect(find(report, 'shell:zsh')).toMatchObject({ status: 'pass' });
  });

  it('does not accept a commented-out init line', async () => {
    const files = new Map<string, string>();
    files.set(ZSH_RC, `# ${ZSH_INIT}\n${ZSH_CONFIG_LINE}\n`);
    files.set(ZSH_CONFIG, 'x\n');
    const report = await runDoctor(baseState(), makeDeps(files));
    expect(find(report, 'shell:zsh')).toMatchObject({ status: 'fail' });
  });

  it('fails when a shell rc has no init line', async () => {
    const report = await runDoctor(baseState(), makeDeps(new Map()));
    expect(find(report, 'shell:zsh')).toMatchObject({
      status: 'fail',
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

  it('warns when the init line has no STARSHIP_CONFIG export', async () => {
    const files = new Map<string, string>();
    files.set(ZSH_RC, `${ZSH_INIT}\n`);
    files.set(ZSH_CONFIG, 'x\n');
    const report = await runDoctor(baseState(), makeDeps(files));
    expect(find(report, 'shell:zsh')).toMatchObject({ status: 'warn' });
    expect(find(report, 'shell:zsh').detail).toMatch(/STARSHIP_CONFIG/);
  });

  it('does not fail an adopt-mode setup that relies on the shared defaults', async () => {
    const files = new Map<string, string>();
    files.set(ZSH_RC, `${ZSH_INIT}\n`);
    const report = await runDoctor(baseState({ keepExistingConfig: true }), makeDeps(files));
    expect(find(report, 'shell:zsh').status).toBe('pass');
  });

  it('flags a leftover per-shell export in adopt mode and offers to remove it', async () => {
    const files = new Map<string, string>();
    files.set(ZSH_RC, `# Added by ShellConfigurator\n${ZSH_CONFIG_LINE}\n${ZSH_INIT}\n`);
    files.set(getSharedConfigPath(), 'x\n');
    const report = await runDoctor(baseState({ keepExistingConfig: true }), makeDeps(files));
    expect(find(report, 'shell:zsh')).toMatchObject({
      status: 'warn',
      fix: { kind: 'configure-shell', shellId: 'zsh' },
    });
  });

  it('asks the user to remove their own export in adopt mode, which repair cannot', async () => {
    const files = new Map<string, string>();
    files.set(ZSH_RC, `export STARSHIP_CONFIG=~/mine.toml\n${ZSH_INIT}\n`);
    files.set(getSharedConfigPath(), 'x\n');
    const report = await runDoctor(baseState({ keepExistingConfig: true }), makeDeps(files));
    const finding = find(report, 'shell:zsh');
    expect(finding.status).toBe('warn');
    expect(finding.detail).toMatch(/remove that line/);
    expect(finding.fix).toBeUndefined();
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

  it('warns when no config file exists at all, without asking starship to load one', async () => {
    const deps = makeDeps(new Map(), { verifyConfig: vi.fn() });
    const report = await runDoctor(baseState(), deps);
    expect(find(report, 'config').status).toBe('warn');
    expect(deps.verifyConfig).not.toHaveBeenCalled();
  });

  it('reads LC_ALL before LC_CTYPE before LANG', async () => {
    const locale = async (env: Record<string, string>) =>
      find(await runDoctor(baseState(), makeDeps(wired(new Map()), { env })), 'locale');

    expect(
      await locale({ LC_ALL: 'C', LC_CTYPE: 'en_US.UTF-8', LANG: 'en_US.UTF-8' })
    ).toMatchObject({
      status: 'warn',
      detail: 'C is not UTF-8 — Nerd Font glyphs may render as boxes',
    });
    expect(await locale({ LC_CTYPE: 'en_US.UTF-8', LANG: 'C' })).toMatchObject({
      status: 'pass',
      detail: 'en_US.UTF-8',
    });
  });

  it('fails a card shell id it does not know', async () => {
    const report = await runDoctor(
      baseState({ selectedShells: ['bogus' as WizardState['selectedShells'][number]] }),
      makeDeps(wired(new Map()))
    );
    expect(find(report, 'shell:bogus')).toMatchObject({
      status: 'fail',
      detail: "unknown shell 'bogus'",
    });
  });

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

  it('leaves manual setup to the user, without a repair action', async () => {
    const report = await runDoctor(
      baseState({ selectedShells: ['nushell'] }),
      makeDeps(new Map(), { detectCurrentShell: vi.fn().mockResolvedValue(null) })
    );
    expect(find(report, 'shell:nushell')).toMatchObject({ status: 'warn' });
    expect(find(report, 'shell:nushell').fix).toBeUndefined();
  });

  it('does not pass a manual setup whose init was never applied', async () => {
    const shell = getShell('nushell')!;
    const files = new Map<string, string>();
    files.set(shell.initPath!, '');
    const report = await runDoctor(
      baseState({ selectedShells: ['nushell'] }),
      makeDeps(files, { detectCurrentShell: vi.fn().mockResolvedValue(null) })
    );
    expect(find(report, 'shell:nushell')).toMatchObject({ status: 'warn' });
  });

  it('passes a manual setup once every init file exists', async () => {
    const shell = getShell('nushell')!;
    const files = new Map<string, string>();
    files.set(shell.initPath!, '');
    for (const initPath of shell.additionalInitPaths ?? []) files.set(initPath, '');
    const report = await runDoctor(
      baseState({ selectedShells: ['nushell'] }),
      makeDeps(files, { detectCurrentShell: vi.fn().mockResolvedValue('nushell') })
    );
    expect(find(report, 'shell:nushell').status).toBe('pass');
    expect(find(report, 'current-shell').status).toBe('pass');
  });

  it('warns for a running manual shell that is not set up yet', async () => {
    const report = await runDoctor(
      baseState({ selectedShells: ['nushell'] }),
      makeDeps(new Map(), { detectCurrentShell: vi.fn().mockResolvedValue('nushell') })
    );
    expect(find(report, 'current-shell')).toMatchObject({ status: 'warn' });
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

  it('checks only the installed shells that were set up when no state card is given', async () => {
    const deps = makeDeps(wired(new Map()), {
      detectInstalledShells: vi.fn().mockResolvedValue(['zsh', 'bash']),
    });
    const report = await runDoctor(null, deps);
    expect(find(report, 'shell:zsh').status).toBe('pass');
    expect(report.findings.some((f) => f.id === 'shell:bash')).toBe(false);
    expect(report.ok).toBe(true);
  });

  it('checks a shell the last run set up even after its init line is gone', async () => {
    const deps = makeDeps(wired(new Map()), {
      detectInstalledShells: vi.fn().mockResolvedValue(['zsh', 'bash']),
      lastRunShells: vi.fn().mockReturnValue(['bash']),
    });
    const report = await runDoctor(null, deps);
    expect(find(report, 'shell:bash')).toMatchObject({
      status: 'fail',
      fix: { kind: 'configure-shell', shellId: 'bash' },
    });
  });

  it('checks a shell with a ShellConfigurator block but no init line', async () => {
    const bashrc = getShell('bash')!.rcFile!;
    const files = wired(
      new Map([[bashrc, '# Added by ShellConfigurator\nunset STARSHIP_CONFIG\n']])
    );
    const deps = makeDeps(files, {
      detectInstalledShells: vi.fn().mockResolvedValue(['zsh', 'bash']),
    });
    expect(find(await runDoctor(null, deps), 'shell:bash').status).toBe('fail');
  });

  it('warns when no installed shell was set up', async () => {
    const deps = makeDeps(new Map(), {
      detectInstalledShells: vi.fn().mockResolvedValue(['bash']),
    });
    const report = await runDoctor(null, deps);
    expect(find(report, 'shells').status).toBe('warn');
    expect(report.findings.some((f) => f.id.startsWith('shell:'))).toBe(false);
  });

  it('reads the wiring mode from the rc instead of assuming per-shell', async () => {
    const files = new Map<string, string>();
    files.set(ZSH_RC, `${ZSH_INIT}\n`);
    files.set(getSharedConfigPath(), 'add_newline = true\n');
    const report = await runDoctor(null, makeDeps(files));
    expect(find(report, 'shell:zsh')).toMatchObject({ status: 'pass' });
    expect(find(report, 'shell:zsh').detail).toContain(getSharedConfigPath());
    expect(find(report, 'config').status).toBe('pass');
  });

  it('checks the per-shell config when the rc carries the per-shell export', async () => {
    const report = await runDoctor(null, makeDeps(wired(new Map())));
    expect(find(report, 'shell:zsh').status).toBe('pass');
    expect(find(report, 'shell:zsh').detail).toContain(ZSH_CONFIG);
  });

  it('warns instead of failing when inferred shared wiring has no shared config', async () => {
    const files = new Map<string, string>();
    files.set(ZSH_RC, `${ZSH_INIT}\n`);
    const report = await runDoctor(null, makeDeps(files));
    expect(find(report, 'shell:zsh')).toMatchObject({ status: 'warn' });
    expect(find(report, 'shell:zsh').detail).toMatch(/no shared config/);
    expect(find(report, 'shell:zsh').fix).toBeUndefined();
    expect(report.ok).toBe(true);
  });

  it('passes a shell that sets its own STARSHIP_CONFIG, with $HOME expanded', async () => {
    const own = path.join(os.homedir(), '.config', 'my', 'starship.toml');
    const files = new Map<string, string>();
    files.set(ZSH_RC, `${ZSH_INIT}\nexport STARSHIP_CONFIG="$HOME/.config/my/starship.toml"\n`);
    files.set(own, 'x\n');
    const report = await runDoctor(null, makeDeps(files));
    expect(find(report, 'shell:zsh')).toMatchObject({
      status: 'pass',
      detail: `configured via ${own}`,
    });
    expect(report.ok).toBe(true);
  });

  it('warns when an expanded STARSHIP_CONFIG names a file that does not exist', async () => {
    const files = new Map<string, string>();
    files.set(ZSH_RC, `${ZSH_INIT}\nexport STARSHIP_CONFIG="$HOME/.config/my/starship.toml"\n`);
    const report = await runDoctor(null, makeDeps(files));
    expect(find(report, 'shell:zsh')).toMatchObject({ status: 'warn' });
    expect(find(report, 'shell:zsh').detail).toMatch(/does not exist/);
  });

  it('passes a STARSHIP_CONFIG set from a variable it cannot know', async () => {
    const files = new Map<string, string>();
    files.set(ZSH_RC, `${ZSH_INIT}\nexport STARSHIP_CONFIG="$DOTFILES/starship.toml"\n`);
    const report = await runDoctor(null, makeDeps(files));
    expect(find(report, 'shell:zsh')).toMatchObject({ status: 'pass' });
    expect(find(report, 'shell:zsh').detail).toMatch(/sets its own STARSHIP_CONFIG/);
  });

  it('reads a STARSHIP_CONFIG assigned without export as not reaching Starship', async () => {
    const files = new Map<string, string>();
    files.set(ZSH_RC, `${ZSH_INIT}\nSTARSHIP_CONFIG=${ZSH_CONFIG}\n`);
    files.set(ZSH_CONFIG, 'x\n');
    const report = await runDoctor(null, makeDeps(files));
    expect(find(report, 'shell:zsh').detail).not.toContain(`configured via ${ZSH_CONFIG}`);
  });

  it('accepts an export written under a different XDG_CONFIG_HOME', async () => {
    const files = new Map<string, string>();
    files.set(ZSH_RC, `${ZSH_INIT}\nexport STARSHIP_CONFIG="/custom/config/zsh.toml"\n`);
    files.set('/custom/config/zsh.toml', 'x\n');
    const report = await runDoctor(baseState(), makeDeps(files));
    expect(find(report, 'shell:zsh')).toMatchObject({ status: 'pass' });
    expect(find(report, 'config').status).toBe('pass');
  });

  it('does not repair an export pointing at a missing non-default config', async () => {
    const files = new Map<string, string>();
    files.set(ZSH_RC, `${ZSH_INIT}\nexport STARSHIP_CONFIG="/custom/config/zsh.toml"\n`);
    const report = await runDoctor(baseState(), makeDeps(files));
    expect(find(report, 'shell:zsh')).toMatchObject({ status: 'warn' });
    expect(find(report, 'shell:zsh').fix).toBeUndefined();
  });

  it('finds a shared config even when the rc names a per-shell one', async () => {
    const files = new Map<string, string>();
    files.set(ZSH_RC, `${ZSH_INIT}\n${ZSH_CONFIG_LINE}\n`);
    files.set(getSharedConfigPath(), 'x\n');
    const report = await runDoctor(null, makeDeps(files));
    expect(find(report, 'config').status).toBe('pass');
  });

  it('does not fall back to every installed shell for a card with no shells', async () => {
    const report = await runDoctor(
      baseState({ selectedShells: [] }),
      makeDeps(wired(new Map()), { detectInstalledShells: vi.fn().mockResolvedValue(['bash']) })
    );
    expect(report.findings.some((f) => f.id.startsWith('shell:'))).toBe(false);
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
    expect(text).toContain('PASS    A — fine');
    expect(text).toContain('FAIL    B — broken');
    expect(text).toContain('1 passed, 0 warning(s), 1 failed');
  });
});

describe('repair against the real doctor', () => {
  function repairDeps(doctorDeps: DoctorDeps): RepairDeps {
    return {
      runDoctor: (state) => runDoctor(state, doctorDeps),
      shellPointsAtShared: vi.fn().mockReturnValue(false),
      applyShellConfig: vi.fn().mockReturnValue({ applied: true }),
      installStarship: vi.fn().mockResolvedValue(undefined),
      installNerdFont: vi.fn().mockResolvedValue(undefined),
      wireTerminalFont: vi.fn().mockReturnValue({ applied: true }),
      detectPackageManager: vi.fn().mockResolvedValue('apt'),
      generateToml: vi.fn().mockReturnValue(''),
      writeShellConfig: vi.fn().mockReturnValue({ path: ZSH_CONFIG }),
      recordStarshipVersion: vi.fn(),
      getMissingStarshipPathDir: vi.fn().mockReturnValue(null),
      readStarshipVersion: vi.fn().mockResolvedValue(null),
    };
  }

  it('reinstalls a font the card asked for without any opt-in', async () => {
    const deps = repairDeps(
      makeDeps(wired(new Map()), { hasNerdFonts: vi.fn().mockReturnValue(false) })
    );
    await runRepair(baseState(), deps);
    expect(deps.installNerdFont).toHaveBeenCalledWith('JetBrainsMono');
  });

  it('only rewires the terminal font when warnings are included', async () => {
    const doctorDeps = makeDeps(wired(new Map()), {
      readFontFamily: vi.fn().mockReturnValue('Menlo'),
    });
    const plain = repairDeps(doctorDeps);
    await runRepair(baseState(), plain);
    expect(plain.wireTerminalFont).not.toHaveBeenCalled();

    const withWarnings = repairDeps(doctorDeps);
    await runRepair(baseState(), withWarnings, { includeWarnings: true });
    expect(withWarnings.wireTerminalFont).toHaveBeenCalledWith('kitty', 'JetBrainsMono Nerd Font');
  });
});

describe('runDoctor with an init in a sourced file', () => {
  let restorePlatform: () => void;
  beforeEach(() => {
    restorePlatform = stubPlatform('linux');
  });
  afterEach(() => restorePlatform());

  it('passes a shell whose rc starts Starship through a file it sources', async () => {
    const bashrc = getShell('bash')!.rcFile!;
    const files = new Map([
      [bashrc, 'source "$OMARCHY_PATH/default/bash/rc"\n'],
      ['/opt/omarchy/default/bash/rc', 'eval "$(starship init bash)"\n'],
    ]);
    const report = await runDoctor(
      baseState({ selectedShells: ['bash'], keepExistingConfig: true }),
      makeDeps(files, {
        detectCurrentShell: vi.fn().mockResolvedValue('bash'),
        detectInstalledShells: vi.fn().mockResolvedValue(['bash']),
        env: { LANG: 'en_US.UTF-8', OMARCHY_PATH: '/opt/omarchy' },
      })
    );
    expect(find(report, 'shell:bash').status).toBe('pass');
  });
});

describe('runDoctor for Bash on macOS', () => {
  const bashrc = getShell('bash')!.rcFile!;
  const profile = path.join(os.homedir(), '.bash_profile');
  let restorePlatform: () => void;
  beforeEach(() => {
    restorePlatform = stubPlatform('darwin');
  });
  afterEach(() => restorePlatform());

  function check(files: Map<string, string>) {
    return runDoctor(
      baseState({ selectedShells: ['bash'], keepExistingConfig: true }),
      makeDeps(files, { detectInstalledShells: vi.fn().mockResolvedValue(['bash']) })
    );
  }

  it('fails when no login file loads ~/.bashrc, since Terminal starts login shells', async () => {
    const report = await check(new Map([[bashrc, 'eval "$(starship init bash)"\n']]));
    expect(find(report, 'shell:bash')).toMatchObject({
      status: 'fail',
      fix: { kind: 'configure-shell', shellId: 'bash' },
    });
    expect(find(report, 'shell:bash').detail).toContain('does not load');
  });

  it('passes when ~/.bash_profile loads ~/.bashrc', async () => {
    const report = await check(
      new Map([
        [bashrc, 'eval "$(starship init bash)"\n'],
        [profile, 'if [ -f ~/.bashrc ]; then . ~/.bashrc; fi\n'],
      ])
    );
    expect(find(report, 'shell:bash').status).toBe('pass');
  });
});

describe('runDoctor reading the setup the way the shell does', () => {
  it.each([
    'export STARSHIP_CONFIG="/dots/s.toml" # mine',
    "export STARSHIP_CONFIG='/dots/s.toml'; export EDITOR=vim",
    'export STARSHIP_CONFIG=/dots/s.toml # mine',
  ])('reads only the value of %s', async (line) => {
    const files = new Map([
      [ZSH_RC, `${line}\n${ZSH_INIT}\n`],
      ['/dots/s.toml', 'add_newline = true\n'],
    ]);
    const report = await runDoctor(null, makeDeps(files));
    expect(find(report, 'shell:zsh').detail).toContain('/dots/s.toml');
    expect(find(report, 'shell:zsh').detail).not.toContain('mine');
  });

  it('ignores a commented-out STARSHIP_CONFIG line', async () => {
    const files = new Map([
      [ZSH_RC, `# export STARSHIP_CONFIG=/nope/old.toml\n${ZSH_INIT}\n`],
      [getSharedConfigPath(), 'add_newline = true\n'],
    ]);
    const report = await runDoctor(null, makeDeps(files));
    expect(find(report, 'shell:zsh').status).toBe('pass');
    expect(find(report, 'shell:zsh').detail).not.toContain('/nope/old.toml');
  });

  it.each([
    'set -Ux STARSHIP_CONFIG /nope/old.toml',
    'set --global --export STARSHIP_CONFIG "/nope/old.toml"',
  ])('reads a fish export written as %s', async (line) => {
    const fishRc = getShell('fish')!.rcFile!;
    const files = new Map([[fishRc, `${line}\nstarship init fish | source\n`]]);
    const report = await runDoctor(
      null,
      makeDeps(files, {
        detectInstalledShells: vi.fn().mockResolvedValue(['fish']),
        detectCurrentShell: vi.fn().mockResolvedValue('fish'),
      })
    );
    expect(find(report, 'shell:fish').detail).toContain('/nope/old.toml');
  });

  it('agrees with itself about a shell set up by hand in adopt mode', async () => {
    const nushell = getShell('nushell')!;
    const files = new Map([[nushell.initPath!, 'starship init']]);
    const report = await runDoctor(
      baseState({ selectedShells: ['nushell'], keepExistingConfig: true }),
      makeDeps(files, {
        detectInstalledShells: vi.fn().mockResolvedValue(['nushell']),
        detectCurrentShell: vi.fn().mockResolvedValue('nushell'),
      })
    );
    expect(find(report, 'shell:nushell').status).toBe('pass');
    expect(find(report, 'current-shell').status).toBe('pass');
  });

  it('looks for the Nerd Font the card asked for, not any Nerd Font', async () => {
    const hasNerdFonts = vi.fn((fontId?: string | null) => fontId !== 'FiraCode');
    const report = await runDoctor(
      baseState({ nerdFontToInstall: { kind: 'install', id: 'FiraCode' } }),
      makeDeps(wired(new Map()), { hasNerdFonts })
    );
    expect(hasNerdFonts).toHaveBeenCalledWith('FiraCode');
    expect(find(report, 'font-installed')).toMatchObject({
      status: 'fail',
      fix: { kind: 'reinstall-font', fontId: 'FiraCode' },
    });
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

describe('runDoctor reading files', () => {
  it('reads each rc once, however many checks look at it', async () => {
    const deps = makeDeps(wired(new Map()));
    await runDoctor(null, deps);
    const zshReads = vi.mocked(deps.readFile).mock.calls.filter(([file]) => file === ZSH_RC);
    expect(zshReads).toHaveLength(1);
  });
});

describe('DEFAULT_DOCTOR_DEPS', () => {
  it('reads an unreadable Starship version record as none instead of throwing', () => {
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'shellconf-cache-'));
    vi.stubEnv('XDG_CACHE_HOME', cache);
    try {
      fs.mkdirSync(path.join(cache, 'shell-configurator', 'starship.version'), { recursive: true });
      expect(DEFAULT_DOCTOR_DEPS.readCachedStarshipVersion()).toBeNull();
    } finally {
      vi.unstubAllEnvs();
      fs.rmSync(cache, { recursive: true, force: true });
    }
  });
});

describe('DEFAULT_DOCTOR_DEPS.hasNerdFonts', () => {
  let data: string;
  let restorePlatform: () => void;
  beforeEach(() => {
    data = fs.mkdtempSync(path.join(os.tmpdir(), 'shellconf-fonts-'));
    vi.stubEnv('XDG_DATA_HOME', data);
    restorePlatform = stubPlatform('linux');
    fs.mkdirSync(path.join(data, 'fonts', 'nerd'), { recursive: true });
  });
  afterEach(() => {
    restorePlatform();
    vi.unstubAllEnvs();
    fs.rmSync(data, { recursive: true, force: true });
  });
  const add = (name: string) => fs.writeFileSync(path.join(data, 'fonts', 'nerd', name), '');

  it('counts only font files, not a leftover archive or license', () => {
    add('FiraCodeNerdFont.zip');
    add('FiraCodeNerdFont-LICENSE.txt');
    expect(DEFAULT_DOCTOR_DEPS.hasNerdFonts('FiraCode')).toBe(false);
    expect(DEFAULT_DOCTOR_DEPS.hasNerdFonts()).toBe(false);

    add('FiraCodeNerdFont-Regular.ttf');
    expect(DEFAULT_DOCTOR_DEPS.hasNerdFonts('FiraCode')).toBe(true);
    expect(DEFAULT_DOCTOR_DEPS.hasNerdFonts()).toBe(true);
  });

  it('finds a Nerd Fonts 2 install by its older file names', () => {
    add('JetBrains Mono Regular Nerd Font Complete.ttf');
    expect(DEFAULT_DOCTOR_DEPS.hasNerdFonts('JetBrainsMono')).toBe(true);
    expect(DEFAULT_DOCTOR_DEPS.hasNerdFonts('FiraCode')).toBe(false);
  });

  it('looks for the requested font, not any Nerd Font', () => {
    add('JetBrainsMonoNerdFont-Regular.ttf');
    expect(DEFAULT_DOCTOR_DEPS.hasNerdFonts('FiraCode')).toBe(false);
    expect(DEFAULT_DOCTOR_DEPS.hasNerdFonts('JetBrainsMono')).toBe(true);
  });
});
