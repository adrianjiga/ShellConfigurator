import * as fs from 'node:fs';
import * as path from 'node:path';
import { statusLine } from '../config/status.ts';
import { writeFileAtomic } from '../generators/shellRc.ts';
import { errorMessage } from './errors.ts';
import { type HistoryKind, type HistoryRecord, readHistory } from './history.ts';
import { hashOf, type RunManifest, readRunManifest, runDir } from './runCapture.ts';

export interface RollbackRun {
  runId: string;
  timestamp: string;
  kind: HistoryKind;
  command?: string;
  files: number;
  /** A later rollback undid this run, and was not undone itself. */
  rolledBack: boolean;
}

/**
 * The recorded runs that changed files, newest first. A run counts as rolled
 * back while a complete rollback of it stands, i.e. that rollback was not
 * undone too.
 */
export function listRollbackRuns(records: HistoryRecord[] = readHistory()): RollbackRun[] {
  const captured = records.filter((r): r is HistoryRecord & { runId: string } => Boolean(r.runId));
  const undoers = new Map<string, string[]>();
  for (const r of captured) {
    if (r.kind === 'rollback' && r.rollbackOf && !r.partial) {
      undoers.set(r.rollbackOf, [...(undoers.get(r.rollbackOf) ?? []), r.runId]);
    }
  }
  const memo = new Map<string, boolean>();
  const isRolledBack = (runId: string, seen: Set<string> = new Set()): boolean => {
    const known = memo.get(runId);
    if (known !== undefined) return known;
    if (seen.has(runId)) return false;
    seen.add(runId);
    const result = (undoers.get(runId) ?? []).some((undo) => !isRolledBack(undo, seen));
    memo.set(runId, result);
    return result;
  };

  return captured
    .flatMap((r): RollbackRun[] => {
      const manifest = readRunManifest(r.runId);
      if (!manifest) return [];
      return [
        {
          runId: r.runId,
          timestamp: r.timestamp,
          kind: r.kind,
          ...(r.command ? { command: r.command } : {}),
          files: manifest.files.length,
          rolledBack: isRolledBack(r.runId),
        },
      ];
    })
    .reverse();
}

/** The run a plain `rollback` undoes: the newest change that still stands. */
export function defaultRollbackRun(runs: RollbackRun[]): RollbackRun | null {
  return runs.find((run) => run.kind !== 'rollback' && !run.rolledBack) ?? null;
}

export type RollbackStatus = 'restored' | 'removed' | 'skipped' | 'failed' | 'planned';

export interface RollbackStep {
  path: string;
  detail: string;
  /** Changes the file; a step without one is skipped. */
  run?: () => { status: 'restored' | 'removed' | 'skipped'; detail: string; left?: boolean };
  /** The run's change stays in place. */
  left?: boolean;
}

export interface RollbackAction {
  path: string;
  status: RollbackStatus;
  detail: string;
  /** The run's change to this file is still in place. */
  left?: boolean;
}

export interface RollbackReport {
  runId: string;
  actions: RollbackAction[];
  ok: boolean;
  /** Every change of the run was undone. */
  complete: boolean;
  dryRun: boolean;
}

const CHANGED_SINCE = 'changed since that run, so it is left as it is';

/**
 * One step per file the run changed. A file that changed again since is left
 * alone, so a rollback never overwrites later edits; roll back the later run
 * first. A file already back to its earlier content needs nothing.
 */
export function planRollback(manifest: RunManifest): RollbackStep[] {
  return manifest.files.map((file) => {
    const unchanged = () => hashOf(file.path) === file.after;
    let current: string | null;
    try {
      current = hashOf(file.path);
    } catch (err) {
      return { path: file.path, detail: `cannot be read: ${errorMessage(err)}` };
    }
    if (current !== file.after) {
      const copy = file.before ? path.join(runDir(manifest.runId), 'files', file.before) : null;
      if (current === (copy ? hashOf(copy) : null)) {
        return { path: file.path, detail: 'already as it was before that run' };
      }
      return { path: file.path, detail: CHANGED_SINCE, left: true };
    }
    if (file.before === null) {
      return {
        path: file.path,
        detail: 'delete it: that run created it',
        run: () => {
          if (!unchanged()) return { status: 'skipped', detail: CHANGED_SINCE, left: true };
          fs.rmSync(file.path, { force: true });
          return { status: 'removed', detail: 'deleted it: that run created it' };
        },
      };
    }
    const copy = path.join(runDir(manifest.runId), 'files', file.before);
    return {
      path: file.path,
      detail: 'put back its content from before that run',
      run: () => {
        if (!unchanged()) return { status: 'skipped', detail: CHANGED_SINCE, left: true };
        const content = fs.readFileSync(copy);
        fs.mkdirSync(path.dirname(file.path), { recursive: true });
        writeFileAtomic(file.path, content);
        if (file.mode !== undefined) fs.chmodSync(file.path, file.mode);
        return { status: 'restored', detail: 'put back its content from before that run' };
      },
    };
  });
}

/** Runs every step; a failed file does not stop the rest. With `dryRun` nothing runs. */
export function runRollback(
  runId: string,
  steps: RollbackStep[],
  options: { dryRun?: boolean } = {}
): RollbackReport {
  const actions = steps.map(({ path: file, detail, run, left }): RollbackAction => {
    if (!run) return { path: file, status: 'skipped', detail, ...(left ? { left } : {}) };
    if (options.dryRun) return { path: file, status: 'planned', detail };
    try {
      return { path: file, ...run() };
    } catch (err) {
      return { path: file, status: 'failed', detail: errorMessage(err), left: true };
    }
  });
  return {
    runId,
    actions,
    ok: actions.every((a) => a.status !== 'failed'),
    complete: actions.every((a) => !a.left),
    dryRun: options.dryRun ?? false,
  };
}

export function formatRollbackReport(report: RollbackReport): string {
  const lines = [
    report.dryRun
      ? `Rollback of ${report.runId} (dry run — nothing was changed)`
      : `Rollback of ${report.runId}`,
    '',
  ];
  for (const action of report.actions) {
    lines.push(statusLine(action.status, `${action.path} — ${action.detail}`));
  }
  if (!report.dryRun && !report.complete) {
    lines.push('', 'Some of its changes are still in place, so it stays next to roll back.');
  }
  return `${lines.join('\n')}\n`;
}

/** The `rollback --list` table, newest first. */
export function formatRollbackRuns(runs: RollbackRun[]): string {
  if (runs.length === 0) return 'No recorded run changed any files.\n';
  const target = defaultRollbackRun(runs);
  const lines = runs.map((run) => {
    const marks = [
      ...(run === target ? ['next to roll back'] : []),
      ...(run.rolledBack ? ['rolled back'] : []),
    ];
    const files = `${run.files} file${run.files === 1 ? '' : 's'}`;
    const extra = [run.command, ...marks].filter(Boolean).join('; ');
    return `${run.runId}  ${run.kind.padEnd(9)} ${files}${extra ? ` (${extra})` : ''}`;
  });
  return `${lines.join('\n')}\n`;
}
