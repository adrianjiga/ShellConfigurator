import { zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractFontFiles, fontFileNames } from '../../services/fontExtractor.ts';

/**
 * Drives the controlled worker. The happy-path tests run the real worker; the
 * failure tests switch these controls so the worker hangs, reports an error, or
 * exits badly — the hostile-archive branches extractFontFiles guards.
 */
const workerControls = vi.hoisted(() => ({
  mode: 'real' as 'real' | 'silent' | 'success' | 'reject',
  error: undefined as unknown,
  exitCode: -1,
  terminate: vi.fn(() => Promise.resolve(0)),
}));

vi.mock('node:worker_threads', async () => {
  const actual = await vi.importActual<typeof import('node:worker_threads')>('node:worker_threads');

  class ControlledWorker {
    private handlers = new Map<string, Array<(arg: unknown) => void>>();
    private real: InstanceType<typeof actual.Worker> | null = null;

    constructor(options: unknown, workerData: unknown) {
      if (workerControls.mode === 'real') {
        // Fall back to a real worker so the happy-path extraction still runs.
        this.real = new actual.Worker(options as never, workerData as never);
        this.real.on('message', (message) => this.emit('message', message));
        this.real.on('error', (error) => this.emit('error', error));
        this.real.on('exit', (code) => this.emit('exit', code));
        return;
      }
      if (workerControls.mode === 'success') {
        queueMicrotask(() => this.emit('message', { ok: true }));
        queueMicrotask(() => this.emit('exit', 0));
        return;
      }
      if (workerControls.mode === 'reject') {
        queueMicrotask(() => this.emit('message', { ok: false }));
        return;
      }
      const { error, exitCode } = workerControls;
      if (error) {
        queueMicrotask(() => this.emit('error', error));
      } else if (exitCode !== -1) {
        queueMicrotask(() => this.emit('exit', exitCode));
      }
    }

    on(event: string, handler: (arg: unknown) => void): void {
      const handlers = this.handlers.get(event) ?? [];
      handlers.push(handler);
      this.handlers.set(event, handlers);
    }

    terminate(): Promise<number> {
      if (this.real) return this.real.terminate();
      return workerControls.terminate();
    }

    private emit(event: string, arg: unknown): void {
      for (const handler of this.handlers.get(event) ?? []) handler(arg);
    }
  }

  return { ...actual, Worker: ControlledWorker };
});

function zipBytes(zip: Uint8Array): Uint8Array {
  return new Uint8Array(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength));
}

function encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

describe('extractFontFiles', () => {
  beforeEach(() => {
    workerControls.mode = 'real';
    workerControls.error = undefined;
    workerControls.exitCode = -1;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('extracts only font entries and flattens their paths to basenames', async () => {
    const zip = zipSync({
      'fonts/JetBrainsMono-Regular.otf': encode('otf'),
      'nested/deep/NerdFont-Regular.ttf': encode('ttf'),
      'README.md': encode('readme'),
      'assets/icon.woff2': encode('woff2'),
      'assets/icon.woff': encode('woff'),
    });

    const files = await extractFontFiles(zipBytes(zip));

    expect(files.map((file) => file.name).sort()).toEqual([
      'JetBrainsMono-Regular.otf',
      'NerdFont-Regular.ttf',
      'icon.woff',
      'icon.woff2',
    ]);
    expect(
      new TextDecoder().decode(files.find((f) => f.name === 'NerdFont-Regular.ttf')!.bytes)
    ).toBe('ttf');
  });

  it('refuses a font entry that would expand past the size cap', async () => {
    const zip = zipSync({ 'Huge.ttf': new Uint8Array(2048) });

    await expect(
      extractFontFiles(zipBytes(zip), { maxEntryBytes: 1024, maxTotalBytes: 4096 })
    ).rejects.toThrow('Huge.ttf expands past');
  });

  it('refuses fonts that together expand past the total cap', async () => {
    const zip = zipSync({ 'A.ttf': new Uint8Array(800), 'B.ttf': new Uint8Array(800) });

    await expect(
      extractFontFiles(zipBytes(zip), { maxEntryBytes: 1024, maxTotalBytes: 1200 })
    ).rejects.toThrow('the font files expand past');
  });

  it('keeps the first of two same-named fonts and drops unsafe names', async () => {
    const zip = zipSync({
      'a/Font-Regular.ttf': encode('first'),
      'b/Font-Regular.ttf': encode('second'),
      'dir/.ttf': encode('hidden'),
    });

    const files = await extractFontFiles(zipBytes(zip));

    expect(files.map((f) => f.name)).toEqual(['Font-Regular.ttf']);
    expect(new TextDecoder().decode(files[0]!.bytes)).toBe('first');
  });

  it('matches font extensions in any case', async () => {
    const zip = zipSync({ 'HackNerdFont-Regular.TTF': encode('ttf') });
    const files = await extractFontFiles(zipBytes(zip));
    expect(files.map((file) => file.name)).toEqual(['HackNerdFont-Regular.TTF']);
  });

  it('treats backslashes as part of one file name, dropping a dot-led one', async () => {
    const zip = zipSync({
      '..\\..\\evil.ttf': encode('ttf'),
      'fonts\\Hack.ttf': encode('ttf'),
    });
    const files = await extractFontFiles(zipBytes(zip));
    expect(files.map((file) => file.name)).toEqual(['fonts\\Hack.ttf']);
  });

  it('returns stored (uncompressed) entries intact', async () => {
    const zip = zipSync({ 'A.ttf': encode('aaa'), 'B.otf': encode('bbb') }, { level: 0 });

    const files = await extractFontFiles(zipBytes(zip));

    expect(files.map((f) => [f.name, new TextDecoder().decode(f.bytes)])).toEqual([
      ['A.ttf', 'aaa'],
      ['B.otf', 'bbb'],
    ]);
  });

  it('returns an empty list when the archive holds no font files', async () => {
    const zip = zipSync({ 'README.md': encode('nothing') });

    await expect(extractFontFiles(zipBytes(zip))).resolves.toEqual([]);
  });

  it('rejects with a clear error when the bytes are not a zip archive', async () => {
    await expect(extractFontFiles(encode('not a zip'))).rejects.toThrow(
      'Could not extract font archive'
    );
  });

  it('rejects with a readable error when the worker reports failure', async () => {
    workerControls.mode = 'silent';
    workerControls.error = new Error('unzip blew up');

    await expect(extractFontFiles(encode('bytes'))).rejects.toThrow('unzip blew up');
  });

  it('wraps a non-Error worker failure in an Error', async () => {
    workerControls.mode = 'silent';
    workerControls.error = 'plain string failure';

    await expect(extractFontFiles(encode('bytes'))).rejects.toThrow('plain string failure');
  });

  it('rejects when the worker exits without posting anything', async () => {
    workerControls.mode = 'silent';
    workerControls.exitCode = 3;

    await expect(extractFontFiles(encode('bytes'))).rejects.toThrow('exited with code 3');
  });

  it('rejects at once when the worker exits cleanly without a result', async () => {
    vi.useFakeTimers();
    workerControls.mode = 'silent';
    workerControls.exitCode = 0;

    const promise = extractFontFiles(encode('bytes'));
    const resolution = expect(promise).rejects.toThrow('exited without a result');
    await vi.advanceTimersByTimeAsync(10);
    await resolution;
  });

  it('rejects with a timeout when the worker hangs', async () => {
    vi.useFakeTimers();
    workerControls.mode = 'silent';

    const promise = extractFontFiles(encode('bytes'));
    const resolution = expect(promise).rejects.toThrow('Font extraction timed out.');
    await vi.advanceTimersByTimeAsync(60_000);
    await resolution;
    expect(workerControls.terminate).toHaveBeenCalled();
  });

  it('does not reject a resolved promise when the worker later exits cleanly', async () => {
    workerControls.mode = 'success';

    await expect(extractFontFiles(encode('bytes'))).resolves.toEqual([]);
  });

  it('rejects with the generic message when the worker sends no error detail', async () => {
    workerControls.mode = 'reject';

    await expect(extractFontFiles(encode('bytes'))).rejects.toThrow('unknown error');
  });
});

describe('fontFileNames', () => {
  beforeEach(() => {
    workerControls.mode = 'real';
  });

  it('lists the same names extractFontFiles writes', async () => {
    const zip = zipBytes(
      zipSync({
        'fonts/A-Regular.ttf': encode('a'),
        'other/A-Regular.ttf': encode('dup'),
        'nested/B.OTF': encode('b'),
        'dir/.ttf': encode('hidden'),
        'README.md': encode('readme'),
      })
    );

    const extracted = (await extractFontFiles(zip)).map((f) => f.name);

    expect(fontFileNames(zip)).toEqual(extracted);
    expect(fontFileNames(zip)).toEqual(['A-Regular.ttf', 'B.OTF']);
  });

  it('never inflates an entry, so corrupt compressed data does not matter', () => {
    const zip = zipBytes(zipSync({ 'A.ttf': encode('x'.repeat(4096)) }));
    const dataStart = 30 + 'A.ttf'.length;
    zip.fill(0xff, dataStart, dataStart + 16);

    expect(fontFileNames(zip)).toEqual(['A.ttf']);
  });
});
