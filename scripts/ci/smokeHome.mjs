import { existsSync } from 'node:fs';
import * as os from 'node:os';
import * as nodePath from 'node:path';

export function die(message) {
  console.error(message);
  process.exit(2);
}

export function requireScratchHome() {
  const homeDir = process.env.HOME;
  if (!homeDir) die('Refusing to run: HOME is not set.');

  const underTmp = homeDir.startsWith('/tmp/');
  const acknowledged = existsSync(nodePath.join(homeDir, '.shellconfigurator-smoke'));
  if (!underTmp && !acknowledged) {
    die(
      `Refusing to run: HOME (${homeDir}) is not a scratch directory. This smoke harness ` +
        'writes into and deletes files under HOME. Run it in a container with HOME under ' +
        `/tmp, or create '${nodePath.join(homeDir, '.shellconfigurator-smoke')}' to acknowledge ` +
        'a scratch home.'
    );
  }

  if (!os.homedir().startsWith(homeDir)) {
    die(
      `Refusing to run: os.homedir() resolves ${os.homedir()}, outside HOME (${homeDir}), ` +
        'which would redirect rc writes to the wrong location.'
    );
  }

  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  process.env.XDG_CONFIG_HOME = xdg?.startsWith(homeDir) ? xdg : nodePath.join(homeDir, '.config');
  return homeDir;
}
