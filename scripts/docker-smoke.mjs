#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as nodePath from 'node:path';
import { parse } from '@iarna/toml';
import { PRESETS } from '../dist/config/presets.js';
import { getShell, getShellBinary } from '../dist/config/shells.js';
import {
  applyShellConfig,
  backupSharedConfig,
  getSharedConfigPath,
  getShellConfigPath,
  resetSharedShellConfig,
  restoreConfigBackups,
  writeShellConfig,
} from '../dist/generators/shellRc.js';
import { generateToml } from '../dist/generators/starship.js';
import {
  detectCurrentShellAsync,
  detectInstalledShellsAsync,
  detectPackageManagerAsync,
  isStarshipInstalledAsync,
} from '../dist/services/detector.js';
import { commandExistsAsync } from '../dist/services/exec.js';
import { getMissingStarshipPathDir, SCRIPT_INSTALL_BIN_DIR } from '../dist/services/installer.js';
import { DEFAULT_STATE } from '../dist/types.js';

const expectedPm = process.env.EXPECTED_PM;
let failures = 0;

function die(message) {
  console.error(message);
  process.exit(2);
}

function requireScratchHome() {
  const homeDir = process.env.HOME;
  if (!homeDir) die('Refusing to run: HOME is not set.');

  const underTmp = homeDir.startsWith('/tmp/');
  const markerPath = nodePath.join(homeDir, '.shellconfigurator-smoke');
  const acknowledged = existsSync(markerPath);
  if (!underTmp && !acknowledged) {
    die(
      `Refusing to run: HOME (${homeDir}) is not a scratch directory. This smoke harness ` +
        'writes into and deletes files under HOME. Run it in a container with HOME under ' +
        `/tmp, or create '${markerPath}' to acknowledge a scratch home.`
    );
  }
  if (!os.homedir().startsWith(homeDir)) {
    die(
      `Refusing to run: os.homedir() resolves ${os.homedir()}, outside HOME (${homeDir}), ` +
        'which would redirect rc-file writes to the wrong location.'
    );
  }

  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  process.env.XDG_CONFIG_HOME = xdg?.startsWith(homeDir) ? xdg : nodePath.join(homeDir, '.config');
  return homeDir;
}

const homeDir = requireScratchHome();

if (!existsSync(new URL('../dist', import.meta.url))) {
  die('Missing ../dist — run "npm run build" before the smoke harness.');
}

async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`FAIL ${name}: ${err instanceof Error ? err.message : err}`);
  }
}

await check('node engine floor is met', () => {
  const major = Number(process.versions.node.split('.')[0]);
  assert.ok(major >= 22, `node ${process.version} is below the >=22 engines floor`);
});

await check('detects the configured package manager', async () => {
  const pm = await detectPackageManagerAsync();
  if (expectedPm) {
    assert.equal(pm, expectedPm);
  } else {
    console.log(`WARN EXPECTED_PM not set; package manager detected as ${pm}`);
  }
});

await check('detects at least bash as an installed shell', async () => {
  const shells = await detectInstalledShellsAsync();
  assert.ok(shells.includes('bash'), `expected bash in ${shells.join(', ')}`);
});

await check('reports only shells whose binaries exist', async () => {
  const shells = await detectInstalledShellsAsync();
  for (const id of shells) {
    assert.ok(
      await commandExistsAsync(getShellBinary(id)),
      `reported ${id} but ${getShellBinary(id)} is not on PATH`
    );
  }
});

await check('does not detect starship in a fresh container', async () => {
  assert.equal((await isStarshipInstalledAsync()).installed, false);
});

await check('detectCurrentShellAsync maps $SHELL to bash', async () => {
  const prev = process.env.SHELL;
  process.env.SHELL = '/bin/bash';
  try {
    assert.equal(await detectCurrentShellAsync(), 'bash');
  } finally {
    if (prev === undefined) delete process.env.SHELL;
    else process.env.SHELL = prev;
  }
});

await check('isStarshipInstalledAsync sees a starship shim on PATH', async () => {
  const shimDir = nodePath.join(homeDir, 'shim-bin');
  mkdirSync(shimDir, { recursive: true });
  writeFileSync(nodePath.join(shimDir, 'starship'), '#!/bin/sh\necho "starship 9.9.9"\n', {
    mode: 0o755,
  });
  const prevPath = process.env.PATH;
  process.env.PATH = `${shimDir}${nodePath.delimiter}${prevPath ?? ''}`;
  try {
    const detected = await isStarshipInstalledAsync();
    assert.equal(detected.installed, true);
    assert.ok(detected.version?.includes('9.9.9'), `unexpected version: ${detected.version}`);
  } finally {
    process.env.PATH = prevPath;
    rmSync(shimDir, { recursive: true, force: true });
  }
});

await check(
  'generateToml: every preset parses, wires $fill (not right_format), and covers its modules',
  () => {
    for (const preset of PRESETS) {
      const state = {
        ...DEFAULT_STATE,
        preset: preset.id,
        hasNerdFont: preset.requiresNerdFont,
        leftModules: preset.leftModules ?? [],
        rightModules: preset.rightModules ?? [],
        characterSymbol: 'lambda',
        palette: preset.palette,
        powerline: preset.powerline,
      };
      const toml = generateToml(state);
      assert.ok(toml.includes('format'), `preset ${preset.id} missing format line`);
      assert.ok(
        !toml.includes('right_format'),
        `preset ${preset.id} uses right_format instead of $fill`
      );
      const parsed = parse(toml);
      assert.equal(typeof parsed.format, 'string', `preset ${preset.id} format not parseable`);
      assert.equal(parsed.palette, preset.palette, `preset ${preset.id} palette mismatch`);
      assert.ok(
        parsed.format.includes('$character'),
        `preset ${preset.id} format missing $character`
      );
      for (const moduleId of [...(preset.leftModules ?? []), ...(preset.rightModules ?? [])]) {
        assert.ok(
          parsed[moduleId] !== undefined,
          `preset ${preset.id} missing [${moduleId}] block`
        );
        assert.ok(
          parsed.format.includes(`$${moduleId}`),
          `preset ${preset.id} format missing $${moduleId}`
        );
      }
      if ((preset.rightModules?.length ?? 0) > 0) {
        assert.ok(
          parsed.format.includes('$fill'),
          `preset ${preset.id} right modules without $fill`
        );
        assert.equal(parsed.fill?.symbol, ' ', `preset ${preset.id} [fill] block missing`);
      }
    }
  }
);

await check('applyShellConfig writes banner + init line and is idempotent', () => {
  const rcPath = nodePath.join(homeDir, '.bashrc');
  rmSync(rcPath, { force: true });

  const first = applyShellConfig('bash');
  assert.equal(first.applied, true);

  const content = readFileSync(rcPath, 'utf8');
  assert.ok(content.includes('# Added by ShellConfigurator'), 'missing banner');
  assert.ok(content.includes('eval "$(starship init bash)"'), 'missing init line');

  const second = applyShellConfig('bash');
  assert.equal(second.applied, false);
  assert.equal(second.note, 'already configured');
});

await check('nushell manual command resolves to its own per-shell config', () => {
  const nu = getShell('nushell');
  assert.ok(nu, 'nushell shell def missing');
  assert.equal(nu.rcFile, null, 'nushell has no rc file (manual setup)');
  const manual = applyShellConfig('nushell');
  assert.equal(manual.applied, false, 'nushell must not be auto-configured');
  assert.ok(manual.note, 'nushell manualNote missing');
  assert.ok(nu.initLine.includes('starship-config.nu'), 'command missing autoload env pin');
  assert.ok(nu.initLine.includes('STARSHIP_CONFIG'), 'command missing STARSHIP_CONFIG');
  assert.ok(nu.initLine.includes('starship init nu'), 'command missing starship init');

  const configHome =
    process.env.XDG_CONFIG_HOME?.trim() || nodePath.join(process.env.HOME, '.config');
  assert.equal(
    getShellConfigPath('nushell'),
    nodePath.join(configHome, 'starship', 'nushell.toml')
  );
});

await check('resetSharedShellConfig replaces a per-shell block with the unset guard', () => {
  const rcPath = nodePath.join(homeDir, '.bashrc');
  rmSync(rcPath, { force: true });
  applyShellConfig('bash');

  const result = resetSharedShellConfig('bash');
  assert.equal(result.applied, true);

  const content = readFileSync(rcPath, 'utf8');
  assert.ok(content.includes('unset STARSHIP_CONFIG'), 'missing unset guard');
  assert.ok(!content.includes('export STARSHIP_CONFIG'), 'per-shell export survived reset');
  assert.ok(!content.includes('starship init bash'), 'init line survived reset');
});

await check('applyShellConfig repairs a rc left with only a stale unset guard', () => {
  const rcPath = nodePath.join(homeDir, '.bashrc');
  rmSync(rcPath, { force: true });
  assert.equal(resetSharedShellConfig('bash').applied, true, 'unset guard not written');

  const result = applyShellConfig('bash');
  assert.equal(result.applied, true, 'repair should reconfigure the shell');

  const content = readFileSync(rcPath, 'utf8');
  assert.ok(!content.includes('unset STARSHIP_CONFIG'), 'stale unset guard survived');
  assert.ok(content.includes('export STARSHIP_CONFIG'), 'missing per-shell export');
  assert.ok(content.includes('starship init bash'), 'missing init line');
});

await check('applyShellConfig drops a stale fish unset guard and stays configured', () => {
  const fishRc = nodePath.join(homeDir, '.config', 'fish', 'config.fish');
  const fishConfig = getShellConfigPath('fish');
  rmSync(fishRc, { force: true });
  mkdirSync(nodePath.dirname(fishRc), { recursive: true });
  writeFileSync(
    fishRc,
    [
      '',
      '# Added by ShellConfigurator',
      `set -gx STARSHIP_CONFIG ${fishConfig}`,
      'starship init fish | source',
      '',
      '# Added by ShellConfigurator',
      'set -e STARSHIP_CONFIG',
      '',
    ].join('\n')
  );

  const result = applyShellConfig('fish');
  assert.equal(result.applied, false);
  assert.equal(result.note, 'already configured');

  const content = readFileSync(fishRc, 'utf8');
  assert.ok(content.includes('set -gx STARSHIP_CONFIG'), 'per-shell wiring removed');
  assert.ok(content.includes('starship init fish | source'), 'init line removed');
  assert.ok(!content.includes('set -e STARSHIP_CONFIG'), 'stale unset guard survived');
});

await check('resetSharedShellConfig switches fish back to the shared config', () => {
  const fishRc = nodePath.join(homeDir, '.config', 'fish', 'config.fish');
  rmSync(fishRc, { force: true });
  assert.equal(applyShellConfig('fish').applied, true, 'fish not configured first');

  const result = resetSharedShellConfig('fish');
  assert.equal(result.applied, true);

  const content = readFileSync(fishRc, 'utf8');
  assert.ok(content.includes('set -e STARSHIP_CONFIG'), 'missing unset guard');
  assert.ok(!content.includes('set -gx STARSHIP_CONFIG'), 'per-shell wiring survived reset');
  assert.ok(!content.includes('starship init fish | source'), 'init line survived reset');
});

await check('getMissingStarshipPathDir flags ~/.local/bin when starship is unreachable', () => {
  const prevPath = process.env.PATH;
  process.env.PATH = '/usr/bin:/bin';
  try {
    assert.equal(getMissingStarshipPathDir(), null, 'no fix expected without the binary');
    mkdirSync(SCRIPT_INSTALL_BIN_DIR, { recursive: true });
    writeFileSync(nodePath.join(SCRIPT_INSTALL_BIN_DIR, 'starship'), '#!/bin/sh\nexit 0\n', {
      mode: 0o755,
    });
    try {
      const dir = getMissingStarshipPathDir();
      assert.ok(dir, 'expected the PATH fix-up directory');
      assert.ok(dir.endsWith(nodePath.join('.local', 'bin')), `unexpected dir: ${dir}`);
    } finally {
      rmSync(SCRIPT_INSTALL_BIN_DIR, { recursive: true, force: true });
    }
  } finally {
    process.env.PATH = prevPath;
  }
});

await check('writeShellConfig backs up and restoreConfigBackups restores', () => {
  const configBaseDir = nodePath.join(homeDir, '.config');
  const configDir = nodePath.join(configBaseDir, 'starship');
  rmSync(configBaseDir, { recursive: true, force: true });
  mkdirSync(configDir, { recursive: true });

  const bashCfg = getShellConfigPath('bash');
  writeFileSync(bashCfg, '# v1\n');
  const written = writeShellConfig('# v2\n', 'bash');
  assert.ok(written.backedUpTo, 'expected a backup of the pre-existing per-shell config');
  assert.equal(readFileSync(bashCfg, 'utf8'), '# v2\n');

  const fresh = writeShellConfig('# fresh\n', 'zsh');
  assert.equal(fresh.backedUpTo, undefined);

  const shared = getSharedConfigPath();
  writeFileSync(shared, '# shared-v1\n');
  const backup = backupSharedConfig();
  assert.ok(backup, 'expected a shared-config backup');
  writeFileSync(shared, '# shared-v2\n');

  const restored = restoreConfigBackups();
  assert.ok(
    restored.some((r) => r.what === 'bash'),
    'no per-shell config restored'
  );
  assert.ok(
    restored.some((r) => r.what === 'shared'),
    'no shared config restored'
  );
  assert.equal(readFileSync(bashCfg, 'utf8'), '# v1\n', 'per-shell config not restored');
  assert.equal(readFileSync(shared, 'utf8'), '# shared-v1\n', 'shared config not restored');

  rmSync(configBaseDir, { recursive: true, force: true });
});

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll smoke checks passed.');
