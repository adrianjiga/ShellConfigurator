import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Resolves an XDG base directory, favouring the live environment over the
 * spec fallback. Resolved per call so env changes are seen immediately, which
 * is what tests rely on.
 */
function xdgBaseDir(envName: string, fallback: string): string {
  const value = process.env[envName]?.trim();
  return value ? value : fallback;
}

/**
 * `$XDG_STATE_HOME` (default `~/.local/state`) plus the app directory. Lives
 * for durable local state like the run history (`history.jsonl`).
 */
export function stateDir(): string {
  return path.join(
    xdgBaseDir('XDG_STATE_HOME', path.join(os.homedir(), '.local', 'state')),
    'shell-configurator'
  );
}

/** `$XDG_CACHE_HOME` (default `~/.cache`) plus the app directory, for the font store. */
export function cacheDir(): string {
  return path.join(
    xdgBaseDir('XDG_CACHE_HOME', path.join(os.homedir(), '.cache')),
    'shell-configurator'
  );
}
