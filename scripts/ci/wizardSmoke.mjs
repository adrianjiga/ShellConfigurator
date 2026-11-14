#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import * as nodePath from 'node:path';
import { promisify } from 'node:util';
import { render } from 'ink-testing-library';
import React from 'react';
import { App } from '../../dist/app.js';
import { getMissingStarshipPathDir } from '../../dist/services/installer.js';
import { assertRcWired, assertStarshipConfig, requireScratchHome } from './smokeHome.mjs';

const execFileP = promisify(execFile);
const homeDir = requireScratchHome();
const ENTER = '\r';
const DOWN = '\u001B[B';

const instance = render(React.createElement(App, {}));
const show = () => instance.lastFrame() ?? '';
let unmounted = false;

function unmount() {
  if (unmounted) return;
  unmounted = true;
  instance.unmount();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForFrame(predicate, label, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate(show())) return;
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${label}:\n${show()}`);
}

async function press(key, expected, timeoutMs = 30000) {
  instance.stdin.write(key);
  if (expected) {
    await waitForFrame((frame) => frame.includes(expected), expected, timeoutMs);
    return;
  }
  // Wait briefly for the frame to react rather than always sleeping a fixed
  // pause; a key that had no visible effect (e.g. at the end of a list) just
  // falls through once the grace period passes.
  const before = show();
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (show() !== before) return;
    await sleep(150);
  }
}

try {
  await waitForFrame((frame) => frame.includes('Package manager:'), 'WelcomeScreen detection');
  await press(ENTER, 'Nerd Font check');
  await press(DOWN);
  await press(DOWN);
  await press(ENTER, 'Choose a starting preset');
  await press(ENTER, 'Left prompt segments');
  await press(ENTER, 'Right prompt segments');
  await press(ENTER, 'Style options');
  await press(ENTER, '[installed]');
  await press(ENTER, 'Review your configuration');

  const review = show();
  assert.ok(review.includes('Starship'), 'review missing Starship task');
  assert.ok(review.includes('Write config files'), 'review missing config task');
  assert.ok(review.includes('Configure bash'), 'review missing bash rc task');

  await press(ENTER, 'to exit', 240000);

  const done = show();
  assert.ok(done.includes('All done!'), `install reported errors:\n${done}`);

  const rcLines = assertRcWired(nodePath.join(homeDir, '.bashrc'), 'bash');
  assert.ok(
    rcLines.includes(`export PATH='${nodePath.join(homeDir, '.local', 'bin')}':"$PATH"`),
    `.bashrc missing PATH fix-up\nPATH=${process.env.PATH}\n` +
      `getMissingStarshipPathDir()=${getMissingStarshipPathDir()}\nrcLines:\n${rcLines}`
  );

  const perShellConfig = nodePath.join(homeDir, '.config', 'starship', 'bash.toml');
  assertStarshipConfig(perShellConfig, 'bash config');
  assert.ok(
    readFileSync(perShellConfig, 'utf8').includes('$character'),
    'bash config missing $character'
  );

  const binary = nodePath.join(homeDir, '.local', 'bin', 'starship');
  assert.ok(existsSync(binary), 'starship binary missing');
  const { stdout } = await execFileP(binary, ['--version']);
  assert.match(stdout, /^starship\s+\d+\.\d+\.\d+/m, `bad version output: ${stdout}`);

  unmount();
  console.log('\nWizard smoke passed.');
  process.exit(0);
} catch (err) {
  const last = show();
  console.error(`FAIL wizard smoke: ${err instanceof Error ? err.message : String(err)}`);
  if (last) console.error(`Last frame:\n${last}`);
  unmount();
  process.exit(1);
}
