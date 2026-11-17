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

import { runGenerate, runMarkdownCommand } from '../../../cli/commands/generate.ts';
import { runGlobalFlags, runHeadlessCommand } from '../../../cli/route.ts';
import { type CliFlags, parseCliArgs } from '../../../services/args.ts';
import { CliRunError, CliUsageError } from '../../../services/errors.ts';
import { STATE_VERSION, serializeState } from '../../../services/state.ts';
import { DEFAULT_STATE, type WizardState } from '../../../types.ts';

const flags = (partial: Partial<CliFlags>): CliFlags => ({
  subcommand: 'generate',
  help: false,
  version: false,
  ...partial,
});

function writeFixtureCard(dir: string, state: Partial<WizardState> = {}): string {
  const file = path.join(dir, 'card.json');
  fs.writeFileSync(file, serializeState({ ...DEFAULT_STATE, ...state }));
  return file;
}

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

describe('runGenerate', () => {
  let stdoutWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects an adopt-mode state card', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-configurator-'));
    try {
      const card = writeFixtureCard(dir, { keepExistingConfig: true });
      expect(() => runGenerate(flags({ stateFile: card }))).toThrow(CliUsageError);
      expect(() => runGenerate(flags({ stateFile: card }))).toThrow(/adopt-mode/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects --adopt on the generate subcommand', () => {
    expect(() => runGenerate(flags({ adopt: true }))).toThrow(/apply subcommand/);
  });

  it('rejects --import-url on the generate subcommand', () => {
    expect(() => runGenerate(flags({ importUrl: 'https://example.com/starship.toml' }))).toThrow(
      /apply subcommand/
    );
  });

  it('writes the generated TOML to stdout by default', () => {
    runGenerate(flags({ preset: 'pure-prompt' }));
    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('format'));
  });

  it('-o writes the TOML to a file and stays silent on stdout', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-configurator-'));
    try {
      const out = path.join(dir, 'starship.toml');
      runGenerate(flags({ preset: 'pure-prompt', outputFile: out }));
      expect(fs.existsSync(out)).toBe(true);
      expect(fs.readFileSync(out, 'utf8')).toContain('format');
      expect(stdoutWrite).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--export writes the versioned state card instead of TOML', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-configurator-'));
    try {
      const out = path.join(dir, 'card.json');
      runGenerate(flags({ preset: 'catppuccin-powerline', exportFile: out }));
      const card = JSON.parse(fs.readFileSync(out, 'utf8')) as {
        version: number;
        wizard: WizardState;
      };
      expect(card.version).toBe(STATE_VERSION);
      expect(card.wizard.palette).toBe('catppuccin');
      expect(card.wizard.powerline).toBe(true);
      expect(stdoutWrite).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--export and -o both write when given together', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-configurator-'));
    try {
      const card = path.join(dir, 'card.json');
      const out = path.join(dir, 'starship.toml');
      runGenerate(flags({ preset: 'pure-prompt', exportFile: card, outputFile: out }));

      expect(JSON.parse(fs.readFileSync(card, 'utf8'))).toMatchObject({ version: 1 });
      expect(fs.readFileSync(out, 'utf8')).toContain('format');
      expect(stdoutWrite).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('still writes -o under --dry-run, since generate installs nothing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-configurator-'));
    try {
      const out = path.join(dir, 'out.toml');
      runGenerate(flags({ preset: 'pure-prompt', outputFile: out, dryRun: true }));
      expect(fs.readFileSync(out, 'utf8')).toContain('$character');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps the card it wrote when the TOML write then fails', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-configurator-'));
    try {
      const card = path.join(dir, 'card.json');
      const out = path.join(dir, 'missing-dir', 'out.toml');
      expect(() =>
        runGenerate(flags({ preset: 'pure-prompt', exportFile: card, outputFile: out }))
      ).toThrow(/Could not write TOML/);
      expect(JSON.parse(fs.readFileSync(card, 'utf8')).version).toBe(STATE_VERSION);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects writing the card and the TOML to the same file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-configurator-'));
    try {
      const out = path.join(dir, 'starship.toml');
      expect(() =>
        runGenerate(flags({ preset: 'pure-prompt', exportFile: out, outputFile: out }))
      ).toThrow(CliUsageError);
      expect(fs.existsSync(out)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('leaves no temp file behind when the atomic write fails', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-configurator-'));
    try {
      const out = path.join(dir, 'starship.toml');
      fs.mkdirSync(out);
      expect(() => runGenerate(flags({ preset: 'pure-prompt', outputFile: out }))).toThrow(
        CliRunError
      );
      expect(fs.readdirSync(dir)).toEqual(['starship.toml']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports an unwritable -o path as a run failure', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-configurator-'));
    try {
      const out = path.join(dir, 'missing-dir', 'starship.toml');
      expect(() => runGenerate(flags({ preset: 'pure-prompt', outputFile: out }))).toThrow(
        CliRunError
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports an unwritable --export path as a run failure', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-configurator-'));
    try {
      const out = path.join(dir, 'missing-dir', 'card.json');
      expect(() => runGenerate(flags({ preset: 'pure-prompt', exportFile: out }))).toThrow(
        CliRunError
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
