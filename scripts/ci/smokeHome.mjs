import { execFileSync } from 'node:child_process';
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

const entry = nodePath.resolve('dist/index.js');

/** Runs the built CLI; a failure carries the CLI's own output so CI shows why. */
export function runCli(args) {
  try {
    return execFileSync(process.execPath, [entry, ...args], { encoding: 'utf8' });
  } catch (err) {
    throw new Error(
      `shell-configurator ${args.join(' ')} exited ${err.status}:\n${err.stdout ?? ''}${err.stderr ?? ''}`
    );
  }
}

/** Runs one smoke and exits non-zero with its message when an assertion fails. */
export async function runSmoke(name, body) {
  try {
    await body();
    console.log(`\n${name} passed.`);
  } catch (err) {
    console.error(`FAIL ${name}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
