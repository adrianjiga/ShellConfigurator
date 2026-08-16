#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { parse } from '@iarna/toml';
import {
  detectPackageManagerAsync,
  detectInstalledShellsAsync,
  isStarshipInstalledAsync,
} from '../dist/services/detector.js';
import { generateToml } from '../dist/generators/starship.js';
import { applyShellConfig } from '../dist/generators/shellRc.js';
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
      colorScheme: 'pastel',
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

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll smoke checks passed.');
