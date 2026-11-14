import * as fs from 'node:fs';
import * as path from 'node:path';
import { SHELLS } from '../config/shells.ts';
import { getSharedConfigPath, getShellConfigPath } from '../generators/shellRc.ts';
import { sha256Digest } from './cache.ts';
import { errorMessage, isMissingFile } from './errors.ts';
import { stateDir } from './paths.ts';
import { terminalFontConfigFiles } from './terminalFont.ts';

export const RUN_MANIFEST_VERSION = 1;

/** The `after` of a file the run left unreadable, which no hash can match. */
export const UNREADABLE_AFTER = 'unreadable';

/** One file a run changed: where its earlier content is kept, and its hash after the run. */
export interface RunFile {
  path: string;
  /** The copy's name inside the run folder, or null when the file did not exist before. */
  before: string | null;
  /** SHA-256 of the file after the run, null when the run removed it, or UNREADABLE_AFTER. */
  after: string | null;
  /** The file's permission bits before the run; absent when it did not exist. */
  mode?: number;
  /** Later runs rewrite this file; rollback leaves a later run's rewrite in place. */
  rewritable?: true;
}

export interface RunManifest {
  version: typeof RUN_MANIFEST_VERSION;
  runId: string;
  files: RunFile[];
}

interface CapturedFile {
  path: string;
  before: string | null;
  beforeHash: string | null;
  mode?: number;
}

export interface RunCapture {
  runId: string;
  dir: string;
  files: CapturedFile[];
}

/** <stateDir>/runs: one folder per captured run. */
export function runsDir(): string {
  return path.join(stateDir(), 'runs');
}

export function runDir(runId: string): string {
  return path.join(runsDir(), runId);
}

/** Every file a wizard run, apply or uninstall may change. */
export function trackedFiles(): string[] {
  return [
    ...SHELLS.flatMap((shell) => (shell.rcFile ? [shell.rcFile] : [])),
    ...SHELLS.map((shell) => getShellConfigPath(shell.id)),
    getSharedConfigPath(),
    ...terminalFontConfigFiles(),
  ];
}

/** The file's bytes, null when it does not exist; other read errors propagate. */
function readOrNull(file: string): Buffer | null {
  try {
    return fs.readFileSync(file);
  } catch (err) {
    if (isMissingFile(err)) return null;
    throw err;
  }
}

/** SHA-256 of the file, or null when it does not exist. */
export function hashOf(file: string): string | null {
  const content = readOrNull(file);
  return content === null ? null : sha256Digest(content);
}

/** Creates a new, unused run folder and returns its id. */
function createRunFolder(): string {
  fs.mkdirSync(runsDir(), { recursive: true, mode: 0o700 });
  const base = new Date().toISOString().replaceAll(':', '-');
  for (let n = 1; ; n++) {
    const runId = n === 1 ? base : `${base}-${n}`;
    try {
      fs.mkdirSync(runDir(runId), { mode: 0o700 });
      return runId;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
}

/**
 * Copies each file into a new run folder before a run changes anything. A
 * file that cannot be read (a folder, no permission) is left out, since it
 * could not be put back.
 */
export function beginRunCapture(files: string[]): RunCapture {
  const runId = createRunFolder();
  const dir = runDir(runId);
  try {
    fs.mkdirSync(path.join(dir, 'files'), { mode: 0o700 });
    return { runId, dir, files: copyFiles(files, dir) };
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw err;
  }
}

function copyFiles(files: string[], dir: string): CapturedFile[] {
  return [...new Set(files)].flatMap((file, index): CapturedFile[] => {
    let content: Buffer | null;
    try {
      content = readOrNull(file);
    } catch {
      return [];
    }
    if (content === null) return [{ path: file, before: null, beforeHash: null }];
    const copy = String(index);
    fs.writeFileSync(path.join(dir, 'files', copy), content, { mode: 0o600 });
    const mode = fs.statSync(file).mode & 0o7777;
    return [{ path: file, before: copy, beforeHash: sha256Digest(content), mode }];
  });
}

export interface CaptureOptions {
  /**
   * Runs once the run is over, when it changed files and before its manifest
   * is written, so whatever it writes to a captured file is part of the run.
   * `error` is what the run threw, if it did. Its own errors are ignored.
   */
  onChanged?: (runId: string, files: RunFile[], error?: unknown) => void;
  /** Captured files that later runs rewrite (see RunFile.rewritable). */
  rewritable?: readonly string[];
}

function changedFiles(capture: RunCapture, rewritable: readonly string[]): RunFile[] {
  return capture.files.flatMap((file): RunFile[] => {
    let after: string | null;
    try {
      after = hashOf(file.path);
    } catch {
      after = UNREADABLE_AFTER;
    }
    if (after === file.beforeHash) return [];
    return [
      {
        path: file.path,
        before: file.before,
        after,
        ...(file.mode !== undefined ? { mode: file.mode } : {}),
        ...(rewritable.includes(file.path) ? { rewritable: true as const } : {}),
      },
    ];
  });
}

/**
 * Keeps only the files the run changed and writes their manifest. Null, with
 * the run folder removed, when the run changed nothing.
 */
export function finishRunCapture(
  capture: RunCapture,
  options: CaptureOptions = {},
  error?: unknown
): RunManifest | null {
  const rewritable = options.rewritable ?? [];
  let changed = changedFiles(capture, rewritable);
  if (changed.length === 0) {
    fs.rmSync(capture.dir, { recursive: true, force: true });
    return null;
  }
  if (options.onChanged) {
    try {
      options.onChanged(capture.runId, changed, error);
    } catch {}
    changed = changedFiles(capture, rewritable);
  }
  const kept = new Set(changed.map((file) => file.before));
  for (const file of capture.files) {
    if (file.before && !kept.has(file.before)) {
      fs.rmSync(path.join(capture.dir, 'files', file.before), { force: true });
    }
  }
  const manifest: RunManifest = {
    version: RUN_MANIFEST_VERSION,
    runId: capture.runId,
    files: changed,
  };
  const file = path.join(capture.dir, 'manifest.json');
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
  return manifest;
}

/**
 * Runs `run` between a capture and its manifest. Capturing is best-effort: a
 * capture that cannot be written never stops the run, it only leaves nothing
 * to roll back. `runId` is null then, and when the run changed no file. A
 * throwing run rejects with a CapturedRunError carrying its runId.
 */
export async function captureRun<T>(
  files: string[],
  run: () => Promise<T>,
  options: CaptureOptions = {}
): Promise<{ result: T; runId: string | null }> {
  let capture: RunCapture | null;
  try {
    capture = beginRunCapture(files);
  } catch {
    capture = null;
  }
  let result: T;
  try {
    result = await run();
  } catch (err) {
    throw new CapturedRunError(capture ? finishSafely(capture, options, err) : null, err);
  }
  return { result, runId: capture ? finishSafely(capture, options) : null };
}

/** A run that threw partway; `runId` still names the files it had changed by then. */
export class CapturedRunError extends Error {
  constructor(
    readonly runId: string | null,
    cause: unknown
  ) {
    super(errorMessage(cause), { cause });
    this.name = 'CapturedRunError';
  }
}

function finishSafely(
  capture: RunCapture,
  options: CaptureOptions,
  error?: unknown
): string | null {
  try {
    const runId = finishRunCapture(capture, options, error)?.runId ?? null;
    pruneRuns();
    return runId;
  } catch {
    return null;
  }
}

/** How many captured runs rollback keeps; older ones are deleted. */
export const KEPT_RUNS = 50;

/** Deletes all but the newest `keep` run folders. */
export function pruneRuns(keep: number = KEPT_RUNS): void {
  const runs = fs
    .readdirSync(runsDir(), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const runId of runs.slice(0, Math.max(0, runs.length - keep))) {
    fs.rmSync(runDir(runId), { recursive: true, force: true });
  }
}

/**
 * What the runs captured after `runId` left in `file`: the hashes they wrote,
 * and null for a run that removed it.
 */
export function laterRunWrites(runId: string, file: string): Set<string | null> {
  const writes = new Set<string | null>();
  let runs: string[];
  try {
    runs = fs.readdirSync(runsDir());
  } catch {
    return writes;
  }
  for (const later of runs.filter((name) => name > runId)) {
    for (const entry of readRunManifest(later)?.files ?? []) {
      if (entry.path === file) writes.add(entry.after);
    }
  }
  return writes;
}

/** The manifest of a captured run, or null when it is missing or unreadable. */
export function readRunManifest(runId: string): RunManifest | null {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(runDir(runId), 'manifest.json'), 'utf8')
    ) as RunManifest;
    return parsed.version === RUN_MANIFEST_VERSION && Array.isArray(parsed.files) ? parsed : null;
  } catch {
    return null;
  }
}
