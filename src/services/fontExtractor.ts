import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';

const require = createRequire(import.meta.url);
const FFLATE_ENTRY = require.resolve('fflate');

/** Cap on how long a zip may take to decompress before the worker is killed. */
const FONT_EXTRACT_TIMEOUT_MS = 60_000;

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
try {
  const entries = unzipSync(workerData.zipBytes);
  const files = [];
  for (const name of Object.keys(entries)) {
    if (/\\.(ttf|otf|woff2?)$/i.test(name)) {
      files.push({ name: path.basename(name), bytes: entries[name] });
    }
  }
  parentPort.postMessage({ ok: true, files });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
}
`;

export async function extractFontFiles(zipBytes: Uint8Array): Promise<ExtractedFontFile[]> {
  // Own, non-pooled copy so the structured clone seen by the worker covers
  // exactly the archive's bytes, not a shared Buffer pool segment.
  const bytes = new Uint8Array(zipBytes);

  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { fflatePath: FFLATE_ENTRY, zipBytes: bytes },
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
      // A clean exit after a successful postMessage is the happy path and must
      // not reject a promise that already resolved.
      if (code !== 0) {
        clearTimeout(timer);
        reject(new Error(`Font extraction worker exited with code ${code}.`));
      }
    });
  });
}
