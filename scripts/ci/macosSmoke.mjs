#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import * as nodePath from 'node:path';
import {
  assertApplyVerified,
  assertGenerate,
  assertRcWired,
  assertStarshipConfig,
  requireScratchHome,
  runCli,
  runSmoke,
} from './smokeHome.mjs';

// macOS headless smoke: drives the real dist/ entrypoint through generate, an
// adopt dry run and a real apply, which installs Starship with brew. Config and
// rc writes stay in the scratch HOME.
const homeDir = requireScratchHome();

await runSmoke('macOS headless smoke', () => {
  assertGenerate(homeDir, 'zsh');

  // apply --dry-run --adopt: the keep-config plan prints, no installs happen.
  const sharedConfig = nodePath.join(homeDir, '.config', 'starship.toml');
  mkdirSync(nodePath.dirname(sharedConfig), { recursive: true });
  writeFileSync(sharedConfig, 'format = "$all"\n');
  const plan = runCli(['apply', '--adopt', '--shells', 'zsh', '--dry-run']);
  assert.ok(plan.includes('Config to keep:'), 'apply --adopt dry-run lost the keep-plan');
  assert.ok(!plan.includes('Generated starship.toml'), 'apply --adopt generated a TOML');
  rmSync(sharedConfig);
  assert.ok(!/\b(DONE|FAILED)\b/.test(plan), 'dry run reports a task as run');

  // Real headless apply: installs Starship (brew), writes the zsh config and rc
  // under the scratch HOME, and must run the post-install Verify config task.
  const applied = runCli(['apply', '--shells', 'zsh', '--no-nerd-font']);
  assertApplyVerified(applied);

  assertRcWired(nodePath.join(homeDir, '.zshrc'), 'zsh');
  assertStarshipConfig(nodePath.join(homeDir, '.config', 'starship', 'zsh.toml'), 'zsh config');
});
