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

/**
 * Keeps only the files the run changed and writes their manifest. Null, with
 * the run folder removed, when the run changed nothing.
 */
export function finishRunCapture(capture: RunCapture): RunManifest | null {
  const changed = capture.files.flatMap((file): RunFile[] => {
    let after: string | null;
    try {
      after = hashOf(file.path);
    } catch {
      after = UNREADABLE_AFTER;
    }
    if (after === file.beforeHash) {
      if (file.before) fs.rmSync(path.join(capture.dir, 'files', file.before), { force: true });
      return [];
    }
    return [
      {
        path: file.path,
        before: file.before,
        after,
        ...(file.mode !== undefined ? { mode: file.mode } : {}),
      },
    ];
  });
  if (changed.length === 0) {
    fs.rmSync(capture.dir, { recursive: true, force: true });
    return null;
  }
  const manifest: RunManifest = {
    version: RUN_MANIFEST_VERSION,
    runId: capture.runId,
    files: changed,
  };
  fs.writeFileSync(
    path.join(capture.dir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { mode: 0o600 }
  );
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
  run: () => Promise<T>
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
    throw new CapturedRunError(capture ? finishSafely(capture) : null, err);
  }
  return { result, runId: capture ? finishSafely(capture) : null };
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

function finishSafely(capture: RunCapture): string | null {
  try {
    return finishRunCapture(capture)?.runId ?? null;
  } catch {
    return null;
  }
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
