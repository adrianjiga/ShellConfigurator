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

vi.mock('node:child_process', () => ({ execFile: mockExecFile }));
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
  delete process.env.XDG_CACHE_HOME;
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
    expect(deps.runStarshipPrompt).toHaveBeenCalledWith(SCRATCH, PROJECT);
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
    mockMkdtemp.mockResolvedValue(SCRATCH);
    mockWriteFile.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
    mockRm.mockResolvedValue(undefined);

    const result = await renderPromptAsync(state, DEFAULT_PREVIEW_DEPS);

    expect(result).toEqual({ mode: 'real', text: '~/projects/myapp on  main \n❯' });
    expect(mockMkdtemp).toHaveBeenCalledWith('/tmp/xdg-cache/shell-configurator/preview-');

    const calls = execCalls();
    const prompt = calls.find((c) => c.cmd === 'starship' && c.args[0] === 'prompt');
    expect(prompt).toBeDefined();
    expect(prompt?.args).toContain('--path');
    expect(prompt?.args).toContain(PROJECT);
    expect(prompt?.args).toContain('--terminal-width');
    expect(prompt?.args).toContain('110');
    expect(prompt?.opts?.env?.HOME).toBe(SCRATCH);
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
});
