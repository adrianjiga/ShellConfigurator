#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as nodePath from 'node:path';
import { parse } from '@iarna/toml';
import { requireScratchHome } from './smokeHome.mjs';

// macOS-only headless smoke (M3): exercises the darwin code paths — brew
// package-manager detection, getNerdFontsDir-branch config writes — through the
// real dist/ entrypoint, but inside a scratch HOME so nothing on the runner is
// installed or modified. build happens just before, in the workflow step.
const homeDir = requireScratchHome();
const entry = nodePath.resolve('dist/index.js');

function run(args) {
  return execFileSync(process.execPath, [entry, ...args], { encoding: 'utf8' });
}

try {
  // generate: render a TOML to stdout (brew detection runs, but nothing installs).
  const generated = run([
    'generate',
    '--preset',
    'pastel-powerline',
    '--shells',
    'zsh',
    '--no-nerd-font',
  ]);
  assert.ok(generated.includes('format = "'), 'generate printed no TOML');
  assert.ok(generated.includes('$character'), 'generate missing $character');

  // generate -o/--export: both artifacts land under the scratch HOME.
  const tomlPath = nodePath.join(homeDir, 'generated.toml');
  const cardPath = nodePath.join(homeDir, 'card.json');
  run(['generate', '--preset', 'pastel-powerline', '-o', tomlPath, '--export', cardPath]);
  assert.ok(existsSync(tomlPath), 'generate -o did not write the TOML');
  assert.ok(existsSync(cardPath), 'generate --export did not write the card');
  const parsed = parse(readFileSync(tomlPath, 'utf8'));
  assert.equal(typeof parsed.format, 'string', 'written TOML unparseable');

  // apply --dry-run --adopt: the keep-config plan prints, no installs happen.
  const sharedConfig = nodePath.join(homeDir, '.config', 'starship.toml');
  mkdirSync(nodePath.dirname(sharedConfig), { recursive: true });
  writeFileSync(sharedConfig, 'format = "$all"\n');
  const plan = run(['apply', '--adopt', '--shells', 'zsh', '--dry-run']);
  assert.ok(plan.includes('Config to keep:'), 'apply --adopt dry-run lost the keep-plan');
  assert.ok(!plan.includes('Generated starship.toml'), 'apply --adopt generated a TOML');
  rmSync(sharedConfig);
  assert.ok(!plan.includes('installed'), 'dry run claims an install happened');

  // Real headless apply: installs Starship (brew), writes the zsh config and rc
  // under the scratch HOME, and must run the post-install Verify config task.
  const applied = run(['apply', '--shells', 'zsh', '--no-nerd-font']);
  assert.ok(applied.includes('Verify config'), `apply plan missing the verify task:\n${applied}`);
  assert.ok(applied.includes('verified'), `apply did not verify the config:\n${applied}`);
  assert.ok(!applied.includes('FAIL'), `apply reported a failed task:\n${applied}`);

  const zshrc = readFileSync(nodePath.join(homeDir, '.zshrc'), 'utf8');
  assert.ok(zshrc.includes('# Added by ShellConfigurator'), '.zshrc missing the banner');
  assert.ok(zshrc.includes('export STARSHIP_CONFIG='), '.zshrc missing STARSHIP_CONFIG');
  assert.ok(zshrc.includes('eval "$(starship init zsh)"'), '.zshrc missing the init line');
  const zshConfig = nodePath.join(homeDir, '.config', 'starship', 'zsh.toml');
  assert.ok(existsSync(zshConfig), 'apply did not write the zsh config');
  assert.equal(
    typeof parse(readFileSync(zshConfig, 'utf8')).format,
    'string',
    'zsh config unparseable'
  );

  console.log('\nmacOS headless smoke passed.');
} catch (err) {
  console.error(`FAIL macOS headless smoke: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
