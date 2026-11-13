import * as fs from 'node:fs';
import * as path from 'node:path';
import { writeFileAtomic } from '../generators/shellRc.ts';
import type { InstallTask, WizardState } from '../types.ts';
import { stateDir } from './paths.ts';
import { serializeState } from './state.ts';

/**
 * What a recorded run did. `install` is the interactive wizard; `apply` is a
 * headless run; the rest are day-2 lifecycle commands.
 */
export type HistoryKind = 'install' | 'apply' | 'uninstall' | 'rollback';

/**
 * One entry in history.jsonl: a single JSON object per line. The version field
 * drives future migrations; fields are additive so old records stay readable.
 */
export interface HistoryRecord {
  /** Schema version of this record. */
  version: 1;
  /** When the run started, ISO 8601. */
  timestamp: string;
  kind: HistoryKind;
  /** Snapshot id of the state this run applied; the #14 rollback handle. */
  snapshotId?: string;
  /** Outcome of each install task, for the installer lines of `--list-runs`. */
  results?: InstallTask[];
  /** Process exit code; omitted when the run was interrupted before finishing. */
  exitCode?: number;
  /** The headless invocation (e.g. `apply --state saved.json`), for reproduction. */
  command?: string;
}

/** The append-only ledger path: <stateDir>/history.jsonl. */
export function historyFilePath(): string {
  return path.join(stateDir(), 'history.jsonl');
}

export interface RecordRunOptions {
  kind: HistoryKind;
  /** Snapshot the applied state as the rollback handle. */
  state?: WizardState;
  results?: InstallTask[];
  command?: string;
  exitCode?: number;
}

/**
 * Snapshots the run's state and appends it to the ledger. Throws on I/O failure;
 * callers decide whether that is fatal.
 */
export function recordRun(options: RecordRunOptions): void {
  const timestamp = new Date().toISOString();
  const snapshotId = options.state ? writeSnapshot(options.state, timestamp) : undefined;
  appendHistory({
    version: 1,
    timestamp,
    kind: options.kind,
    ...(snapshotId ? { snapshotId } : {}),
    ...(options.results ? { results: options.results } : {}),
    ...(options.command ? { command: options.command } : {}),
    ...(options.exitCode !== undefined ? { exitCode: options.exitCode } : {}),
  });
}

/**
 * Records one run by appending a single JSON line. Append-only because a run is
 * immutable history; ordering falls out of file order. Throws on I/O failure;
 * callers decide whether that is fatal.
 */
export function appendHistory(record: HistoryRecord): void {
  const file = historyFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  ensureTrailingNewline(file);
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
}

/**
 * A record torn by a crash mid-append leaves no trailing newline; appending
 * straight after it would glue the next run onto the broken line and lose both.
 */
function ensureTrailingNewline(file: string): void {
  let size: number;
  try {
    size = fs.statSync(file).size;
  } catch (err) {
    if (isMissingFile(err)) return;
    throw err;
  }
  if (size === 0) return;

  const fd = fs.openSync(file, 'r');
  try {
    const last = Buffer.alloc(1);
    fs.readSync(fd, last, 0, 1, size - 1);
    if (last[0] !== 0x0a) fs.appendFileSync(file, '\n');
  } finally {
    fs.closeSync(fd);
  }
}

/** True when the failure is simply that the file does not exist yet. */
function isMissingFile(err: unknown): boolean {
  return (err as { code?: string }).code === 'ENOENT';
}

/**
 * The per-run snapshot store: <stateDir>/snapshots/. Each snapshot is the
 * versioned state card the run applied, resolved later by `snapshotId` during
 * `uninstall`/`--rollback` (#14).
 */
export function snapshotDir(): string {
  return path.join(stateDir(), 'snapshots');
}

/** The absolute path of a snapshot card on disk. */
export function snapshotPath(snapshotId: string): string {
  return path.join(snapshotDir(), `${snapshotId}.json`);
}

/**
 * Snapshot the user choices of a run as a versioned card file and return its id.
 * The id is a slugged ISO timestamp — printable and sortable — with a suffix
 * added when a second run lands in the same millisecond. Best-effort callers
 * let a failure become a warning.
 */
export function writeSnapshot(state: WizardState, timestamp?: string): string {
  const base = (timestamp ?? new Date().toISOString()).replaceAll(':', '-');
  fs.mkdirSync(snapshotDir(), { recursive: true });
  let id = base;
  for (let n = 2; fs.existsSync(snapshotPath(id)); n++) id = `${base}-${n}`;
  writeFileAtomic(snapshotPath(id), serializeState(state));
  return id;
}
