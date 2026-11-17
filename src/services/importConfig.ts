import { CliRunError, CliUsageError, errorMessage } from './errors.ts';
import { redactUrl, redactUrlText } from './redact.ts';

/** Cap on how long an --import-url fetch may hang before it is aborted. */
const IMPORT_FETCH_TIMEOUT_MS = 10_000;

const IMPORT_MAX_REDIRECTS = 5;

/** Cap on how large an --import-url config may be. Starship configs are KBs. */
const IMPORT_FETCH_MAX_BYTES = 1_000_000;

export interface FetchConfigOptions {
  /** Abort the request after this many ms. Loose, for tests to shrink the wait. */
  timeoutMs?: number;
  /** Reject when the response exceeds this many bytes. */
  maxBytes?: number;
}

/**
 * Fetches a starship.toml from a gist/URL (`--import-url`) and folds it into
 * adopt mode: the downloaded content becomes the shared config every wired
 * shell reads, so the wizard never regenerates. Fails loud on a bad scheme,
 * an HTTP error, or an empty body. The fetch is bounded: a hung connection is
 * aborted after a timeout, and an oversized response (declared or actual) is
 * rejected so a broken or malicious URL cannot hold the run hostage or flood
 * memory.
 */
export async function fetchImportedConfig(
  url: string,
  options: FetchConfigOptions = {}
): Promise<string> {
  const shown = redactUrl(url);
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(url)?.[1]?.toLowerCase();
  if (scheme !== 'http' && scheme !== 'https') {
    throw new CliUsageError(`--import-url expects an http(s) URL, got '${shown}'`);
  }
  if (scheme !== 'https') {
    throw new CliUsageError(
      `--import-url requires an https URL, got '${shown}' — the downloaded config runs ` +
        'commands on every prompt, so it must not travel over plain http.'
    );
  }
  if (/^https:\/\/[^/?#]*@/i.test(url)) {
    throw new CliUsageError(
      `--import-url cannot send a user name or password ('${shown}'); ` +
        'use a URL that needs none, such as a raw gist link.'
    );
  }

  const timeoutMs = options.timeoutMs ?? IMPORT_FETCH_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? IMPORT_FETCH_MAX_BYTES;

  let response: Response;
  try {
    const signal = AbortSignal.timeout(timeoutMs);
    let current = url;
    for (let hop = 0; ; hop++) {
      response = await fetch(current, { signal, redirect: 'manual' });
      const location =
        response.status >= 300 && response.status < 400 && response.headers.get('location');
      if (!location) break;
      await response.body?.cancel();
      if (hop === IMPORT_MAX_REDIRECTS) {
        throw new CliRunError(
          `Could not fetch '${shown}': more than ${IMPORT_MAX_REDIRECTS} redirects`
        );
      }
      const next = new URL(location, current);
      if (next.protocol !== 'https:') {
        throw new CliRunError(
          `Could not fetch '${shown}': redirected to a non-https URL ${redactUrl(next.href)}`
        );
      }
      if (next.username || next.password) {
        throw new CliRunError(
          `Could not fetch '${shown}': redirected to a URL with a user name or password ` +
            `(${redactUrl(next.href)}), which --import-url does not send.`
        );
      }
      current = next.href;
    }
  } catch (err) {
    if (err instanceof CliRunError) throw err;
    // AbortSignal.timeout rejects with a TimeoutError DOMException on timeout.
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new CliRunError(`Could not fetch '${shown}': request timed out after ${timeoutMs}ms`);
    }
    throw new CliRunError(`Could not fetch '${shown}': ${redactUrlText(errorMessage(err))}`);
  }
  if (!response.ok) {
    throw new CliRunError(`Could not fetch '${shown}': HTTP ${response.status}`);
  }

  // A declared content-length is a cheap first gate; the actual byte count is
  // the real check, so a lying or chunked server cannot sneak past.
  const declaredSize = Number(response.headers.get('content-length') ?? '0');
  if (declaredSize > maxBytes) {
    throw new CliRunError(
      `Could not fetch '${shown}': server reports ${declaredSize} bytes, ` +
        `above the ${maxBytes} byte limit.`
    );
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body?.getReader();
  if (reader) {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw new CliRunError(`Could not fetch '${shown}': config exceeds ${maxBytes} bytes`);
        }
        chunks.push(value);
      }
    } catch (err) {
      if (err instanceof CliRunError) throw err;
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        throw new CliRunError(`Could not fetch '${shown}': request timed out after ${timeoutMs}ms`);
      }
      throw new CliRunError(`Could not fetch '${shown}': ${redactUrlText(errorMessage(err))}`);
    } finally {
      reader.releaseLock();
    }
  }

  const content = Buffer.concat(chunks).toString('utf8');
  if (content.trim().length === 0) {
    throw new CliRunError(`'${shown}' returned no config content`);
  }
  if (content.trimStart().startsWith('<')) {
    throw new CliRunError(`'${shown}' returned HTML, not a TOML config — use the raw file URL.`);
  }
  return content;
}

/**
 * Every line of `toml` that may set a command Starship runs on every prompt: a
 * `command`, `when` or `shell` key in any form (dotted, quoted, inline table),
 * a `custom` table header, and the rest of a multi-line string or array such
 * a key starts.
 */
export function customCommands(toml: string): string[] {
  const lines = toml.split(/\r?\n/);
  const found: string[] = [];
  const key = /(^|[\s.{,])["']?(command|when|shell)["']?\s*=/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trimStart().startsWith('#')) continue;
    const header = /^\s*\[\[?[^\]]*\bcustom\b/.test(line);
    const escapedKey = /^[^=]*\\[uU]/.test(line) || /^\s*\[[^\]]*\\[uU]/.test(line);
    if (!header && !escapedKey && !key.test(line)) continue;
    found.push(line.trim());
    if (header || !line.includes('=')) continue;
    let value = scanValue(line.slice(line.indexOf('=') + 1), { depth: 0, multiline: null });
    while ((value.depth > 0 || value.multiline) && ++i < lines.length) {
      found.push(lines[i]!.trim());
      value = scanValue(lines[i]!, value);
    }
  }
  return found;
}

interface ValueScan {
  depth: number;
  multiline: '"""' | "'''" | null;
}

function scanValue(text: string, from: ValueScan): ValueScan {
  let { depth, multiline } = from;
  let i = 0;
  while (i < text.length) {
    if (multiline) {
      if (multiline === '"""' && text[i] === '\\') {
        i += 2;
      } else if (text.startsWith(multiline, i)) {
        while (text[i] === multiline[0]) i++;
        multiline = null;
      } else {
        i++;
      }
      continue;
    }
    const c = text[i];
    if (c === '#') break;
    if (text.startsWith('"""', i) || text.startsWith("'''", i)) {
      multiline = text.slice(i, i + 3) as '"""' | "'''";
      i += 3;
    } else if (c === '"' || c === "'") {
      i++;
      while (i < text.length && text[i] !== c) i += c === '"' && text[i] === '\\' ? 2 : 1;
      i++;
    } else {
      if (c === '[') depth++;
      else if (c === ']') depth--;
      i++;
    }
  }
  return { depth, multiline };
}
