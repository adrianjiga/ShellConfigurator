#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as nodePath from 'node:path';
import { requireScratchHome } from './smokeHome.mjs';

// Headless-apply CI leg: after wizardSmoke has installed Starship into the
// scratch HOME, drive the real `apply` subcommand and assert the post-install
// `Verify config` task actually ran and succeeded (starship print-config).
const homeDir = requireScratchHome();
const entry = nodePath.resolve('dist/index.js');

// wizardSmoke installed the binary here; the apply process must see it or it
// would try to reinstall instead of verifying.
process.env.PATH = `${nodePath.join(homeDir, '.local', 'bin')}:${process.env.PATH}`;

function run(args) {
  return execFileSync(process.execPath, [entry, ...args], { encoding: 'utf8' });
}

try {
  const out = run(['apply', '--shells', 'bash', '--no-nerd-font']);

  assert.ok(out.includes('Verify config'), `apply plan missing the verify task:\n${out}`);
  assert.ok(out.includes('verified'), `verify produced no result note:\n${out}`);
  assert.ok(!/FAIL/.test(out), `apply reported a failed task:\n${out}`);

  console.log('\nHeadless apply smoke passed.');
} catch (err) {
  console.error(`FAIL headless apply smoke: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
