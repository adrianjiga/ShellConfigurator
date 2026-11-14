import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appendHistory,
  type HistoryRecord,
  historyFilePath,
  lastRunShells,
  recordRun,
  recordRunSafely,
  snapshotDir,
  snapshotPath,
  writeSnapshot,
} from '../../services/history.ts';
import { DEFAULT_STATE, type WizardState } from '../../types.ts';

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

function readLedger(): HistoryRecord[] {
  return fs
    .readFileSync(historyFilePath(), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as HistoryRecord);
}

describe('historyFilePath', () => {
  it('places history.jsonl inside the app state dir', () => {
    expect(historyFilePath()).toBe(path.join(tmpDir, 'shell-configurator', 'history.jsonl'));
  });
});

describe('appendHistory', () => {
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

  it('creates history.jsonl readable only by its owner', () => {
    appendHistory(record('apply', { command: 'apply --import-url https://u:tok@example.com/x' }));

    const mode = fs.statSync(historyFilePath()).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('is append-only: later runs follow earlier ones in file order', () => {
    appendHistory(record('apply', { command: 'apply --state one.json', exitCode: 0 }));
    appendHistory(record('apply', { command: 'apply --state two.json', exitCode: 1 }));

    expect(readLedger().map((r) => r.command)).toEqual([
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

    expect(readLedger()).toEqual([
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

  it('starts a new line after a record torn by a crash', () => {
    const file = historyFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{"version":1,"kind":"apply"', 'utf8');

    appendHistory(record('install', { exitCode: 0 }));

    const lines = fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1])).toMatchObject({ kind: 'install', exitCode: 0 });
  });
});

describe('recordRun', () => {
  const state: WizardState = { ...DEFAULT_STATE, selectedShells: ['zsh'] };

  it('snapshots the state and links the snapshot from the ledger record', () => {
    recordRun({
      kind: 'apply',
      state,
      command: 'apply --shells zsh',
      results: [{ id: 'starship', label: 'Install Starship', status: 'done' }],
      exitCode: 0,
    });

    const [run] = readLedger();
    expect(run.snapshotId).toBeDefined();
    expect(fs.existsSync(snapshotPath(run.snapshotId ?? ''))).toBe(true);
    expect(run).toMatchObject({ kind: 'apply', command: 'apply --shells zsh', exitCode: 0 });
  });

  it('records no snapshot when the run has no state', () => {
    recordRun({ kind: 'uninstall' });

    expect(readLedger()[0]?.snapshotId).toBeUndefined();
    expect(fs.existsSync(snapshotDir())).toBe(false);
  });
});

describe('snapshotDir / snapshotPath / writeSnapshot', () => {
  it('roots snapshots under the app state dir', () => {
    expect(snapshotDir()).toBe(path.join(tmpDir, 'shell-configurator', 'snapshots'));
  });

  it('writes the state card as a file returning its id', () => {
    const state: WizardState = {
      ...DEFAULT_STATE,
      preset: 'catppuccin-powerline',
      selectedShells: ['zsh'],
    };
    const id = writeSnapshot(state, '2026-01-02T03:04:05.000Z');

    expect(id).toBe('2026-01-02T03-04-05.000Z');
    expect(snapshotPath(id)).toBe(
      path.join(tmpDir, 'shell-configurator', 'snapshots', '2026-01-02T03-04-05.000Z.json')
    );
    const card = JSON.parse(fs.readFileSync(snapshotPath(id), 'utf8')) as {
      version: number;
      wizard: { preset: string; selectedShells: string[] };
    };
    expect(card.version).toBe(1);
    expect(card.wizard.preset).toBe('catppuccin-powerline');
    expect(card.wizard.selectedShells).toEqual(['zsh']);
  });

  it('is unique per timestamp and suffixes a same-millisecond run', () => {
    const first = writeSnapshot(DEFAULT_STATE, '2026-01-02T03:04:05.000Z');
    const second = writeSnapshot(DEFAULT_STATE, '2026-01-02T03:04:06.000Z');
    const sameMillisecond = writeSnapshot(DEFAULT_STATE, '2026-01-02T03:04:05.000Z');

    expect(first).not.toBe(second);
    expect(sameMillisecond).toBe(`${first}-2`);
    expect(fs.readdirSync(snapshotDir())).toHaveLength(3);
  });
});

describe('lastRunShells', () => {
  it('returns null when no run has been recorded', () => {
    expect(lastRunShells()).toBeNull();
  });

  it('reads the shells of the newest run that left a snapshot', () => {
    recordRun({ kind: 'install', state: { ...DEFAULT_STATE, selectedShells: ['zsh'] } });
    recordRun({ kind: 'apply', state: { ...DEFAULT_STATE, selectedShells: ['bash', 'fish'] } });
    appendHistory(record('apply'));

    expect(lastRunShells()).toEqual(['bash', 'fish']);
  });

  it('falls back past torn, non-object and snapshot-less lines to an earlier run', () => {
    recordRun({ kind: 'install', state: { ...DEFAULT_STATE, selectedShells: ['zsh'] } });
    appendHistory(record('apply', { snapshotId: 'deleted-snapshot' }));
    fs.appendFileSync(historyFilePath(), 'null\n42\n{"version":1,"snapsh');

    expect(lastRunShells()).toEqual(['zsh']);
  });
});

describe('appendHistory failures', () => {
  it.skipIf(process.getuid?.() === 0)('rethrows a read error that is not a missing file', () => {
    appendHistory(record('install'));
    const dir = path.dirname(historyFilePath());
    fs.chmodSync(dir, 0o000);
    try {
      expect(() => appendHistory(record('apply'))).toThrow(/EACCES/);
    } finally {
      fs.chmodSync(dir, 0o700);
    }
  });
});

describe('recordRunSafely', () => {
  it('turns a failed write into a warning instead of ending the run', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const failing = vi.fn(() => {
      throw new Error('disk full');
    });

    expect(() => recordRunSafely({ kind: 'apply' }, failing)).not.toThrow();
    expect(stderr).toHaveBeenCalledWith(
      'Warning: could not record this run in history: disk full\n'
    );
    stderr.mockRestore();
  });
});
