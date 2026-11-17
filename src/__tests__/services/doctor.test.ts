import { describe, expect, it, vi } from 'vitest';
import { getShell } from '../../config/shells.ts';
import { getShellConfigPath } from '../../generators/configPaths.ts';
import { starshipConfigLine } from '../../generators/rcPlan.ts';
import type { DoctorDeps } from '../../services/doctor/types.ts';
import { formatDoctorReport, runDoctor } from '../../services/doctor.ts';
import { type RepairDeps, runRepair } from '../../services/repair.ts';
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

describe('runDoctor', () => {
  it('reports all green for a healthy setup', async () => {
    const report = await runDoctor(baseState(), makeDeps(wired(new Map())));
    expect(report.ok).toBe(true);
    expect(report.findings.map((f) => f.status)).toEqual(
      Array(report.findings.length).fill('pass')
    );
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

describe('runDoctor reading files', () => {
  it('reads each rc once, however many checks look at it', async () => {
    const deps = makeDeps(wired(new Map()));
    await runDoctor(null, deps);
    const zshReads = vi.mocked(deps.readFile).mock.calls.filter(([file]) => file === ZSH_RC);
    expect(zshReads).toHaveLength(1);
  });
});
