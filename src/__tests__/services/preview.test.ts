import * as os from 'node:os';
import * as nodePath from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockExecFile, mockMkdtemp, mockMkdir, mockWriteFile, mockRm } = vi.hoisted(() => {
  const mockExecFile = vi.fn();

  // promisify(execFile) uses a custom symbol to return {stdout, stderr}
  // The mock needs this so the promisified wrapper resolves correctly.
  const customPromisify = Symbol.for('nodejs.util.promisify.custom');
  (mockExecFile as unknown as Record<symbol, unknown>)[customPromisify] = (...args: unknown[]) =>
    new Promise((resolve, reject) => {
      mockExecFile(...args, (err: Error | null, stdout: string, stderr: string) => {
        if (err) reject(err);
        else resolve({ stdout, stderr });
      });
    });

  return {
    mockExecFile,
    mockMkdtemp: vi.fn(),
    mockMkdir: vi.fn(),
    mockWriteFile: vi.fn(),
    mockRm: vi.fn(),
  };
});

vi.unmock('../../services/preview.ts');
vi.mock('node:child_process', () => ({ execFile: mockExecFile }));
const { mockMissingPathDir } = vi.hoisted(() => ({
  mockMissingPathDir: vi.fn<() => string | null>(() => null),
}));
vi.mock('../../services/installer.ts', () => ({ getMissingStarshipPathDir: mockMissingPathDir }));
vi.mock('node:fs/promises', () => ({
  mkdir: mockMkdir,
  mkdtemp: mockMkdtemp,
  rm: mockRm,
  writeFile: mockWriteFile,
}));

import { generateToml } from '../../generators/starship.ts';
import {
  DEFAULT_PREVIEW_DEPS,
  type PreviewDeps,
  renderPromptAsync,
  STARSHIP_CONFIG_FILE,
} from '../../services/preview.ts';
import { DEFAULT_STATE, type WizardState } from '../../types.ts';

const SCRATCH = '/tmp/scratch/preview-abc';
const PROJECT = nodePath.join(SCRATCH, 'projects', 'myapp');
const originalStarshipShell = process.env.STARSHIP_SHELL;
const originalXdgCache = process.env.XDG_CACHE_HOME;

function execFileSucceeds(stdout = '~/projects/myapp on  main \n❯') {
  mockExecFile.mockImplementation((...args: unknown[]) => {
    const cb = args[args.length - 1] as (...cbArgs: unknown[]) => void;
    cb(null, stdout, '');
  });
}

function execCalls() {
  return mockExecFile.mock.calls.map((call) => ({
    cmd: call[0] as string,
    args: call[1] as string[],
    opts: call[2] as { cwd?: string; env?: NodeJS.ProcessEnv },
  }));
}

function fakeDeps(overrides: Partial<PreviewDeps> = {}): PreviewDeps {
  return {
    isStarshipInstalled: vi.fn(async () => true),
    createScratch: vi.fn(async () => SCRATCH),
    writeConfig: vi.fn(async () => {}),
    scaffoldProject: vi.fn(async () => PROJECT),
    runStarshipPrompt: vi.fn(async () => '~/projects/myapp on  main \n❯'),
    cleanup: vi.fn(async () => {}),
    ...overrides,
  };
}

let state: WizardState;

beforeEach(() => {
  vi.clearAllMocks();
  execFileSucceeds();
  state = { ...DEFAULT_STATE, palette: 'vivid' };
  mockExecFile.mockClear();
});

afterEach(() => {
  if (originalXdgCache === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = originalXdgCache;
  if (originalStarshipShell === undefined) delete process.env.STARSHIP_SHELL;
  else process.env.STARSHIP_SHELL = originalStarshipShell;
});

describe('renderPromptAsync', () => {
  it('falls back to static when starship is not installed', async () => {
    const deps = fakeDeps({ isStarshipInstalled: vi.fn(async () => false) });

    const result = await renderPromptAsync(state, deps);

    expect(result).toEqual({ mode: 'static', reason: 'starship-missing' });
    expect(deps.createScratch).not.toHaveBeenCalled();
    expect(deps.cleanup).not.toHaveBeenCalled();
  });

  it('renders the real prompt through the injected deps and cleans up', async () => {
    const deps = fakeDeps();
    const expectedToml = generateToml(state);

    const result = await renderPromptAsync(state, deps);

    expect(result).toEqual({ mode: 'real', text: '~/projects/myapp on  main \n❯' });
    expect(deps.createScratch).toHaveBeenCalledOnce();
    expect(deps.scaffoldProject).toHaveBeenCalledWith(SCRATCH);
    expect(deps.writeConfig).toHaveBeenCalledWith(SCRATCH, expectedToml);
    expect(deps.runStarshipPrompt).toHaveBeenCalledWith(SCRATCH, PROJECT, 110);
    expect(deps.cleanup).toHaveBeenCalledWith(SCRATCH);
  });

  it('falls back to static and still cleans up when the prompt run fails', async () => {
    const deps = fakeDeps({
      runStarshipPrompt: vi.fn(async () => Promise.reject(new Error('nope'))),
    });

    const result = await renderPromptAsync(state, deps);

    expect(result).toEqual({ mode: 'static', reason: 'render-failed' });
    expect(deps.cleanup).toHaveBeenCalledWith(SCRATCH);
  });

  it('falls back to static when the render is empty', async () => {
    const deps = fakeDeps({ runStarshipPrompt: vi.fn(async () => '   ') });

    const result = await renderPromptAsync(state, deps);

    expect(result).toEqual({ mode: 'static', reason: 'render-failed' });
  });

  it('skips cleanup when the scratch dir was never created', async () => {
    const deps = fakeDeps({
      createScratch: vi.fn(async () => Promise.reject(new Error('no dir'))),
    });

    const result = await renderPromptAsync(state, deps);

    expect(result).toEqual({ mode: 'static', reason: 'render-failed' });
    expect(deps.cleanup).not.toHaveBeenCalled();
  });

  it('runs the real wiring: config, env, sample repo and starship invocation', async () => {
    process.env.XDG_CACHE_HOME = '/tmp/xdg-cache';
    process.env.STARSHIP_SHELL = 'bash';
    mockMkdtemp.mockResolvedValue(SCRATCH);
    mockWriteFile.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
    mockRm.mockResolvedValue(undefined);

    const result = await renderPromptAsync(state, DEFAULT_PREVIEW_DEPS);

    expect(result).toEqual({ mode: 'real', text: '~/projects/myapp on  main \n❯' });
    expect(mockMkdtemp).toHaveBeenCalledWith(nodePath.join(os.tmpdir(), 'shellconf-preview-'));

    const calls = execCalls();
    const prompt = calls.find((c) => c.cmd === 'starship' && c.args[0] === 'prompt');
    expect(prompt).toBeDefined();
    expect(prompt?.args).toContain('--path');
    expect(prompt?.args).toContain(PROJECT);
    expect(prompt?.args).toContain('--terminal-width');
    expect(prompt?.args).toContain('110');
    expect(prompt?.opts?.env?.HOME).toBe(SCRATCH);
    expect(prompt?.opts?.env?.PWD).toBe(PROJECT);
    expect(prompt?.opts?.env?.STARSHIP_SHELL).toBeUndefined();
    expect(prompt?.opts?.env?.STARSHIP_CONFIG).toBe(nodePath.join(SCRATCH, STARSHIP_CONFIG_FILE));

    const gitInit = calls.find((c) => c.cmd === 'git' && c.args.includes('init'));
    expect(gitInit?.opts?.cwd).toBe(PROJECT);
    const gitCommit = calls.find((c) => c.cmd === 'git' && c.args.includes('commit'));
    expect(gitCommit?.opts?.cwd).toBe(PROJECT);

    expect(mockWriteFile).toHaveBeenCalledWith(
      nodePath.join(SCRATCH, STARSHIP_CONFIG_FILE),
      generateToml(state),
      'utf8'
    );
    expect(mockRm).toHaveBeenCalledWith(SCRATCH, { recursive: true, force: true });
  });

  it('puts an off-PATH script install on PATH for the render', async () => {
    mockMissingPathDir.mockReturnValueOnce('/home/u/.local/bin');
    mockMkdtemp.mockResolvedValue(SCRATCH);
    mockWriteFile.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
    mockRm.mockResolvedValue(undefined);

    await renderPromptAsync(state, DEFAULT_PREVIEW_DEPS);

    const prompt = execCalls().find((c) => c.cmd === 'starship' && c.args[0] === 'prompt');
    expect(prompt?.opts?.env?.PATH?.startsWith('/home/u/.local/bin')).toBe(true);
  });

  it('keeps rendering even when the sample git repo cannot be created', async () => {
    process.env.XDG_CACHE_HOME = '/tmp/xdg-cache';
    mockMkdtemp.mockResolvedValue(SCRATCH);
    mockWriteFile.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
    mockRm.mockResolvedValue(undefined);
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (...cbArgs: unknown[]) => void;
      const cmd = args[0] as string;
      if (cmd === 'git') cb(new Error('git missing'), '', '');
      else cb(null, '~/projects/myapp on  main \n❯', '');
    });

    const result = await renderPromptAsync(state, DEFAULT_PREVIEW_DEPS);

    expect(result).toEqual({ mode: 'real', text: '~/projects/myapp on  main \n❯' });
  });

  it('falls back and still cleans up when the config cannot be written', async () => {
    const deps = fakeDeps({ writeConfig: vi.fn(async () => Promise.reject(new Error('EROFS'))) });

    const result = await renderPromptAsync(state, deps);

    expect(result).toEqual({ mode: 'static', reason: 'render-failed' });
    expect(deps.runStarshipPrompt).not.toHaveBeenCalled();
    expect(deps.cleanup).toHaveBeenCalledWith(SCRATCH);
  });

  it('keeps a finished render when removing the scratch dir fails', async () => {
    mockMkdtemp.mockResolvedValue(SCRATCH);
    mockWriteFile.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
    mockRm.mockRejectedValue(new Error('EBUSY'));

    const result = await renderPromptAsync(state, DEFAULT_PREVIEW_DEPS);

    expect(result).toEqual({ mode: 'real', text: '~/projects/myapp on  main \n❯' });
    expect(mockRm).toHaveBeenCalled();
  });

  it('still renders when git init works but the sample commit fails', async () => {
    mockMkdtemp.mockResolvedValue(SCRATCH);
    mockWriteFile.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
    mockRm.mockResolvedValue(undefined);
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (...cbArgs: unknown[]) => void;
      const cmd = args[0] as string;
      const cmdArgs = args[1] as string[];
      if (cmd === 'git' && cmdArgs.includes('commit')) cb(new Error('no identity'), '', '');
      else cb(null, '~/projects/myapp on  main \n❯', '');
    });

    const result = await renderPromptAsync(state, DEFAULT_PREVIEW_DEPS);

    expect(result).toEqual({ mode: 'real', text: '~/projects/myapp on  main \n❯' });
    expect(execCalls().some((c) => c.cmd === 'git' && c.args.includes('init'))).toBe(true);
  });

  it('pins both static fallbacks as snapshots (P2 gate)', async () => {
    const missing = await renderPromptAsync(
      state,
      fakeDeps({ isStarshipInstalled: vi.fn(async () => false) })
    );
    expect(missing).toMatchSnapshot();

    const failed = await renderPromptAsync(
      state,
      fakeDeps({ runStarshipPrompt: vi.fn(async () => Promise.reject(new Error('nope'))) })
    );
    expect(failed).toMatchSnapshot();
  });
});
