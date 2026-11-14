import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoryRecord } from '../../services/history.ts';
import {
  defaultRollbackRun,
  formatRollbackReport,
  formatRollbackRuns,
  listRollbackRuns,
  planRollback,
  runRollback,
} from '../../services/rollback.ts';
import {
  captureRun,
  type RunManifest,
  readRunManifest,
  runDir,
} from '../../services/runCapture.ts';

vi.unmock('../../services/runCapture.ts');

let tmpDir: string;
const savedEnv = { ...process.env };

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shellconf-rollback-'));
  process.env.XDG_STATE_HOME = path.join(tmpDir, 'state');
});
afterEach(() => {
  process.env = { ...savedEnv };
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const file = (name: string) => path.join(tmpDir, name);
const read = (name: string) => fs.readFileSync(file(name), 'utf8');

/** Captures a run that applies `change` to the named files; returns its manifest. */
async function capturedRun(names: string[], change: () => void): Promise<RunManifest> {
  const { runId } = await captureRun(names.map(file), async () => change());
  return readRunManifest(runId!)!;
}

describe('planRollback / runRollback', () => {
  it('puts back edited files and deletes the ones the run created', async () => {
    fs.writeFileSync(file('rc'), 'mine\n');
    const manifest = await capturedRun(['rc', 'config'], () => {
      fs.appendFileSync(file('rc'), '# Added by ShellConfigurator\n');
      fs.writeFileSync(file('config'), 'format = "$all"\n');
    });

    const report = runRollback(manifest.runId, planRollback(manifest));

    expect(report.ok).toBe(true);
    expect(report.actions).toEqual([
      { path: file('rc'), status: 'restored', detail: 'put back its content from before that run' },
      { path: file('config'), status: 'removed', detail: 'deleted it: that run created it' },
    ]);
    expect(read('rc')).toBe('mine\n');
    expect(fs.existsSync(file('config'))).toBe(false);
  });

  it('brings back a file the run removed, folder and all', async () => {
    fs.mkdirSync(file('starship'));
    fs.writeFileSync(file('starship/zsh.toml'), 'old');
    const manifest = await capturedRun(['starship/zsh.toml'], () =>
      fs.rmSync(file('starship'), { recursive: true })
    );

    runRollback(manifest.runId, planRollback(manifest));

    expect(read('starship/zsh.toml')).toBe('old');
  });

  it('leaves a file that changed again since the run alone', async () => {
    fs.writeFileSync(file('rc'), 'one');
    const manifest = await capturedRun(['rc'], () => fs.writeFileSync(file('rc'), 'two'));
    fs.writeFileSync(file('rc'), 'three');

    const report = runRollback(manifest.runId, planRollback(manifest));

    expect(report.actions[0]).toMatchObject({ status: 'skipped' });
    expect(report.actions[0]!.detail).toMatch(/changed since that run/);
    expect(read('rc')).toBe('three');
  });

  it('brings a removed file back with its own permissions', async () => {
    fs.writeFileSync(file('private.toml'), 'secret');
    fs.chmodSync(file('private.toml'), 0o600);
    const manifest = await capturedRun(['private.toml'], () => fs.rmSync(file('private.toml')));

    runRollback(manifest.runId, planRollback(manifest));

    expect(fs.statSync(file('private.toml')).mode & 0o777).toBe(0o600);
  });

  it('puts back the exact bytes, even ones that are not UTF-8', async () => {
    const latin1 = Buffer.from([0x61, 0x6c, 0x69, 0x61, 0x73, 0x20, 0xe9, 0x0a]);
    fs.writeFileSync(file('rc'), latin1);
    const manifest = await capturedRun(['rc'], () => fs.appendFileSync(file('rc'), 'more\n'));

    runRollback(manifest.runId, planRollback(manifest));

    expect(fs.readFileSync(file('rc')).equals(latin1)).toBe(true);
  });

  it('checks each file again just before changing it', async () => {
    fs.writeFileSync(file('rc'), 'one');
    const manifest = await capturedRun(['rc', 'new'], () => {
      fs.writeFileSync(file('rc'), 'two');
      fs.writeFileSync(file('new'), 'created');
    });
    const steps = planRollback(manifest);
    fs.writeFileSync(file('rc'), 'edited while the prompt was open');
    fs.writeFileSync(file('new'), 'edited too');

    const report = runRollback(manifest.runId, steps);

    expect(report.actions.map((a) => a.status)).toEqual(['skipped', 'skipped']);
    expect(read('rc')).toBe('edited while the prompt was open');
    expect(read('new')).toBe('edited too');
  });

  it('marks the report incomplete while a change of the run stays in place', async () => {
    fs.writeFileSync(file('a'), 'a1');
    fs.writeFileSync(file('b'), 'b1');
    const manifest = await capturedRun(['a', 'b'], () => {
      fs.writeFileSync(file('a'), 'a2');
      fs.writeFileSync(file('b'), 'b2');
    });
    fs.writeFileSync(file('b'), 'b3');

    const first = runRollback(manifest.runId, planRollback(manifest));
    expect(first.complete).toBe(false);
    expect(first.actions.map((a) => [a.status, a.left])).toEqual([
      ['restored', undefined],
      ['skipped', true],
    ]);
    expect(formatRollbackReport(first)).toContain(
      'Some of its changes are still in place, so it stays next to roll back.'
    );

    fs.writeFileSync(file('b'), 'b2');
    const second = runRollback(manifest.runId, planRollback(manifest));
    expect(second.actions[0]).toEqual({
      path: file('a'),
      status: 'skipped',
      detail: 'already as it was before that run',
    });
    expect(second.actions[1]!.status).toBe('restored');
    expect(second.complete).toBe(true);
    expect(read('b')).toBe('b1');
  });

  it('only plans in a dry run', async () => {
    fs.writeFileSync(file('rc'), 'one');
    const manifest = await capturedRun(['rc'], () => fs.writeFileSync(file('rc'), 'two'));

    const report = runRollback(manifest.runId, planRollback(manifest), { dryRun: true });

    expect(report.actions[0]!.status).toBe('planned');
    expect(read('rc')).toBe('two');
  });

  it('reports a file it cannot put back and carries on', async () => {
    fs.writeFileSync(file('a'), 'a1');
    fs.writeFileSync(file('b'), 'b1');
    const manifest = await capturedRun(['a', 'b'], () => {
      fs.writeFileSync(file('a'), 'a2');
      fs.writeFileSync(file('b'), 'b2');
    });
    fs.rmSync(path.join(runDir(manifest.runId), 'files', '0'));

    const report = runRollback(manifest.runId, planRollback(manifest));

    expect(report.ok).toBe(false);
    expect(report.actions.map((a) => a.status)).toEqual(['failed', 'restored']);
    expect(read('b')).toBe('b1');
  });
});

describe('listRollbackRuns', () => {
  async function recorded(kind: HistoryRecord['kind'], extra: Partial<HistoryRecord> = {}) {
    const manifest = await capturedRun(['rc'], () => fs.appendFileSync(file('rc'), `${kind}\n`));
    return {
      version: 1,
      timestamp: '2026-11-14T10:00:00.000Z',
      kind,
      runId: manifest.runId,
      ...extra,
    } as HistoryRecord;
  }

  it('lists captured runs newest first, skipping runs without files', async () => {
    const install = await recorded('install');
    const apply = await recorded('apply', { command: 'apply --shells zsh' });
    const runs = listRollbackRuns([
      install,
      { version: 1, timestamp: 't', kind: 'apply' },
      { ...apply },
      { version: 1, timestamp: 't', kind: 'apply', runId: 'missing-manifest' },
    ]);

    expect(runs.map((r) => [r.runId, r.kind, r.files, r.rolledBack])).toEqual([
      [apply.runId, 'apply', 1, false],
      [install.runId, 'install', 1, false],
    ]);
    expect(runs[0]!.command).toBe('apply --shells zsh');
    expect(defaultRollbackRun(runs)?.runId).toBe(apply.runId);
  });

  it('moves the default back one run after each rollback, and forward again after an undo', async () => {
    const first = await recorded('install');
    const second = await recorded('apply');
    const undoSecond = await recorded('rollback', { rollbackOf: second.runId });

    let runs = listRollbackRuns([first, second, undoSecond]);
    expect(runs.find((r) => r.runId === second.runId)!.rolledBack).toBe(true);
    expect(defaultRollbackRun(runs)?.runId).toBe(first.runId);

    const redo = await recorded('rollback', { rollbackOf: undoSecond.runId });
    runs = listRollbackRuns([first, second, undoSecond, redo]);
    expect(runs.find((r) => r.runId === second.runId)!.rolledBack).toBe(false);
    expect(defaultRollbackRun(runs)?.runId).toBe(second.runId);
  });

  it('keeps a partly rolled back run next in line', async () => {
    const run = await recorded('apply');
    const partial = await recorded('rollback', { rollbackOf: run.runId, partial: true });

    const runs = listRollbackRuns([run, partial]);

    expect(runs.find((r) => r.runId === run.runId)!.rolledBack).toBe(false);
    expect(defaultRollbackRun(runs)?.runId).toBe(run.runId);
  });

  it('has no default once everything was rolled back', async () => {
    const only = await recorded('install');
    const undo = await recorded('rollback', { rollbackOf: only.runId });
    expect(defaultRollbackRun(listRollbackRuns([only, undo]))).toBeNull();
  });
});

describe('formatting', () => {
  it('lists runs with the next one to roll back marked', () => {
    const text = formatRollbackRuns([
      { runId: 'r2', timestamp: 't', kind: 'apply', command: 'apply', files: 2, rolledBack: true },
      { runId: 'r1', timestamp: 't', kind: 'install', files: 1, rolledBack: false },
    ]);
    expect(text).toBe(
      'r2  apply     2 files (apply; rolled back)\nr1  install   1 file (next to roll back)\n'
    );
    expect(formatRollbackRuns([])).toBe('No recorded run changed any files.\n');
  });

  it('reports each file under a status column', () => {
    expect(
      formatRollbackReport({
        runId: 'r1',
        ok: true,
        complete: true,
        dryRun: true,
        actions: [{ path: '/h/.zshrc', status: 'planned', detail: 'put back' }],
      })
    ).toBe('Rollback of r1 (dry run — nothing was changed)\n\nPLANNED /h/.zshrc — put back\n');
  });
});
