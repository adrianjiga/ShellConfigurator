import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { cacheDir } from './paths.ts';

/** SHA-256 of a byte buffer as a lowercase hex string. */
export function sha256Digest(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * A cached font archive plus the digest it was pinned with. Consumers verify
 * against `digest` rather than re-deriving trust from the network.
 */
export interface CachedFont {
  /** The font id, e.g. 'JetBrainsMono'. */
  id: string;
  /** Absolute path to the cached archive. */
  path: string;
  /** The pinned SHA-256 recorded when the archive was cached. */
  digest: string;
  /** Archive size in bytes. */
  bytes: number;
}

/** Per-app font store: <cacheDir>/fonts/. */
function fontsDir(): string {
  return path.join(cacheDir(), 'fonts');
}

/** Where a font's archive lives in the cache: <cacheDir>/fonts/<id>.zip. */
export function fontCachePath(fontId: string): string {
  return path.join(fontsDir(), `${fontId}.zip`);
}

/** The pin file written beside the archive: <cacheDir>/fonts/<id>.sha256. */
function pinFilePath(fontId: string): string {
  return path.join(fontsDir(), `${fontId}.sha256`);
}

/** True when the failure is simply that the file does not exist. */
function isMissingFile(err: unknown): boolean {
  return (err as { code?: string }).code === 'ENOENT';
}

/**
 * The pinned SHA-256 recorded for a font, or null when the cache has no pin for
 * it. The pin survives the archive being evicted, so repair can tell "we had
 * this font once" apart from "never seen it".
 */
export function pinnedDigest(fontId: string): string | null {
  try {
    return fs.readFileSync(pinFilePath(fontId), 'utf8').trim() || null;
  } catch (err) {
    if (isMissingFile(err)) return null;
    throw err;
  }
}

/**
 * Writes a (already verified) archive into the cache and pins its SHA-256 so a
 * later reinstall can trust it offline. Returns the pinned digest. The archive
 * is written before the pin; a crash between the two leaves an unpinned file,
 * which cachedFont treats as absent.
 */
export function cacheFont(fontId: string, buffer: Buffer): string {
  const dir = fontsDir();
  fs.mkdirSync(dir, { recursive: true });
  const digest = sha256Digest(buffer);
  fs.writeFileSync(fontCachePath(fontId), buffer);
  fs.writeFileSync(pinFilePath(fontId), `${digest}\n`, 'utf8');
  return digest;
}

/**
 * The cached archive for a font that still verifies against its pinned digest,
 * or null when there is none (no pin, missing file, or tamper). A cache that
 * fails verification is treated as absent so callers fall back to re-downloading
 * rather than installing a corrupted font.
 */
export function cachedFont(fontId: string): CachedFont | null {
  const digest = pinnedDigest(fontId);
  if (!digest) return null;

  const file = fontCachePath(fontId);
  let buffer: Buffer;
  try {
    buffer = fs.readFileSync(file);
  } catch (err) {
    if (isMissingFile(err)) return null;
    throw err;
  }
  if (sha256Digest(buffer) !== digest) return null;

  return { id: fontId, path: file, digest, bytes: buffer.byteLength };
}
