import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as nodePath from 'node:path';
import { promisify } from 'node:util';
import { generateToml } from '../generators/starship.ts';
import type { WizardState } from '../types.ts';
import { isStarshipInstalledAsync } from './detector.ts';
import { runCapture } from './exec.ts';
import { cacheDir } from './paths.ts';

const execFileP = promisify(execFile);

/** The file name the generated TOML is written to inside the scratch dir. */
export const STARSHIP_CONFIG_FILE = 'starship.toml';

/**
 * The width the real render is told to target. Starship's `$fill` computes the
 * gap to this width; a fixed value keeps the preview stable regardless of the
 * user's terminal size.
 */
export const PREVIEW_TERMINAL_WIDTH = 110;

/** How long a config change waits before a real render is (re)run. */
export const PREVIEW_DEBOUNCE_MS = 200;

/**
 * What the preview should show: the real starship output, or a fallback and why.
 */
export type PreviewResult =
  | { mode: 'real'; text: string }
  | { mode: 'static'; reason: 'starship-missing' | 'render-failed' };

/**
 * The seams `renderPromptAsync` renders through, so tests can fake every piece
 * that touches a binary or the filesystem without mocking modules globally.
 */
export interface PreviewDeps {
  isStarshipInstalled(): Promise<boolean>;
  /** Creates an empty scratch dir under the cache and returns its path. */
  createScratch(): Promise<string>;
  /** Writes the generated config file into the scratch dir. */
  writeConfig(scratch: string, toml: string): Promise<void>;
  /**
   * Scaffolds a sample project (git repo + package.json) under the scratch dir
   * so the directory/git/node modules render real state, and returns its cwd.
   */
  scaffoldProject(scratch: string): Promise<string>;
  /** Runs `starship prompt` against the scratch config and sample cwd. */
  runStarshipPrompt(scratch: string, projectDir: string): Promise<string>;
  /** Removes the scratch dir. Must not throw. */
  cleanup(scratch: string): Promise<void>;
}

const SAMPLE_PROJECT_NAME = 'myapp';

export const DEFAULT_PREVIEW_DEPS: PreviewDeps = {
  isStarshipInstalled: async () => (await isStarshipInstalledAsync()).installed,
  createScratch: async () => mkdtemp(nodePath.join(cacheDir(), 'preview-')),
  writeConfig: async (scratch, toml) =>
    writeFile(nodePath.join(scratch, STARSHIP_CONFIG_FILE), toml, 'utf8'),
  scaffoldProject: async (scratch) => {
    const project = nodePath.join(scratch, 'projects', SAMPLE_PROJECT_NAME);
    await mkdir(nodePath.join(project, 'src'), { recursive: true });
    await Promise.all([
      writeFile(
        nodePath.join(project, 'package.json'),
        '{"name":"myapp","private":true,"version":"0.0.0"}\n',
        'utf8'
      ),
      writeFile(nodePath.join(project, 'src', 'index.ts'), '// sample source file\n', 'utf8'),
    ]);
    try {
      // Best-effort: without git the branch/status modules just stay hidden.
      await execFileP('git', ['init', '-q', '-b', 'main'], { cwd: project });
      await execFileP(
        'git',
        [
          '-c',
          'user.name=ShellConfigurator',
          '-c',
          'user.email=preview@localhost',
          'commit',
          '--allow-empty',
          '-q',
          '-m',
          'init',
        ],
        { cwd: project }
      );
    } catch {
      // Non-fatal: the preview still renders everything git does not drive.
    }
    return project;
  },
  runStarshipPrompt: async (scratch, projectDir) =>
    runCapture(
      'starship',
      ['prompt', '--path', projectDir, '--terminal-width', String(PREVIEW_TERMINAL_WIDTH)],
      {
        env: {
          ...process.env,
          HOME: scratch,
          STARSHIP_CONFIG: nodePath.join(scratch, STARSHIP_CONFIG_FILE),
        },
      }
    ),
  cleanup: async (scratch) => {
    try {
      await rm(scratch, { recursive: true, force: true });
    } catch {
      // Scratch cleanup is best-effort; a leftover dir is harmless.
    }
  },
};

/**
 * Renders the real prompt for `state` via the starship binary, falling back to
 * `static` when the binary is absent or anything in the render fails. The
 * static fallback is drawn by the consumer, which is why the failure reason is
 * returned rather than thrown.
 */
export async function renderPromptAsync(
  state: WizardState,
  deps: PreviewDeps = DEFAULT_PREVIEW_DEPS
): Promise<PreviewResult> {
  if (!(await deps.isStarshipInstalled())) {
    return { mode: 'static', reason: 'starship-missing' };
  }

  let scratch: string | null = null;
  try {
    scratch = await deps.createScratch();
    await deps.writeConfig(scratch, generateToml(state));
    const projectDir = await deps.scaffoldProject(scratch);
    const text = await deps.runStarshipPrompt(scratch, projectDir);
    if (text.trim().length === 0) return { mode: 'static', reason: 'render-failed' };
    return { mode: 'real', text };
  } catch {
    return { mode: 'static', reason: 'render-failed' };
  } finally {
    if (scratch) await deps.cleanup(scratch);
  }
}
