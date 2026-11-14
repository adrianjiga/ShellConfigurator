import { getShell } from '../config/shells.ts';
import {
  appliedRcContent,
  FS_RC_IO,
  getSharedConfigPath,
  getShellConfigPath,
  type RcIo,
  resetRcContent,
} from '../generators/shellRc.ts';
import { generateToml } from '../generators/starship.ts';
import type { ShellId, WizardState } from '../types.ts';
import { errorMessage } from './errors.ts';

type Op = { kind: ' ' | '-' | '+'; line: string };

const CONTEXT = 3;
const MAX_LCS_CELLS = 4_000_000;

const NO_NEWLINE = '\u0000';

function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  else lines[lines.length - 1] += NO_NEWLINE;
  return lines;
}

function opLines(op: Op): string[] {
  return op.line.endsWith(NO_NEWLINE)
    ? [`${op.kind}${op.line.slice(0, -1)}`, '\\ No newline at end of file']
    : [`${op.kind}${op.line}`];
}

function lineOps(before: string[], after: string[]): Op[] {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let endB = before.length;
  let endA = after.length;
  while (endB > start && endA > start && before[endB - 1] === after[endA - 1]) {
    endB--;
    endA--;
  }
  const a = before.slice(start, endB);
  const b = after.slice(start, endA);
  const middle: Op[] = [];
  if ((a.length + 1) * (b.length + 1) > MAX_LCS_CELLS) {
    middle.push(...a.map((line) => ({ kind: '-' as const, line })));
    middle.push(...b.map((line) => ({ kind: '+' as const, line })));
  } else {
    const width = b.length + 1;
    const lcs = new Uint32Array((a.length + 1) * width);
    for (let i = a.length - 1; i >= 0; i--) {
      for (let j = b.length - 1; j >= 0; j--) {
        lcs[i * width + j] =
          a[i] === b[j]
            ? lcs[(i + 1) * width + j + 1] + 1
            : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) {
        middle.push({ kind: ' ', line: a[i++] });
        j++;
      } else if (
        i < a.length &&
        (j === b.length || lcs[(i + 1) * width + j] >= lcs[i * width + j + 1])
      ) {
        middle.push({ kind: '-', line: a[i++] });
      } else {
        middle.push({ kind: '+', line: b[j++] });
      }
    }
  }
  return [
    ...before.slice(0, start).map((line) => ({ kind: ' ' as const, line })),
    ...middle,
    ...before.slice(endB).map((line) => ({ kind: ' ' as const, line })),
  ];
}

function hunkRange(start: number, length: number): string {
  return `${length === 0 ? start : start + 1},${length}`;
}

interface Diff {
  text: string;
  added: number;
  removed: number;
}

function diff(before: string | null, after: string, file: string): Diff {
  const ops = lineOps(splitLines(before ?? ''), splitLines(after));
  const changed = ops.flatMap((op, index) => (op.kind === ' ' ? [] : [index]));
  const added = ops.filter((op) => op.kind === '+').length;
  const removed = ops.filter((op) => op.kind === '-').length;
  if (changed.length === 0) return { text: '', added, removed };

  const out = [before === null ? '--- /dev/null' : `--- ${file}`, `+++ ${file}`];
  let next = 0;
  while (next < changed.length) {
    const first = Math.max(0, changed[next] - CONTEXT);
    let last = changed[next];
    while (next + 1 < changed.length && changed[next + 1] - last <= CONTEXT * 2 + 1) {
      last = changed[++next];
    }
    next++;
    const end = Math.min(ops.length, last + CONTEXT + 1);
    const hunk = ops.slice(first, end);
    const oldStart = ops.slice(0, first).filter((op) => op.kind !== '+').length;
    const newStart = ops.slice(0, first).filter((op) => op.kind !== '-').length;
    const oldLength = hunk.filter((op) => op.kind !== '+').length;
    const newLength = hunk.filter((op) => op.kind !== '-').length;
    out.push(`@@ -${hunkRange(oldStart, oldLength)} +${hunkRange(newStart, newLength)} @@`);
    out.push(...hunk.flatMap(opLines));
  }
  return { text: `${out.join('\n')}\n`, added, removed };
}

/**
 * A `git diff`-style unified diff from `before` (null when the file does not
 * exist) to `after`, labelled with `file`. Empty when nothing changes.
 */
export function unifiedDiff(before: string | null, after: string, file: string): string {
  return diff(before, after, file).text;
}

export function diffHunkLines(unified: string): string[] {
  return unified.trimEnd().split('\n').slice(2);
}

export type FileChange =
  | { path: string; status: 'create' | 'modify'; added: number; removed: number; diff: string }
  | { path: string; status: 'unreadable'; error: string };

function change(filePath: string, next: (existing: string) => string, io: RcIo): FileChange | null {
  let before: string | null;
  try {
    before = io.exists(filePath) ? io.readFile(filePath) : null;
  } catch (err) {
    return { path: filePath, status: 'unreadable', error: errorMessage(err) };
  }
  const after = next(before ?? '');
  if (before !== null && after === before) return null;
  const { text, added, removed } = diff(before, after, filePath);
  return {
    path: filePath,
    status: before === null ? 'create' : 'modify',
    added,
    removed,
    diff: text,
  };
}

/**
 * The config and rc files a run with `state` would write, diffed against what
 * is on disk now, using the same planners as the real writers. `pathDir` is the
 * directory the rc lines would add to PATH. Files that would stay as they are
 * are left out. Backups, WHAT-CHANGED.md, fonts, the Starship binary and
 * terminal configs are not covered.
 */
export function plannedFileChanges(
  state: WizardState,
  resetShells: readonly ShellId[],
  pathDir: string | null,
  io: RcIo = FS_RC_IO
): FileChange[] {
  const changes: (FileChange | null)[] = [];

  if (state.keepExistingConfig) {
    const imported = state.sharedConfigToml;
    if (imported != null) changes.push(change(getSharedConfigPath(), () => imported, io));
  } else if (state.selectedShells.length > 0) {
    const toml = generateToml(state);
    for (const shellId of state.selectedShells) {
      changes.push(change(getShellConfigPath(shellId), () => toml, io));
    }
  }

  if (!state.skipStarshipInstall) {
    const options = { ensurePathDir: pathDir, pointAtSharedConfig: state.keepExistingConfig };
    for (const shellId of state.selectedShells) {
      const rcFile = getShell(shellId)?.rcFile;
      if (!rcFile) continue;
      changes.push(
        change(rcFile, (existing) => appliedRcContent(shellId, existing, options, io)!.content, io)
      );
    }
    for (const shellId of resetShells) {
      const rcFile = getShell(shellId)?.rcFile;
      if (!rcFile) continue;
      changes.push(
        change(rcFile, (existing) => resetRcContent(shellId, existing, io)!.content, io)
      );
    }
  }

  return changes.filter((entry): entry is FileChange => entry !== null);
}
