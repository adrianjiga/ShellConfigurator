import * as os from 'node:os';
import * as path from 'node:path';

/**
 * The user's home directory. `homeDir()` returns an empty HOME as-is, which
 * would put every config under the current folder; the passwd entry is used then.
 */
export function homeDir(): string {
  return os.homedir() || os.userInfo().homedir;
}

/**
 * Resolves an XDG base directory, favouring the live environment over the
 * spec fallback. Resolved per call so env changes are seen immediately, which
 * is what tests rely on.
 */
export function xdgBaseDir(envName: string, fallback: string): string {
  const value = process.env[envName]?.trim();
  // The XDG spec says relative paths are invalid and must be ignored.
  return value && path.isAbsolute(value) ? value : fallback;
}

/** `$XDG_CONFIG_HOME` (default `~/.config`), where shell and terminal configs live. */
export function configHome(): string {
  return xdgBaseDir('XDG_CONFIG_HOME', path.join(homeDir(), '.config'));
}

/**
 * `$XDG_STATE_HOME` (default `~/.local/state`) plus the app directory. Lives
 * for durable local state like the run history (`history.jsonl`).
 */
export function stateDir(): string {
  return path.join(
    xdgBaseDir('XDG_STATE_HOME', path.join(homeDir(), '.local', 'state')),
    'shell-configurator'
  );
}

/** `$XDG_CACHE_HOME` (default `~/.cache`) plus the app directory, for the font store. */
export function cacheDir(): string {
  return path.join(
    xdgBaseDir('XDG_CACHE_HOME', path.join(homeDir(), '.cache')),
    'shell-configurator'
  );
}
