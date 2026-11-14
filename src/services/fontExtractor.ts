import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';

const require = createRequire(import.meta.url);
const FFLATE_ENTRY = require.resolve('fflate');

/** Cap on how long a zip may take to decompress before the worker is killed. */
const FONT_EXTRACT_TIMEOUT_MS = 60_000;

/** Single Nerd Font files are a few MB; the caps stop a zip bomb inflating unchecked. */
const MAX_FONT_FILE_BYTES = 64 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 1024 * 1024 * 1024;

export interface ExtractedFontFile {
  name: string;
  bytes: Uint8Array;
}

/**
 * The worker source, evaluated via `eval: true` so no extra file ships in dist/.
 * It runs as CommonJS, so `require` is available even though the host module is
 * ESM; fflate's absolute path and the zip travel through workerData, and results
 * come back on `parentPort`. Decompressing in a worker isolates parsing from the
 * main thread, so a hostile archive can only crash the throwaway worker, not the
 * wizard. Entries are flattened to basenames here (load-bearing, the equivalent
 * of path.basename in the old in-process extraction).
 */
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const path = require('node:path');
const { unzipSync } = require(workerData.fflatePath);
const FONT_FILE = /\\.(ttf|otf|woff2?)$/i;
try {
  let total = 0;
  const entries = unzipSync(workerData.zipBytes, {
    filter: (file) => {
      if (!FONT_FILE.test(file.name)) return false;
      if (file.originalSize > workerData.maxEntryBytes) {
        throw new Error(file.name + ' expands past ' + workerData.maxEntryBytes + ' bytes');
      }
      total += file.originalSize;
      if (total > workerData.maxTotalBytes) {
        throw new Error('the font files expand past ' + workerData.maxTotalBytes + ' bytes');
      }
      return true;
    },
  });
  const files = [];
  const seen = new Set();
  for (const name of Object.keys(entries)) {
    const base = path.basename(name);
    // A hidden, NUL-bearing or repeated name cannot be written safely; the first wins.
    if (base.startsWith('.') || base.includes('\\0') || seen.has(base)) continue;
    seen.add(base);
    files.push({ name: base, bytes: entries[name] });
  }
  const buffers = [...new Set(files.map((file) => file.bytes.buffer))];
  parentPort.postMessage({ ok: true, files }, buffers);
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
}
`;

export interface ExtractLimits {
  maxEntryBytes: number;
  maxTotalBytes: number;
}

const DEFAULT_LIMITS: ExtractLimits = {
  maxEntryBytes: MAX_FONT_FILE_BYTES,
  maxTotalBytes: MAX_EXTRACTED_BYTES,
};

export async function extractFontFiles(
  zipBytes: Uint8Array,
  limits: ExtractLimits = DEFAULT_LIMITS
): Promise<ExtractedFontFile[]> {
  // Own copy, so transferring it to the worker detaches neither the caller's
  // buffer nor a shared Buffer pool segment.
  const bytes = new Uint8Array(zipBytes);

  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: {
        fflatePath: FFLATE_ENTRY,
        zipBytes: bytes,
        maxEntryBytes: limits.maxEntryBytes,
        maxTotalBytes: limits.maxTotalBytes,
      },
      transferList: [bytes.buffer],
    });

    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error('Font extraction timed out.'));
    }, FONT_EXTRACT_TIMEOUT_MS);

    worker.on(
      'message',
      (message: { ok: boolean; files?: ExtractedFontFile[]; error?: string }) => {
        clearTimeout(timer);
        if (message.ok) {
          resolve(message.files ?? []);
        } else {
          reject(new Error(`Could not extract font archive: ${message.error ?? 'unknown error'}`));
        }
      }
    );
    worker.on('error', (error) => {
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    });
    worker.on('exit', (code) => {
      // After a posted result this reject is a no-op; without one, waiting for
      // the timeout would only delay the same failure.
      clearTimeout(timer);
      reject(
        new Error(
          code === 0
            ? 'Font extraction worker exited without a result.'
            : `Font extraction worker exited with code ${code}.`
        )
      );
    });
  });
}
