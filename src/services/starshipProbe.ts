import * as nodePath from 'node:path';
import type { WizardState } from '../types.ts';
import { findStarshipAsync } from './detector.ts';
import { CAPTURE_TIMEOUT_MS, runCaptureBoth } from './exec.ts';
import {
  DEFAULT_PREVIEW_DEPS,
  type ScratchDeps,
  STARSHIP_CONFIG_FILE,
  starshipEnv,
  withPreviewProject,
} from './preview.ts';

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const ESCAPES = new RegExp(
  `${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)|${ESC}\\[[0-?]*[ -/]*[@-~]|${ESC}[@-Z\\\\-_]`,
  'g'
);

export function stripAnsi(text: string): string {
  return text.replace(ESCAPES, '');
}

export interface ModuleTiming {
  module: string;
  ms: number;
  output: string;
}

const DURATION_MS: Record<string, number> = { ns: 1e-6, µs: 1e-3, us: 1e-3, ms: 1, s: 1000 };

function parseDuration(text: string): number | null {
  if (text.startsWith('<')) return 0;
  const match = /^([\d.]+)(ns|µs|us|ms|s)$/.exec(text);
  return match ? Number(match[1]) * DURATION_MS[match[2]] : null;
}

export function parseTimings(text: string): ModuleTiming[] {
  return stripAnsi(text)
    .split('\n')
    .flatMap((line) => {
      const match = /^\s*(\S+)\s+-\s+(\S+)\s+-\s+"(.*)"\s*$/.exec(line);
      const ms = match ? parseDuration(match[2]) : null;
      return match && ms !== null ? [{ module: match[1], ms, output: match[3] }] : [];
    })
    .sort((a, b) => b.ms - a.ms);
}

export interface Explanation {
  output: string;
  description: string;
}

export function parseExplain(text: string): Explanation[] {
  const items: Explanation[] = [];
  for (const line of stripAnsi(text).split('\n')) {
    const at = line.indexOf('  -  ');
    if (at === -1) {
      const last = items.at(-1);
      if (last && /^\s/.test(line) && line.trim()) last.description += ` ${line.trim()}`;
      continue;
    }
    const output = line.slice(0, at).trim();
    const description = line.slice(at + 5).trim();
    if (output && description) items.push({ output, description });
  }
  return items;
}

export const SLOW_MODULE_MS = 50;
/** Starship runs modules in parallel, so a prompt is about as slow as its slowest module. */
export const SLOW_PROMPT_MS = 200;

const DEFAULT_COMMAND_TIMEOUT_MS = 500;
const DEFAULT_SCAN_TIMEOUT_MS = 30;

const VERSION_MODULES = new Set([
  'bun',
  'c',
  'cmake',
  'crystal',
  'dart',
  'deno',
  'dotnet',
  'elixir',
  'elm',
  'erlang',
  'golang',
  'gradle',
  'haskell',
  'java',
  'julia',
  'kotlin',
  'lua',
  'nim',
  'nodejs',
  'ocaml',
  'perl',
  'php',
  'python',
  'ruby',
  'rust',
  'scala',
  'swift',
  'zig',
]);

export interface Suggestion {
  module?: string;
  text: string;
  toml?: string;
}

function topLevelNumber(toml: string, key: string): number | null {
  let openString: string | null = null;
  for (const line of toml.split('\n')) {
    if (openString) {
      if (line.includes(openString)) openString = null;
      continue;
    }
    const trimmed = line.trim();
    if (trimmed.startsWith('[')) return null;
    const match = new RegExp(`^${key}\\s*=\\s*(\\d[\\d_]*)\\s*(?:#.*)?$`).exec(trimmed);
    if (match) return Number(match[1].replaceAll('_', ''));
    openString = ['"""', "'''"].find((quote) => line.split(quote).length % 2 === 0) ?? null;
  }
  return null;
}

const ALWAYS_ON = new Set(['character', 'line_break', 'fill']);

const TOOL_OF: Record<string, readonly string[]> = {
  nodejs: ['node'],
  python: ['python', 'python3', 'pyenv'],
  rust: ['rustc', 'rustup'],
  golang: ['go'],
  ruby: ['ruby'],
  java: ['java'],
  php: ['php'],
  deno: ['deno'],
  bun: ['bun'],
  dotnet: ['dotnet'],
  git_status: ['git'],
  git_metrics: ['git'],
  git_branch: ['git'],
  git_commit: ['git'],
  aws: ['aws'],
  docker_context: ['docker'],
  kubernetes: ['kubectl'],
};

function moduleSuggestion(timing: ModuleTiming): Suggestion {
  const took = `${timing.module} took ${Math.round(timing.ms)}ms`;
  if (timing.module === 'git_status' || timing.module === 'git_metrics') {
    return {
      module: timing.module,
      text: `${took}: git is slow to report changes in this repo. In a large repo, turn on git's file system monitor (git config core.fsmonitor true), or turn the module off here.`,
      toml: `[${timing.module}]\ndisabled = true`,
    };
  }
  if (VERSION_MODULES.has(timing.module)) {
    return {
      module: timing.module,
      text: `${took}: it runs the tool's version command on every prompt. Turn it off if you do not need the version shown.`,
      toml: `[${timing.module}]\ndisabled = true`,
    };
  }
  if (timing.module === 'directory') {
    return {
      module: timing.module,
      text: `${took}: reading this folder is slow, which usually means a network or synced drive rather than the config.`,
    };
  }
  return {
    module: timing.module,
    text: `${took}. Turn it off if you can do without it.`,
    toml: `[${timing.module}]\ndisabled = true`,
  };
}

export function suggestFixes(
  timings: ModuleTiming[],
  warnings: string,
  toml: string
): Suggestion[] {
  const commandTimeout = topLevelNumber(toml, 'command_timeout') ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const scanTimeout = topLevelNumber(toml, 'scan_timeout') ?? DEFAULT_SCAN_TIMEOUT_MS;
  const plain = stripAnsi(warnings);
  const suggestions: Suggestion[] = [];

  const timedOut = [...plain.matchAll(/Executing command "([^"]+)" timed out/g)].map((m) =>
    nodePath.basename(m[1])
  );
  if (timedOut.length > 0) {
    const commands = [...new Set(timedOut)];
    suggestions.push({
      text: `${commands.join(', ')} did not answer within command_timeout (${commandTimeout}ms), so ${commands.length === 1 ? 'its module' : 'their modules'} showed nothing. Raise the timeout at the top of the config.`,
      toml: `command_timeout = ${Math.max(commandTimeout * 2, 1000)}`,
    });
  }
  if (/scan\w*[^\n]*timed out/i.test(plain)) {
    suggestions.push({
      text: `Scanning this folder took longer than scan_timeout (${scanTimeout}ms), so modules that look for project files may be missing. Raise it at the top of the config.`,
      toml: `scan_timeout = ${Math.max(scanTimeout * 2, 100)}`,
    });
  }
  const timedOutTool = (module: string) =>
    timedOut.some((command) => command === module || TOOL_OF[module]?.includes(command));
  for (const timing of timings) {
    if (
      timing.ms >= SLOW_MODULE_MS &&
      !ALWAYS_ON.has(timing.module) &&
      !timedOutTool(timing.module)
    ) {
      suggestions.push(moduleSuggestion(timing));
    }
  }
  return suggestions;
}

export interface TimingsReport {
  path: string;
  slowestMs: number;
  slow: boolean;
  modules: ModuleTiming[];
  suggestions: Suggestion[];
}

export interface ProbeDeps {
  isStarshipInstalled(): Promise<boolean>;
  /** Runs `starship <command>` for `path` (passed as --path and PWD) against `configPath`. */
  run(
    command: 'timings' | 'explain',
    path: string,
    configPath: string,
    home?: string
  ): Promise<{ stdout: string; stderr: string }>;
}

export const DEFAULT_PROBE_DEPS: ProbeDeps = {
  isStarshipInstalled: async () => (await findStarshipAsync()).installed,
  run: (command, path, configPath, home) =>
    runCaptureBoth('starship', [command, '--path', path, '--terminal-width', '200'], {
      env: { ...starshipEnv(configPath, home), PWD: path },
    }),
};

export class StarshipTimedOutError extends Error {
  constructor(path: string) {
    super(
      `Starship did not finish timing the prompt in ${path} within ${CAPTURE_TIMEOUT_MS / 1000}s, so a module here is very slow; in a large git repo that is usually git_status. Try timings with a config that leaves git_status out, or turn on git's file system monitor (git config core.fsmonitor true).`
    );
    this.name = 'StarshipTimedOutError';
  }
}

export class StarshipMissingError extends Error {
  constructor() {
    super('Starship is not installed, so there is nothing to time. Install it first.');
    this.name = 'StarshipMissingError';
  }
}

/**
 * Times every module of the config `toml` with `starship timings` in the folder
 * `path`, with the real HOME so modules see what they would in a real prompt.
 * Reads only: the config goes to a temporary folder.
 */
export async function timePrompt(
  toml: string,
  path: string,
  deps: ProbeDeps = DEFAULT_PROBE_DEPS,
  scratchDeps: Pick<ScratchDeps, 'createScratch' | 'writeConfig' | 'cleanup'> = DEFAULT_PREVIEW_DEPS
): Promise<TimingsReport> {
  if (!(await deps.isStarshipInstalled())) throw new StarshipMissingError();
  const scratch = await scratchDeps.createScratch();
  try {
    const configPath = nodePath.join(scratch, STARSHIP_CONFIG_FILE);
    await scratchDeps.writeConfig(scratch, toml);
    let output: { stdout: string; stderr: string };
    try {
      output = await deps.run('timings', path, configPath);
    } catch (err) {
      if ((err as { killed?: boolean }).killed) throw new StarshipTimedOutError(path);
      throw err;
    }
    const { stdout, stderr } = output;
    const modules = parseTimings(stdout);
    const slowestMs = modules[0]?.ms ?? 0;
    return {
      path,
      slowestMs,
      slow: slowestMs >= SLOW_PROMPT_MS,
      modules,
      suggestions: suggestFixes(modules, stderr, toml),
    };
  } finally {
    await scratchDeps.cleanup(scratch);
  }
}

export type ExplainResult =
  | { mode: 'real'; items: Explanation[] }
  | { mode: 'unavailable'; reason: 'starship-missing' | 'explain-failed' };

export async function explainPromptAsync(
  state: WizardState,
  deps: ProbeDeps = DEFAULT_PROBE_DEPS,
  scratchDeps: ScratchDeps = DEFAULT_PREVIEW_DEPS
): Promise<ExplainResult> {
  if (!(await deps.isStarshipInstalled())) {
    return { mode: 'unavailable', reason: 'starship-missing' };
  }
  try {
    const { stdout } = await withPreviewProject(state, scratchDeps, (scratch, project) =>
      deps.run('explain', project, nodePath.join(scratch, STARSHIP_CONFIG_FILE), scratch)
    );
    const items = parseExplain(stdout);
    return items.length > 0
      ? { mode: 'real', items }
      : { mode: 'unavailable', reason: 'explain-failed' };
  } catch {
    return { mode: 'unavailable', reason: 'explain-failed' };
  }
}

export function formatTimings(report: TimingsReport, config: string): string {
  const width = Math.max(0, ...report.modules.map((timing) => timing.module.length));
  const ms = (value: number) => (value < 1 ? '<1ms' : `${Math.round(value)}ms`);
  const lines = [
    `Starship module timings in ${report.path} (config: ${config})`,
    '',
    ...(report.modules.length > 0
      ? report.modules.map(
          (timing) =>
            `  ${timing.module.padEnd(width)}  ${ms(timing.ms).padStart(6)}${timing.ms >= SLOW_MODULE_MS ? '  slow' : ''}`
        )
      : ['  Starship reported no modules for this folder.']),
    '',
    report.slow
      ? `The prompt waits about ${ms(report.slowestMs)} for its slowest module, which you will notice.`
      : `The slowest module takes ${ms(report.slowestMs)}, which is fast enough.`,
  ];
  if (report.suggestions.length > 0) {
    lines.push('', 'Suggestions:');
    for (const suggestion of report.suggestions) {
      lines.push(`  - ${suggestion.text}`);
      if (suggestion.toml)
        lines.push(...suggestion.toml.split('\n').map((line) => `      ${line}`));
    }
  }
  return `${lines.join('\n')}\n`;
}
