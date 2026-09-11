import { zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractFontFiles } from '../../services/fontExtractor.ts';

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
