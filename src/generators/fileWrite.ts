import { isUtf8 } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { errorMessage } from '../services/errors.ts';
import { BLOCK_MARKER, GENERATED_MARKER } from './rcLines.ts';

/** Refuses a file that cannot be written before anything is changed for it. */
export function assertWritable(filePath: string): void {
  if (fs.existsSync(filePath)) fs.accessSync(filePath, fs.constants.W_OK);
}

export interface RemovalResult {
  removed: boolean;
  note?: string;
}

export const ORIGINAL_SUFFIX = '.pre-shell-configurator';

export interface KeepOriginalOptions {
  toolOwned?: boolean;
}

export function originalCopyPath(filePath: string): string {
  return `${filePath}${ORIGINAL_SUFFIX}`;
}

/**
 * Copies a file to `<file>.pre-shell-configurator` the first time this tool is
 * about to change it, and never again: a copy already there, or a file that
 * already holds one of this tool's blocks, is not the original. With
 * `toolOwned`, for the per-shell configs only this tool writes, a file with the
 * generated header is not the original either; elsewhere that header may sit
 * on a config the user wrote with `generate -o` and tuned since. Best-effort:
 * returns why the copy could not be kept, or null, and never stops the change.
 */
export function keepOriginal(filePath: string, options: KeepOriginalOptions = {}): string | null {
  const original = originalCopyPath(filePath);
  try {
    if (!fs.existsSync(filePath) || fs.existsSync(original)) return null;
    const content = fs.readFileSync(filePath, 'utf8');
    if (content.includes(BLOCK_MARKER)) return null;
    if (options.toolOwned && content.includes(GENERATED_MARKER)) return null;
    assertWritable(filePath);
    fs.copyFileSync(filePath, original, fs.constants.COPYFILE_EXCL);
    return null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return null;
    return `could not keep its original as ${path.basename(original)} (${errorMessage(err)})`;
  }
}

export function withNote<T extends { note?: string }>(result: T, note: string | null): T {
  if (!note) return result;
  return { ...result, note: result.note ? `${result.note}; ${note}` : note };
}

/**
 * Where a write to `filePath` must land, and the mode it must keep. A symlink
 * (stow, chezmoi, yadm) is written through to its target so the link survives;
 * a dangling one is refused rather than replaced; a read-only file is refused
 * rather than silently made writable.
 */
function resolveWriteTarget(filePath: string): { target: string; mode?: number } {
  const link = fs.lstatSync(filePath, { throwIfNoEntry: false });
  if (!link) return { target: filePath };
  let target = filePath;
  if (link.isSymbolicLink()) {
    try {
      target = fs.realpathSync(filePath);
    } catch (err) {
      throw new Error(`${filePath} is a symlink to a file that does not exist`, { cause: err });
    }
  }
  fs.accessSync(target, fs.constants.W_OK);
  const stat = fs.statSync(target, { throwIfNoEntry: false });
  return { target, mode: stat ? stat.mode & 0o7777 : undefined };
}

/**
 * Writes a file atomically: the content goes to a uniquely named temp file in
 * the same directory, flushed to disk, then renamed over the target, keeping
 * its permissions. A reader never sees a truncated file. On failure the temp
 * file is removed and the original error re-thrown.
 */
export function writeFileAtomic(
  filePath: string,
  content: string | Buffer,
  newFileMode?: number
): void {
  const resolved = resolveWriteTarget(filePath);
  const { target } = resolved;
  const mode = resolved.mode ?? newFileMode;
  const tmpPath = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  );
  try {
    fs.writeFileSync(tmpPath, content, {
      encoding: 'utf8',
      flush: true,
      ...(mode !== undefined ? { mode } : {}),
    });
    if (mode !== undefined) fs.chmodSync(tmpPath, mode);
    fs.renameSync(tmpPath, target);
  } catch (err) {
    try {
      fs.rmSync(tmpPath, { force: true });
    } catch {
      // The temp file may not exist either; the write error is the useful one.
    }
    throw err;
  }
}

/**
 * A file this tool is about to rewrite, as text. A file that is not UTF-8 is refused.
 */
export function readTextToRewrite(file: string): string {
  const text = fs.readFileSync(file, 'utf8');
  if (text.includes('\uFFFD') && !isUtf8(fs.readFileSync(file))) {
    throw new Error(
      `${file} is not UTF-8 text, so it is left as it is: save it as UTF-8 and run this again`
    );
  }
  return text;
}
