import * as fs from 'node:fs';
import * as path from 'node:path';
import { SHELLS } from '../config/shells.ts';
import {
  bashLoginFiles,
  getSharedConfigPath,
  getShellConfigPath,
  originalCopyPath,
  writeFileAtomic,
} from '../generators/shellRc.ts';
import type { WizardState } from '../types.ts';
import { sha256Digest } from './cache.ts';
import { errorMessage, isMissingFile } from './errors.ts';
import { type HistoryKind, recordRun } from './history.ts';
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

/**
 * Every file a wizard run, apply or uninstall may change, and the
 * `.pre-shell-configurator` copy each may get, so rolling back the run that
 * made a copy removes it again.
 */
export function trackedFiles(): string[] {
  const files = [
    ...SHELLS.flatMap((shell) => (shell.rcFile ? [shell.rcFile] : [])),
    ...bashLoginFiles(),
    ...SHELLS.map((shell) => getShellConfigPath(shell.id)),
    getSharedConfigPath(),
    ...terminalFontConfigFiles(),
  ];
  return [...files, ...files.map(originalCopyPath)];
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

export interface InterruptedRecord {
  kind: HistoryKind;
  command?: string;
  rollbackOf?: string;
  state?: WizardState;
}

interface PendingCapture {
  version: typeof RUN_MANIFEST_VERSION;
  pid: number;
  startedAt?: number;
  files: CapturedFile[];
  record?: InterruptedRecord;
  rewritable?: string[];
}

const PENDING = 'pending.json';

const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const activeCaptures = new Set<string>();

function writeJsonAtomic(file: string, value: unknown): void {
  writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`, 0o600);
}

/**
 * Copies each file into a new run folder before a run changes anything. A
 * file that cannot be read (a folder, no permission) is left out, since it
 * could not be put back.
 */
export function beginRunCapture(
  files: string[],
  record?: InterruptedRecord,
  rewritable: readonly string[] = []
): RunCapture {
  const runId = createRunFolder();
  const dir = runDir(runId);
  try {
    fs.mkdirSync(path.join(dir, 'files'), { mode: 0o700 });
    const capture = { runId, dir, files: copyFiles(files, dir) };
    const pending: PendingCapture = {
      version: RUN_MANIFEST_VERSION,
      pid: process.pid,
      startedAt: Date.now(),
      files: capture.files,
      ...(record ? { record } : {}),
      ...(rewritable.length > 0 ? { rewritable: [...rewritable] } : {}),
    };
    writeJsonAtomic(path.join(dir, PENDING), pending);
    activeCaptures.add(runId);
    return capture;
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
  record?: InterruptedRecord;
  recovered?: boolean;
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
  activeCaptures.delete(capture.runId);
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
  writeJsonAtomic(path.join(capture.dir, 'manifest.json'), manifest);
  fs.rmSync(path.join(capture.dir, PENDING), { force: true });
  return manifest;
}

type IsAlive = (pid: number, runId: string) => boolean;

function processAlive(pid: number, runId: string): boolean {
  if (pid === process.pid) return activeCaptures.has(runId);
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

interface DeadRun {
  runId: string;
  dir: string;
  pendingFile: string;
  pending: PendingCapture;
}

const CLAIM = /^pending\.json\.(\d+)$/;

function pendingFiles(dir: string, runId: string, isAlive: IsAlive): string[] {
  const claims = fs.readdirSync(dir).flatMap((name) => {
    const pid = CLAIM.exec(name)?.[1];
    return pid && !isAlive(Number(pid), runId) ? [path.join(dir, name)] : [];
  });
  return [path.join(dir, PENDING), ...claims];
}

function deadRuns(isAlive: IsAlive): DeadRun[] {
  let runs: string[];
  try {
    runs = fs.readdirSync(runsDir()).sort();
  } catch {
    return [];
  }
  return runs.flatMap((runId) => {
    const dir = runDir(runId);
    let files: string[];
    try {
      files = pendingFiles(dir, runId, isAlive);
    } catch {
      return [];
    }
    for (const pendingFile of files) {
      try {
        const pending = JSON.parse(fs.readFileSync(pendingFile, 'utf8')) as PendingCapture;
        if (pending.version !== RUN_MANIFEST_VERSION || !Array.isArray(pending.files)) return [];
        const stale = Date.now() - (pending.startedAt ?? Date.now()) > PENDING_MAX_AGE_MS;
        return !stale && isAlive(pending.pid, runId) ? [] : [{ runId, dir, pendingFile, pending }];
      } catch {}
    }
    return [];
  });
}

export function interruptedRunCount(isAlive: IsAlive = processAlive): number {
  return deadRuns(isAlive).length;
}

export function recoverInterruptedRuns(isAlive: IsAlive = processAlive): string[] {
  return deadRuns(isAlive).flatMap(({ runId, dir, pendingFile, pending }) => {
    const claim = path.join(dir, `${PENDING}.${process.pid}`);
    try {
      fs.renameSync(pendingFile, claim);
    } catch {
      return [];
    }
    try {
      const manifest = finishRunCapture(
        { runId, dir, files: pending.files },
        { rewritable: pending.rewritable ?? [] }
      );
      fs.rmSync(claim, { force: true });
      if (!manifest) return [];
      const record = pending.record ?? { kind: 'apply' as const };
      recordRun({
        ...record,
        runId,
        interrupted: true,
        ...(record.kind === 'rollback' ? { partial: true } : {}),
      });
      return [runId];
    } catch {
      try {
        fs.renameSync(claim, path.join(dir, PENDING));
      } catch {}
      return [];
    }
  });
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
  if (!options.recovered) recoverInterruptedRuns();
  let capture: RunCapture | null;
  try {
    capture = beginRunCapture(files, options.record, options.rewritable);
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
  let runId: string | null;
  try {
    runId = finishRunCapture(capture, options, error)?.runId ?? null;
  } catch {
    try {
      fs.rmSync(capture.dir, { recursive: true, force: true });
    } catch {}
    return null;
  }
  try {
    pruneRuns();
  } catch {}
  return runId;
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
