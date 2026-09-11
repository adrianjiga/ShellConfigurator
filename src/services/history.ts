import * as fs from 'node:fs';
import * as path from 'node:path';
import type { InstallTask, WizardState } from '../types.ts';
import { stateDir } from './paths.ts';
import { serializeState } from './state.ts';

/**
 * What a recorded run did. `install` is the interactive wizard; the others are
 * headless or day-2 lifecycle commands.
 */
export type HistoryKind = 'install' | 'apply' | 'generate' | 'uninstall' | 'rollback';

/**
 * One entry in history.jsonl: a single JSON object per line. The version field
 * drives future migrations in readHistory; fields are additive so old records
 * stay readable.
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

/**
 * Records one run by appending a single JSON line. Append-only because a run is
 * immutable history; ordering — and therefore `--list-runs` — falls out of file
 * order. Throws on I/O failure; callers decide whether that is fatal.
 */
export function appendHistory(record: HistoryRecord): void {
  const file = historyFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8');
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
 * The id is a slugged ISO timestamp — printable, sortable, and unique at the
 * frequency runs happen. Best-effort callers let a failure become a warning.
 */
export function writeSnapshot(state: WizardState, timestamp?: string): string {
  const id = (timestamp ?? new Date().toISOString()).replaceAll(':', '-');
  fs.mkdirSync(snapshotDir(), { recursive: true });
  fs.writeFileSync(snapshotPath(id), serializeState(state), 'utf8');
  return id;
}

/**
 * Reads every recorded run in file (chronological) order. A missing history is
 * "no runs yet", and a torn trailing line from a crash mid-append is skipped
 * rather than failing the whole read.
 */
export function readHistory(): HistoryRecord[] {
  const file = historyFilePath();
  let content: string;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (isMissingFile(err)) return [];
    throw err;
  }

  const records: HistoryRecord[] = [];
  for (const line of content.split('\n')) {
    if (line.trim() === '') continue;
    try {
      records.push(JSON.parse(line) as HistoryRecord);
    } catch {
      // Unparseable line: likely a torn append; skip it and keep the rest.
    }
  }
  return records;
}
