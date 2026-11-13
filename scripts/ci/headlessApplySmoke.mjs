#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as nodePath from 'node:path';
import { requireScratchHome, runCli, runSmoke } from './smokeHome.mjs';

// Headless-apply CI leg: drive the real `apply` subcommand and assert the
// post-install `Verify config` task actually ran and succeeded.
const homeDir = requireScratchHome();

// A script install (wizardSmoke, or apt/dnf here) lands in ~/.local/bin; the
// apply process must see it or it would try to reinstall instead of verifying.
process.env.PATH = `${nodePath.join(homeDir, '.local', 'bin')}:${process.env.PATH}`;

await runSmoke('Headless apply smoke', () => {
  const out = runCli(['apply', '--shells', 'bash', '--no-nerd-font']);

  assert.ok(out.includes('Verify config'), `apply plan missing the verify task:\n${out}`);
  assert.match(out, /verified \d+ config\(s\)/, `verify produced no result note:\n${out}`);
  assert.ok(!/FAIL/.test(out), `apply reported a failed task:\n${out}`);
});
