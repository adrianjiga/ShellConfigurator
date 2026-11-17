import * as fs from 'node:fs';
import * as path from 'node:path';
import { getShell } from '../config/shells.ts';
import { homeDir } from '../services/paths.ts';
import { assertWritable, keepOriginal, readTextToRewrite, writeFileAtomic } from './fileWrite.ts';
import { FS_RC_IO, type RcIo, reachableSome, sourcedFiles } from './rcInit.ts';
import { appendManagedBlock, hasLine, keepLineEndings } from './rcLines.ts';
import type { RemovalResult } from './shellRc.ts';

const BASH_LOGIN_FILES = ['.bash_profile', '.bash_login', '.profile'];

export const LOGIN_MARKER = '# Added by ShellConfigurator (login shells read this, not ~/.bashrc)';

const LOGIN_LINE = '[ -n "$BASH_VERSION" ] && [ -f ~/.bashrc ] && . ~/.bashrc';

export function bashLoginFile(io: RcIo = FS_RC_IO): string {
  const files = bashLoginFiles();
  return files.find((file) => io.exists(file)) ?? files[0];
}

export function bashLoginFiles(): string[] {
  return BASH_LOGIN_FILES.map((name) => path.join(homeDir(), name));
}

export function bashNeedsLoginFile(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'darwin';
}

export function loginLoadsBashrc(
  content: string,
  io: RcIo = FS_RC_IO,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const bashrc = getShell('bash')?.rcFile;
  return Boolean(
    bashrc && reachableSome(content, (text) => sourcedFiles(text, env).includes(bashrc), io, env)
  );
}

export function bashLoginContent(existing: string, io: RcIo = FS_RC_IO): string {
  return loginLoadsBashrc(existing, io)
    ? existing
    : keepLineEndings(existing, appendManagedBlock(existing, LOGIN_MARKER, [LOGIN_LINE]));
}

export function ensureBashLogin(): { file: string; note: string | null } | null {
  if (!bashNeedsLoginFile()) return null;
  const file = bashLoginFile();
  const existing = fs.existsSync(file) ? readTextToRewrite(file) : '';
  const content = bashLoginContent(existing);
  if (content === existing) return null;
  const note = keepOriginal(file);
  writeFileAtomic(file, content);
  return { file, note };
}

export function bashLoginBlockFiles(io: RcIo = FS_RC_IO): string[] {
  return bashLoginFiles().filter((file) => {
    try {
      return io.exists(file) && hasLine(io.readFile(file), LOGIN_MARKER);
    } catch {
      return false;
    }
  });
}

export function removeBashLoginBlock(file: string): RemovalResult {
  if (!fs.existsSync(file)) return { removed: false, note: `${file} does not exist` };
  const lines = readTextToRewrite(file).split('\n');
  const at = lines.findIndex((line) => line.trim() === LOGIN_MARKER);
  if (at === -1) return { removed: false, note: `no ShellConfigurator line in ${file}` };
  const end = lines[at + 1]?.trim() === LOGIN_LINE ? at + 2 : at + 1;
  const start = at > 0 && lines[at - 1].trim() === '' ? at - 1 : at;
  lines.splice(start, end - start);
  const content = lines.join('\n');
  if (content.trim() !== '') assertWritable(file);
  if (content.trim() === '') fs.rmSync(file);
  else writeFileAtomic(file, content);
  return {
    removed: true,
    ...(content.trim() === '' ? { note: 'it held nothing else, so it is gone' } : {}),
  };
}
