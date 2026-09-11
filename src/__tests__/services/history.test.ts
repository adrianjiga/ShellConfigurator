import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendHistory,
  type HistoryRecord,
  historyFilePath,
  readHistory,
} from '../../services/history.ts';

let tmpDir: string;
const savedEnv = { ...process.env };

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shellconf-history-'));
  process.env.XDG_STATE_HOME = tmpDir;
});
afterEach(() => {
  process.env = { ...savedEnv };
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function record(
  kind: HistoryRecord['kind'],
  overrides: Partial<HistoryRecord> = {}
): HistoryRecord {
  return { version: 1, timestamp: '2026-01-02T03:04:05.000Z', kind, ...overrides };
}

describe('historyFilePath', () => {
  it('places history.jsonl inside the app state dir', () => {
    expect(historyFilePath()).toBe(path.join(tmpDir, 'shell-configurator', 'history.jsonl'));
  });
});

describe('appendHistory / readHistory', () => {
  it('creates the state dir and appends a single JSON line', () => {
    appendHistory(record('install'));

    expect(fs.existsSync(path.join(tmpDir, 'shell-configurator', 'history.jsonl'))).toBe(true);
    const lines = fs
      .readFileSync(historyFilePath(), 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ version: 1, kind: 'install' });
  });

  it('is append-only: later runs follow earlier ones in file order', () => {
    appendHistory(record('apply', { command: 'apply --state one.json', exitCode: 0 }));
    appendHistory(record('apply', { command: 'apply --state two.json', exitCode: 1 }));

    const runs = readHistory();
    expect(runs.map((r) => r.command)).toEqual([
      'apply --state one.json',
      'apply --state two.json',
    ]);
  });

  it('round-trips every optional field', () => {
    appendHistory(
      record('install', {
        command: 'shell-configurator',
        snapshotId: 'snap-abc123',
        exitCode: 0,
        results: [
          { id: 'starship', label: 'Install Starship', status: 'done' },
          { id: 'config', label: 'Write config', status: 'failed', error: 'boom' },
        ],
      })
    );

    expect(readHistory()).toEqual([
      record('install', {
        command: 'shell-configurator',
        snapshotId: 'snap-abc123',
        exitCode: 0,
        results: [
          { id: 'starship', label: 'Install Starship', status: 'done' },
          { id: 'config', label: 'Write config', status: 'failed', error: 'boom' },
        ],
      }),
    ]);
  });

  it('returns an empty list when no history exists yet', () => {
    expect(readHistory()).toEqual([]);
  });

  it('skips blank and torn lines instead of failing the read', () => {
    const file = historyFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const good = JSON.stringify(record('apply', { exitCode: 0 }));
    fs.writeFileSync(file, `${good}\n\n{"version":1,"kind":"install","timestamp":"torn\n`, 'utf8');

    expect(readHistory()).toEqual([record('apply', { exitCode: 0 })]);
  });
});
