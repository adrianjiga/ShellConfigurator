#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import * as nodePath from 'node:path';
import { parse } from '@iarna/toml';
import {
  detectPackageManagerAsync,
  detectInstalledShellsAsync,
  isStarshipInstalledAsync,
} from '../dist/services/detector.js';
import { generateToml } from '../dist/generators/starship.js';
import {
  applyShellConfig,
  resetSharedShellConfig,
  getShellConfigPath,
} from '../dist/generators/shellRc.js';
import { getShell } from '../dist/config/shells.js';
import { PRESETS } from '../dist/config/presets.js';
import { DEFAULT_STATE } from '../dist/types.js';

const expectedPm = process.env.EXPECTED_PM;
let failures = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`FAIL ${name}: ${err instanceof Error ? err.message : err}`);
  }
}

// --- Detection (non-destructive reads) ---

const pm = await detectPackageManagerAsync();
console.log(`detectPackageManager -> ${pm}`);
if (expectedPm) {
  await check(`package manager is ${expectedPm}`, () => assert.equal(pm, expectedPm));
} else {
  console.log(`WARN EXPECTED_PM not set; skipping package manager assertion`);
}

await check('detects at least bash as an installed shell', async () => {
  const shells = await detectInstalledShellsAsync();
  assert.ok(shells.includes('bash'), `expected bash in ${shells.join(', ')}`);
});

await check('does not detect starship in a fresh container', async () => {
  assert.equal((await isStarshipInstalledAsync()).installed, false);
});

// --- Config generation (pure) ---

const osReleaseId = (() => {
  try {
    return readFileSync('/etc/os-release', 'utf8')
      .match(/^ID=(.+)$/m)?.[1]
      ?.replace(/["']/g, '');
  } catch {
    return null;
  }
})();
console.log(`os-release ID -> ${osReleaseId ?? '(unknown)'}`);

await check('generateToml produces parseable TOML for every preset', () => {
  for (const preset of PRESETS) {
    const state = {
      ...DEFAULT_STATE,
      preset: preset.id,
      hasNerdFont: preset.requiresNerdFont,
      leftModules: preset.leftModules ?? [],
      rightModules: preset.rightModules ?? [],
      characterSymbol: 'lambda',
      // Exercise each preset's own theme rather than a fixed one, so a palette
      // or powerline format that breaks the TOML is caught here.
      palette: preset.palette,
      powerline: preset.powerline,
    };
    const toml = generateToml(state);
    assert.ok(toml.includes('format'), `preset ${preset.id} missing format line`);
    const parsed = parse(toml);
    assert.equal(typeof parsed.format, 'string', `preset ${preset.id} format not parseable`);
  }
});

// --- RC generation against a scratch HOME (filesystem integration) ---

await check('applyShellConfig writes banner + init line and is idempotent', () => {
  const rcPath = `${process.env.HOME}/.bashrc`;
  if (existsSync(rcPath)) {
    throw new Error(`${rcPath} already exists; refusing to run against an unclean HOME`);
  }

  const first = applyShellConfig('bash');
  assert.equal(first.applied, true);

  const content = readFileSync(rcPath, 'utf8');
  assert.ok(content.includes('# Added by ShellConfigurator'), 'missing banner');
  assert.ok(content.includes('eval "$(starship init bash)"'), 'missing init line');

  const second = applyShellConfig('bash');
  assert.equal(second.applied, false);
  assert.equal(second.note, 'already configured');
});

// --- Nushell manual command must pin STARSHIP_CONFIG to its per-shell config ---
// No `nu` binary in the container, so verify the command shape and path resolution.

await check('nushell manual command resolves to its own per-shell config', () => {
  const nu = getShell('nushell');
  assert.ok(nu, 'nushell shell def missing');
  assert.equal(nu.rcFile, null, 'nushell has no rc file (manual setup)');
  const manual = applyShellConfig('nushell');
  assert.equal(manual.applied, false, 'nushell must not be auto-configured');
  assert.ok(manual.note, 'nushell manualNote missing');
  // The env pin must sort before starship.nu so it is set before the prompt hooks run.
  assert.ok(nu.initLine.includes('starship-config.nu'), 'command missing autoload env pin');
  assert.ok(nu.initLine.includes('STARSHIP_CONFIG'), 'command missing STARSHIP_CONFIG');
  assert.ok(nu.initLine.includes('starship init nu'), 'command missing starship init');

  // `path dirname` on default-config-dir + join must equal what writeShellConfig writes.
  const configHome =
    process.env.XDG_CONFIG_HOME?.trim() || nodePath.join(process.env.HOME, '.config');
  assert.equal(
    getShellConfigPath('nushell'),
    nodePath.join(configHome, 'starship', 'nushell.toml')
  );
});

// --- Per-shell and shared-config blocks must stay mutually exclusive across runs ---
// A shell switched between "configured" and "reset" must not end up with both
// blocks — the stale one would stomp on the other at startup.

await check('resetSharedShellConfig replaces a per-shell block with the unset guard', () => {
  const rcPath = nodePath.join(process.env.HOME, '.bashrc');
  if (!existsSync(rcPath)) {
    throw new Error(`${rcPath} missing; the applyShellConfig test must run first`);
  }

  const result = resetSharedShellConfig('bash');
  assert.equal(result.applied, true);

  const content = readFileSync(rcPath, 'utf8');
  assert.ok(content.includes('unset STARSHIP_CONFIG'), 'missing unset guard');
  assert.ok(!content.includes('export STARSHIP_CONFIG'), 'per-shell export survived reset');
  assert.ok(!content.includes('starship init bash'), 'init line survived reset');
});

await check('applyShellConfig repairs a rc left with only a stale unset guard', () => {
  const rcPath = nodePath.join(process.env.HOME, '.bashrc');
  if (!existsSync(rcPath)) {
    throw new Error(`${rcPath} missing; the resetSharedShellConfig test must run first`);
  }

  const result = applyShellConfig('bash');
  assert.equal(result.applied, true, 'repair should reconfigure the shell');

  const content = readFileSync(rcPath, 'utf8');
  assert.ok(!content.includes('unset STARSHIP_CONFIG'), 'stale unset guard survived');
  assert.ok(content.includes('export STARSHIP_CONFIG'), 'missing per-shell export');
  assert.ok(content.includes('starship init bash'), 'missing init line');
});

await check('applyShellConfig drops a stale fish unset guard and stays configured', () => {
  const fishRc = nodePath.join(process.env.HOME, '.config', 'fish', 'config.fish');
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
  const fishRc = nodePath.join(process.env.HOME, '.config', 'fish', 'config.fish');

  const result = resetSharedShellConfig('fish');
  assert.equal(result.applied, true);

  const content = readFileSync(fishRc, 'utf8');
  assert.ok(content.includes('set -e STARSHIP_CONFIG'), 'missing unset guard');
  assert.ok(!content.includes('set -gx STARSHIP_CONFIG'), 'per-shell wiring survived reset');
  assert.ok(!content.includes('starship init fish | source'), 'init line survived reset');
});

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll smoke checks passed.');
