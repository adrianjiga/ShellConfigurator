import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('ink', async () => {
  const actual = await vi.importActual<typeof import('ink')>('ink');
  return {
    ...actual,
    render: vi.fn().mockReturnValue({
      waitUntilExit: () => Promise.resolve(),
    }),
  };
});

vi.mock('../../../app.tsx', () => ({
  App: () => null,
}));

const { mockRecordRun } = vi.hoisted(() => ({
  mockRecordRun: vi.fn(),
}));

vi.mock('../../../services/detector.ts', async () => {
  const actual = await vi.importActual<typeof import('../../../services/detector.ts')>(
    '../../../services/detector.ts'
  );
  return {
    ...actual,
    detectInstalledShellsAsync: vi.fn().mockResolvedValue(['zsh']),
    detectPackageManagerAsync: vi.fn().mockResolvedValue('apt'),
    detectTerminalAsync: vi.fn().mockResolvedValue(null),
    detectContainerAsync: vi.fn().mockResolvedValue(false),
  };
});

vi.mock('../../../services/history.ts', async () => {
  const actual = await vi.importActual<typeof import('../../../services/history.ts')>(
    '../../../services/history.ts'
  );
  return {
    ...actual,
    recordRun: mockRecordRun,
    recordRunSafely: (options: Parameters<typeof actual.recordRun>[0]) =>
      actual.recordRunSafely(options, mockRecordRun),
  };
});

const { mockRunDoctor, mockFormatDoctorReport, mockRunRepair, mockFormatRepairReport } = vi.hoisted(
  () => ({
    mockRunDoctor: vi.fn(),
    mockFormatDoctorReport: vi.fn(),
    mockRunRepair: vi.fn(),
    mockFormatRepairReport: vi.fn(),
  })
);

const { mockRunInstallTasks } = vi.hoisted(() => ({
  mockRunInstallTasks: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../../services/installTasks.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/installTasks.ts')>()),
  runInstallTasks: mockRunInstallTasks,
}));

vi.mock('../../../services/doctor.ts', () => ({
  runDoctor: mockRunDoctor,
  formatDoctorReport: mockFormatDoctorReport,
}));

vi.mock('../../../services/repair.ts', () => ({
  DEFAULT_REPAIR_DEPS: {},
  runRepair: mockRunRepair,
  formatRepairReport: mockFormatRepairReport,
}));

import { runMarkdownCommand } from '../../../cli/commands/generate.ts';
import { runGlobalFlags, runHeadlessCommand } from '../../../cli/route.ts';
import { parseCliArgs } from '../../../services/args.ts';

let scratchHome: string;

beforeEach(() => {
  scratchHome = fs.mkdtempSync(path.join(os.tmpdir(), 'shellconf-index-home-'));
  vi.stubEnv('HOME', scratchHome);
  vi.stubEnv('XDG_STATE_HOME', undefined);
  vi.stubEnv('XDG_CONFIG_HOME', undefined);
  vi.stubEnv('ZDOTDIR', undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(scratchHome, { recursive: true, force: true });
});

describe('index generate --markdown', () => {
  let stdoutWrite: ReturnType<typeof vi.spyOn>;
  const output = () => stdoutWrite.mock.calls.map((c: unknown[]) => String(c[0])).join('');
  beforeEach(() => {
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true as never);
  });
  afterEach(() => stdoutWrite.mockRestore());

  it('prints the prompt the flags build as Markdown', async () => {
    await runHeadlessCommand(
      parseCliArgs(['generate', '--markdown', '--preset', 'pure-prompt']),
      ''
    );
    expect(output()).toMatch(/^# Starship prompt: Pure Prompt\n/);
    expect(output()).toContain('```toml');
  });

  it('writes it to the -o file instead', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shellconf-share-cli-'));
    const file = path.join(dir, 'prompt.md');
    try {
      runMarkdownCommand(parseCliArgs(['generate', '--markdown', '-o', file]));
      expect(fs.readFileSync(file, 'utf8')).toContain('## starship.toml');
      expect(output()).toBe(`Wrote ${file}\n`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([
    [['--shells', 'zsh'], /--shells cannot be used with generate --markdown/],
    [['--export', 'card.json'], /--export cannot be used with generate --markdown/],
    [['--json'], /--json cannot be used with generate/],
  ])('rejects %o', async (args, message) => {
    await expect(
      runHeadlessCommand(parseCliArgs(['generate', '--markdown', ...args]), '')
    ).rejects.toThrow(message);
  });

  it('rejects --markdown outside generate', async () => {
    await expect(
      runHeadlessCommand(parseCliArgs(['apply', '--markdown', '--shells', 'zsh']), '')
    ).rejects.toThrow('--markdown cannot be used with apply.');
  });

  it('points the retired share at generate --markdown', () => {
    expect(() => parseCliArgs(['share'])).toThrow(
      'share is gone: shell-configurator generate --markdown prints the same Markdown.'
    );
  });

  it('documents --markdown in the help text', () => {
    runGlobalFlags(parseCliArgs(['--help']));
    expect(output()).toContain('--markdown');
    expect(output()).not.toContain('shell-configurator share');
  });
});
