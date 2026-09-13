#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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
  const plan = run(['apply', '--adopt', '--shells', 'zsh', '--dry-run']);
  assert.ok(plan.includes('Config to keep'), 'apply --adopt dry-run lost the keep-plan');
  assert.ok(
    plan.includes('no per-shell TOML is generated'),
    'apply --adopt reused the per-shell TOML'
  );
  assert.ok(!plan.includes('installed'), 'dry run claims an install happened');

  console.log('\nmacOS headless smoke passed.');
} catch (err) {
  console.error(`FAIL macOS headless smoke: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
