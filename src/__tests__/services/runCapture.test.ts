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
  readRunManifest,
  runDir,
  runsDir,
  trackedFiles,
  UNREADABLE_AFTER,
} from '../../services/runCapture.ts';

let tmpDir: string;
const savedEnv = { ...process.env };

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shellconf-runs-'));
  process.env.XDG_STATE_HOME = path.join(tmpDir, 'state');
});
afterEach(() => {
  process.env = { ...savedEnv };
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

describe('readRunManifest', () => {
  it('is null for an unknown run or a manifest of another version', () => {
    expect(readRunManifest('nope')).toBeNull();
    fs.mkdirSync(runDir('old'), { recursive: true });
    fs.writeFileSync(path.join(runDir('old'), 'manifest.json'), '{"version":9,"files":[]}');
    expect(readRunManifest('old')).toBeNull();
  });
});
