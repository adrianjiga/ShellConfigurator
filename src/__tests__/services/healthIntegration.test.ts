import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getShell } from '../../config/shells.ts';
import { getShellConfigPath, starshipConfigLine } from '../../generators/shellRc.ts';
import { DEFAULT_DOCTOR_DEPS, runDoctor } from '../../services/doctor.ts';
import { getNerdFontsDir } from '../../services/installer.ts';
import { cacheDir } from '../../services/paths.ts';
import { DEFAULT_REPAIR_DEPS, runRepair } from '../../services/repair.ts';

const { mockExecFile, mockReadFile, mockReadFileSync, mockExistsSync, mockReaddirSync } =
  vi.hoisted(() => {
    const mockExecFile = vi.fn();
    const mockReadFile = vi.fn();
    const mockReadFileSync = vi.fn();
    const mockExistsSync = vi.fn();
    const mockReaddirSync = vi.fn();

    // promisify(execFile) uses a custom symbol to return {stdout, stderr}
    const customPromisify = Symbol.for('nodejs.util.promisify.custom');
    (mockExecFile as unknown as Record<symbol, unknown>)[customPromisify] = (...args: unknown[]) =>
      new Promise((resolve, reject) => {
        mockExecFile(...args, (err: Error | null, stdout: string, stderr: string) => {
          if (err) reject(err);
          else resolve({ stdout, stderr });
        });
      });
    (mockReadFile as unknown as Record<symbol, unknown>)[customPromisify] = (...args: unknown[]) =>
      new Promise((resolve, reject) => {
        mockReadFile(...args, (err: Error | null, data: string) => {
          if (err) reject(err);
          else resolve(data);
        });
      });

    return { mockExecFile, mockReadFile, mockReadFileSync, mockExistsSync, mockReaddirSync };
  });

vi.mock('node:child_process', () => ({ execFile: mockExecFile }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readFile: mockReadFile,
    readFileSync: mockReadFileSync,
    existsSync: mockExistsSync,
    readdirSync: mockReaddirSync,
  };
});

const ZSH_RC = getShell('zsh')!.rcFile!;
const ZSH_INIT = getShell('zsh')!.initLine;
const ZSH_CONFIG = getShellConfigPath('zsh');
const ZSH_CONFIG_LINE = starshipConfigLine('zsh')!;

// The finding ids every doctor run must produce — the "check list end-to-end".
const CHECK_IDS = [
  'starship',
  'locale',
  'shell:zsh',
  'config',
  'font-installed',
  'font-selected',
  'version-drift',
  'current-shell',
];

let tmp: string;
let versionFile: string;

function execFileFailsOrSucceeds(
  cmd: string,
  args: string[],
  _options: unknown,
  cb: (...rest: unknown[]) => void
) {
  if (cmd === 'sh') {
    // `command -v "$1"` probe, from probeArgs: ['-c', script, 'sh', <name>]
    const name = args[3];
    if (name === 'zsh') cb(null, '/usr/bin/zsh\n', '');
    else cb(new Error('command not found'), '', '');
    return;
  }
  if (cmd === 'starship') {
    const sub = args[0];
    cb(null, sub === '--version' ? 'starship 1.21.0\n' : '{\n}\n', '');
    return;
  }
  cb(new Error(`unexpected command: ${cmd}`), '', '');
}

beforeEach(() => {
  vi.clearAllMocks();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-health-'));

  vi.stubEnv('XDG_CACHE_HOME', tmp);
  vi.stubEnv('SHELL', '/usr/bin/zsh');
  vi.stubEnv('LANG', 'en_US.UTF-8');
  for (const name of ['LC_ALL', 'LC_CTYPE', 'TERM', 'TERM_PROGRAM']) vi.stubEnv(name, '');

  versionFile = path.join(cacheDir(), 'starship.version');

  mockExecFile.mockImplementation(execFileFailsOrSucceeds);
  mockReadFile.mockImplementation(() => {
    throw new Error('unexpected async fs read');
  });
  mockExistsSync.mockImplementation((p: string) => p === ZSH_RC || p === ZSH_CONFIG);
  mockReadFileSync.mockImplementation((p: string) => {
    if (p === ZSH_RC) return `${ZSH_INIT}\n${ZSH_CONFIG_LINE}\n`;
    if (p === ZSH_CONFIG) return 'add_newline = true\n';
    if (p === versionFile) return 'starship 1.21.0\n';
    throw new Error(`unexpected readFileSync: ${p}`);
  });
  mockReaddirSync.mockImplementation((p: string) => {
    if (p === getNerdFontsDir()) return ['JetBrainsMono Nerd Font.ttf'];
    throw new Error(`unexpected readdirSync: ${p}`);
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('doctor health check via the real deps', () => {
  it('produces the full check list end-to-end through DEFAULT_DOCTOR_DEPS', async () => {
    const report = await runDoctor(null, DEFAULT_DOCTOR_DEPS);

    expect(report.findings.map((f) => f.id)).toEqual(CHECK_IDS);
    expect(report.ok).toBe(true);
    expect(report.findings.every((f) => f.status !== 'fail')).toBe(true);
  });

  it('flags a mismatch between the recorded and installed starship version', async () => {
    mockReadFileSync.mockImplementation((p: string) => {
      if (p === versionFile) return 'starship 1.19.0\n';
      return p === ZSH_RC ? `${ZSH_INIT}\n${ZSH_CONFIG_LINE}\n` : 'x\n';
    });

    const report = await runDoctor(null, DEFAULT_DOCTOR_DEPS);
    const drift = report.findings.find((f) => f.id === 'version-drift');

    expect(drift?.status).toBe('warn');
    expect(drift?.detail).toContain('starship 1.21.0');
    expect(drift?.detail).toContain('starship 1.19.0');
  });
});

describe('repair via the real deps', () => {
  it('runs the real doctor twice and touches nothing on a healthy machine', async () => {
    const report = await runRepair(null, DEFAULT_REPAIR_DEPS);

    expect(report.before.findings.map((f) => f.id)).toEqual(CHECK_IDS);
    expect(report.after.findings.map((f) => f.id)).toEqual(CHECK_IDS);
    expect(report.actions).toEqual([]);
    expect(report.ok).toBe(true);
  });
});
