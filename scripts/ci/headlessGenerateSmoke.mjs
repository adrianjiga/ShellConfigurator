#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import * as nodePath from 'node:path';
import { parse } from '@iarna/toml';
import { requireScratchHome, runCli, runSmoke } from './smokeHome.mjs';

// Headless-generate CI leg: drive the real `generate` subcommand from dist/ and
// assert the two publish paths — TOML to stdout, and the -o/--export artifacts.
const homeDir = requireScratchHome();

await runSmoke('Headless generate smoke', () => {
  const generated = runCli([
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
  runCli(['generate', '--preset', 'pastel-powerline', '-o', tomlPath, '--export', cardPath]);
  assert.ok(existsSync(tomlPath), 'generate -o did not write the TOML');
  assert.ok(existsSync(cardPath), 'generate --export did not write the card');
  assert.equal(
    typeof parse(readFileSync(tomlPath, 'utf8')).format,
    'string',
    'written TOML unparseable'
  );
});
