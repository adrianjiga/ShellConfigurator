import { mkdirSync } from 'node:fs';
import * as nodePath from 'node:path';

export function die(message) {
  console.error(message);
  process.exit(2);
}

/** True when `dir` is `root` itself or somewhere below it. */
function isWithin(dir, root) {
  return dir === root || dir.startsWith(`${root}${nodePath.sep}`);
}

export function requireScratchHome() {
  if (!process.env.HOME) die('Refusing to run: HOME is not set.');
  const homeDir = nodePath.resolve(process.env.HOME);

  if (!isWithin(homeDir, '/tmp') || homeDir === '/tmp') {
    die(
      `Refusing to run: HOME (${homeDir}) is not a scratch directory under /tmp. This smoke ` +
        'harness writes into and deletes files under HOME. Run it with HOME=/tmp/<something>.'
    );
  }

  // The scratch home may not exist yet (e.g. HOME=/tmp/macos-smoke-home on a
  // fresh runner). Create it so config/rc writes land where expected.
  mkdirSync(homeDir, { recursive: true });
  process.env.HOME = homeDir;

  const xdgDefaults = {
    XDG_CONFIG_HOME: '.config',
    XDG_STATE_HOME: nodePath.join('.local', 'state'),
    XDG_CACHE_HOME: '.cache',
    XDG_DATA_HOME: nodePath.join('.local', 'share'),
  };
  for (const [name, fallback] of Object.entries(xdgDefaults)) {
    const value = process.env[name]?.trim();
    process.env[name] =
      value && isWithin(nodePath.resolve(value), homeDir)
        ? nodePath.resolve(value)
        : nodePath.join(homeDir, fallback);
  }
  return homeDir;
}
