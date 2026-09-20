#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import * as nodePath from 'node:path';
import { parse } from '@iarna/toml';
import { requireScratchHome } from './smokeHome.mjs';

// Headless-generate CI leg: drive the real `generate` subcommand from dist/ and
// assert the two publish paths — TOML to stdout, and the -o/--export artifacts —
// prove the headless CLI works before `apply` installs anything. Mirrors the
// generate assertions in macosSmoke.mjs so the Linux matrix exercises both.
const homeDir = requireScratchHome();
const entry = nodePath.resolve('dist/index.js');

function run(args) {
  return execFileSync(process.execPath, [entry, ...args], { encoding: 'utf8' });
}

try {
  const generated = run([
    'generate',
    '--preset',
    'pastel-powerline',
    '--shells',
    'bash',
    '--no-nerd-font',
  ]);
  assert.ok(generated.includes('format = "'), 'generate printed no TOML');
  assert.ok(generated.includes('$character'), 'generate missing $character');

  const tomlPath = nodePath.join(homeDir, 'generated.toml');
  const cardPath = nodePath.join(homeDir, 'card.json');
  run(['generate', '--preset', 'pastel-powerline', '-o', tomlPath, '--export', cardPath]);
  assert.ok(existsSync(tomlPath), 'generate -o did not write the TOML');
  assert.ok(existsSync(cardPath), 'generate --export did not write the card');
  assert.equal(
    typeof parse(readFileSync(tomlPath, 'utf8')).format,
    'string',
    'written TOML unparseable'
  );

  console.log('\nHeadless generate smoke passed.');
} catch (err) {
  console.error(
    `FAIL headless generate smoke: ${err instanceof Error ? err.message : String(err)}`
  );
  process.exit(1);
}
