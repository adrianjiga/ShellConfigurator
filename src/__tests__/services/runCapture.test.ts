import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('../../services/runCapture.ts');

const failWrites = vi.hoisted(() => ({ after: Number.POSITIVE_INFINITY }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
      if (failWrites.after-- <= 0) throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' });
      return actual.writeFileSync(...args);
    },
  };
});

import { getShell } from '../../config/shells.ts';
import { getSharedConfigPath, getShellConfigPath } from '../../generators/shellRc.ts';
import { sha256Digest } from '../../services/cache.ts';
import {
  beginRunCapture,
  CapturedRunError,
  captureRun,
  finishRunCapture,
  KEPT_RUNS,
  laterRunWrites,
  pruneRuns,
  readRunManifest,
  runDir,
  runsDir,
  trackedFiles,
  UNREADABLE_AFTER,
} from '../../services/runCapture.ts';
import { restoreEnv } from '../helpers/env.ts';

let tmpDir: string;
const savedEnv = { ...process.env };

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shellconf-runs-'));
  process.env.XDG_STATE_HOME = path.join(tmpDir, 'state');
});
afterEach(() => {
  restoreEnv(savedEnv);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const file = (name: string) => path.join(tmpDir, name);
const hash = (content: string) => sha256Digest(Buffer.from(content));

describe('trackedFiles', () => {
  it('covers every rc, every per-shell config, the shared config and terminal configs', () => {
    const files = trackedFiles();
    expect(files).toContain(getShell('zsh')!.rcFile);
    expect(files).toContain(getShell('fish')!.rcFile);
    expect(files).toContain(getShellConfigPath('nushell'));
    expect(files).toContain(getSharedConfigPath());
    expect(files.some((f) => f.endsWith('kitty.conf'))).toBe(true);
  });
});

describe('beginRunCapture / finishRunCapture', () => {
  it('keeps only what the run changed, with the earlier content and the later hash', () => {
    fs.writeFileSync(file('edited'), 'old');
    fs.writeFileSync(file('untouched'), 'same');
    fs.writeFileSync(file('removed'), 'gone soon');
    fs.chmodSync(file('edited'), 0o640);
    fs.chmodSync(file('removed'), 0o600);

    const capture = beginRunCapture([
      file('edited'),
      file('untouched'),
      file('created'),
      file('removed'),
      file('never'),
    ]);
    fs.writeFileSync(file('edited'), 'new');
    fs.writeFileSync(file('created'), 'fresh');
    fs.rmSync(file('removed'));
    const manifest = finishRunCapture(capture)!;

    expect(manifest.runId).toBe(capture.runId);
    expect(manifest.files).toEqual([
      { path: file('edited'), before: '0', after: hash('new'), mode: 0o640 },
      { path: file('created'), before: null, after: hash('fresh') },
      { path: file('removed'), before: '3', after: null, mode: 0o600 },
    ]);
    const copies = path.join(runDir(capture.runId), 'files');
    expect(fs.readFileSync(path.join(copies, '0'), 'utf8')).toBe('old');
    expect(fs.readdirSync(copies).sort()).toEqual(['0', '3']);
    expect(readRunManifest(capture.runId)).toEqual(manifest);
  });

  it('keeps a file the run left unreadable, marked so', () => {
    fs.writeFileSync(file('rc'), 'old');
    const capture = beginRunCapture([file('rc')]);
    fs.rmSync(file('rc'));
    fs.mkdirSync(file('rc'));

    expect(finishRunCapture(capture)!.files).toEqual([
      { path: file('rc'), before: '0', after: UNREADABLE_AFTER, mode: expect.any(Number) },
    ]);
  });

  it('removes the run folder when the run changed nothing', () => {
    fs.writeFileSync(file('same'), 'x');
    const capture = beginRunCapture([file('same'), file('missing')]);

    expect(finishRunCapture(capture)).toBeNull();
    expect(fs.existsSync(capture.dir)).toBe(false);
  });

  it('removes its half-written folder when copying fails partway', () => {
    fs.writeFileSync(file('a'), 'a');
    fs.writeFileSync(file('b'), 'b');
    failWrites.after = 1;
    try {
      expect(() => beginRunCapture([file('a'), file('b')])).toThrow('ENOSPC');
    } finally {
      failWrites.after = Number.POSITIVE_INFINITY;
    }
    expect(fs.readdirSync(runsDir())).toEqual([]);
  });

  it('leaves out a path it cannot read as a file', () => {
    fs.mkdirSync(file('folder'));
    const capture = beginRunCapture([file('folder')]);
    expect(capture.files).toEqual([]);
  });

  it('keeps the copies private to the user', () => {
    fs.writeFileSync(file('rc'), 'secret');
    const capture = beginRunCapture([file('rc')]);
    const mode = fs.statSync(path.join(capture.dir, 'files', '0')).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('never reuses an existing run folder', () => {
    vi.useFakeTimers({ now: new Date('2026-11-14T10:00:00.000Z'), toFake: ['Date'] });
    try {
      fs.mkdirSync(runDir('2026-11-14T10-00-00.000Z'), { recursive: true });
      fs.mkdirSync(runDir('2026-11-14T10-00-00.000Z-2'));

      expect(beginRunCapture([]).runId).toBe('2026-11-14T10-00-00.000Z-3');
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives two captures in the same millisecond different ids', () => {
    const a = beginRunCapture([]);
    const b = beginRunCapture([]);
    expect(a.runId).not.toBe(b.runId);
  });
});

describe('captureRun', () => {
  it('returns the run result and the id of its manifest', async () => {
    const { result, runId } = await captureRun([file('rc')], async () => {
      fs.writeFileSync(file('rc'), 'wired');
      return 42;
    });

    expect(result).toBe(42);
    expect(readRunManifest(runId!)?.files).toHaveLength(1);
  });

  it('has no id when the run changed nothing', async () => {
    expect((await captureRun([file('rc')], async () => 'x')).runId).toBeNull();
  });

  it('rejects with the runId of what the run had changed when it threw', async () => {
    const failure = captureRun([file('rc')], async () => {
      fs.writeFileSync(file('rc'), 'half done');
      throw new Error('boom');
    });

    const err = await failure.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CapturedRunError);
    expect((err as CapturedRunError).message).toBe('boom');
    expect(((err as CapturedRunError).cause as Error).message).toBe('boom');
    expect(readRunManifest((err as CapturedRunError).runId!)?.files).toHaveLength(1);
  });

  it('runs anyway when the capture cannot be written', async () => {
    fs.mkdirSync(path.dirname(runsDir()), { recursive: true });
    fs.writeFileSync(runsDir(), 'not a folder');

    const { result, runId } = await captureRun([file('rc')], async () => 'ran');

    expect(result).toBe('ran');
    expect(runId).toBeNull();
  });
});

describe('pruneRuns', () => {
  it('keeps only the newest runs', () => {
    for (const day of ['01', '02', '03', '04']) {
      fs.mkdirSync(runDir(`2026-11-${day}T10-00-00.000Z`), { recursive: true });
    }
    fs.writeFileSync(path.join(runsDir(), 'stray-file'), '');

    pruneRuns(2);

    expect(fs.readdirSync(runsDir()).sort()).toEqual([
      '2026-11-03T10-00-00.000Z',
      '2026-11-04T10-00-00.000Z',
      'stray-file',
    ]);
  });

  it('runs after every capture, keeping 50 runs', async () => {
    for (let i = 0; i < KEPT_RUNS; i++) {
      fs.mkdirSync(runDir(`2000-01-01T00-00-00.000Z-${String(i).padStart(3, '0')}`), {
        recursive: true,
      });
    }

    const { runId } = await captureRun([file('rc')], async () => {
      fs.writeFileSync(file('rc'), 'x');
    });

    const kept = fs.readdirSync(runsDir());
    expect(kept).toHaveLength(KEPT_RUNS);
    expect(kept).toContain(runId);
    expect(kept).not.toContain('2000-01-01T00-00-00.000Z-000');
  });
});

describe('readRunManifest', () => {
  it('is null for an unknown run or a manifest of another version', () => {
    expect(readRunManifest('nope')).toBeNull();
    fs.mkdirSync(runDir('old'), { recursive: true });
    fs.writeFileSync(path.join(runDir('old'), 'manifest.json'), '{"version":9,"files":[]}');
    expect(readRunManifest('old')).toBeNull();
  });
});

describe('finishRunCapture with onChanged', () => {
  const rc = () => path.join(tmpDir, 'rc');
  const summary = () => path.join(tmpDir, 'summary.md');

  it('runs once the run changed files, and keeps what it writes as part of the run', () => {
    fs.writeFileSync(summary(), 'earlier', { mode: 0o640 });
    const capture = beginRunCapture([rc(), summary()]);
    fs.writeFileSync(rc(), 'new');
    const onChanged = vi.fn((_runId: string, files: { path: string }[]) => {
      expect(files.map((file) => file.path)).toEqual([rc()]);
      fs.writeFileSync(summary(), 'later');
    });

    const manifest = finishRunCapture(capture, { onChanged, rewritable: [summary()] })!;

    expect(onChanged).toHaveBeenCalledWith(capture.runId, expect.any(Array), undefined);
    const entry = manifest.files.find((file) => file.path === summary())!;
    expect(entry).toMatchObject({ mode: 0o640, rewritable: true });
    expect(entry.after).toBe(sha256Digest(Buffer.from('later')));
    expect(fs.readFileSync(path.join(runDir(capture.runId), 'files', entry.before!), 'utf8')).toBe(
      'earlier'
    );
    expect(manifest.files.find((file) => file.path === rc())!.rewritable).toBeUndefined();
    expect(readRunManifest(capture.runId)).toEqual(manifest);
  });

  it('does not run when the run changed nothing', () => {
    const onChanged = vi.fn();
    const capture = beginRunCapture([rc()]);
    expect(finishRunCapture(capture, { onChanged })).toBeNull();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('gets the error of a run that threw, and its own errors do not stop the manifest', async () => {
    const { captureRun: realCaptureRun } = await vi.importActual<
      typeof import('../../services/runCapture.ts')
    >('../../services/runCapture.ts');
    const onChanged = vi.fn(() => {
      throw new Error('summary failed');
    });
    const failure = new Error('chain broke');

    let caught: unknown;
    try {
      await realCaptureRun(
        [rc()],
        async () => {
          fs.writeFileSync(rc(), 'half');
          throw failure;
        },
        { onChanged }
      );
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(CapturedRunError);
    const runId = (caught as CapturedRunError).runId!;
    expect(onChanged).toHaveBeenCalledWith(runId, expect.any(Array), failure);
    expect(readRunManifest(runId)!.files.map((file) => file.path)).toEqual([rc()]);
  });
});

describe('laterRunWrites', () => {
  it('collects what runs after the given one left in the file', () => {
    const file = path.join(tmpDir, 'f');
    const run = (content: string | null) => {
      const capture = beginRunCapture([file]);
      if (content === null) fs.rmSync(file);
      else fs.writeFileSync(file, content);
      return finishRunCapture(capture)!.runId;
    };
    const first = run('one');
    run('two');
    run(null);

    expect(laterRunWrites(first, file)).toEqual(new Set([sha256Digest(Buffer.from('two')), null]));
    expect(laterRunWrites('9999', file)).toEqual(new Set());
  });
});
