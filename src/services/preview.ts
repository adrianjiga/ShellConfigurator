import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as nodePath from 'node:path';
import { promisify } from 'node:util';
import { generateToml } from '../generators/starship.ts';
import type { WizardState } from '../types.ts';
import { findStarshipAsync } from './detector.ts';
import { runCapture } from './exec.ts';
import { getMissingStarshipPathDir } from './installer.ts';

const execFileP = promisify(execFile);

/** The file name the generated TOML is written to inside the scratch dir. */
export const STARSHIP_CONFIG_FILE = 'starship.toml';

/**
 * The width the real render targets when the caller gives none. Starship's
 * `$fill` computes the gap to this width, so the caller passes the width of the
 * panel the prompt is drawn in.
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
  runStarshipPrompt(scratch: string, projectDir: string, width: number): Promise<string>;
  /** Removes the scratch dir. Must not throw. */
  cleanup(scratch: string): Promise<void>;
}

const SAMPLE_PROJECT_NAME = 'myapp';

/**
 * The environment `starship` runs in against `configPath`: a script install
 * off PATH on PATH, and `home` as HOME when given.
 */
export function starshipEnv(configPath: string, home?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...(home ? { HOME: home } : {}),
    STARSHIP_CONFIG: configPath,
  };
  const pathDir = getMissingStarshipPathDir();
  if (pathDir) env.PATH = `${pathDir}${nodePath.delimiter}${process.env.PATH ?? ''}`;
  // Starship formats its output for the calling shell when STARSHIP_SHELL is
  // set (e.g. bash's literal `\[`/`\]` markers). Raw ANSI output is wanted here.
  delete env.STARSHIP_SHELL;
  return env;
}

export const DEFAULT_PREVIEW_DEPS: PreviewDeps = {
  // A script install off PATH still renders the preview.
  isStarshipInstalled: async () => (await findStarshipAsync()).installed,
  // The system temp dir, not the app cache: a dry run writes nothing of the
  // app's, and a scratch dir a crash leaves behind is cleaned by the OS.
  createScratch: async () => mkdtemp(nodePath.join(os.tmpdir(), 'shellconf-preview-')),
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
    // The sample repo must not touch the user's git: no inherited GIT_DIR (which
    // would commit into their real repo), no global config, hooks or signing.
    const gitEnv: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: scratch,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: nodePath.join(scratch, 'no-gitconfig'),
    };
    for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CONFIG']) {
      delete gitEnv[name];
    }
    const gitOptions = { cwd: project, env: gitEnv, timeout: 10_000 };
    try {
      // Best-effort: without git the branch/status modules just stay hidden.
      await execFileP('git', ['init', '-q', '-b', 'main'], gitOptions);
      await execFileP(
        'git',
        [
          '-c',
          'user.name=ShellConfigurator',
          '-c',
          'user.email=preview@localhost',
          '-c',
          'commit.gpgsign=false',
          '-c',
          'core.hooksPath=/dev/null',
          'commit',
          '--allow-empty',
          '-q',
          '-m',
          'init',
        ],
        gitOptions
      );
    } catch {
      // Non-fatal: the preview still renders everything git does not drive.
    }
    return project;
  },
  runStarshipPrompt: async (scratch, projectDir, width) =>
    runCapture('starship', ['prompt', '--path', projectDir, '--terminal-width', String(width)], {
      env: {
        ...starshipEnv(nodePath.join(scratch, STARSHIP_CONFIG_FILE), scratch),
        PWD: projectDir,
      },
    }),
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
  deps: PreviewDeps = DEFAULT_PREVIEW_DEPS,
  width: number = PREVIEW_TERMINAL_WIDTH
): Promise<PreviewResult> {
  if (!(await deps.isStarshipInstalled())) {
    return { mode: 'static', reason: 'starship-missing' };
  }

  try {
    const text = await withPreviewProject(state, deps, (scratch, projectDir) =>
      deps.runStarshipPrompt(scratch, projectDir, width)
    );
    if (text.trim().length === 0) return { mode: 'static', reason: 'render-failed' };
    return { mode: 'real', text };
  } catch {
    return { mode: 'static', reason: 'render-failed' };
  }
}

export type ScratchDeps = Pick<
  PreviewDeps,
  'createScratch' | 'writeConfig' | 'scaffoldProject' | 'cleanup'
>;

/**
 * Runs `run` with a scratch folder holding the generated config for `state`
 * and the sample project, and removes the folder afterwards.
 */
export async function withPreviewProject<T>(
  state: WizardState,
  deps: ScratchDeps,
  run: (scratch: string, projectDir: string) => Promise<T>
): Promise<T> {
  let scratch: string | null = null;
  try {
    scratch = await deps.createScratch();
    await deps.writeConfig(scratch, generateToml(state));
    return await run(scratch, await deps.scaffoldProject(scratch));
  } finally {
    if (scratch) await deps.cleanup(scratch);
  }
}
