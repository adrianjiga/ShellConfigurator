#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import * as nodePath from 'node:path';
import { promisify } from 'node:util';
import { parse } from '@iarna/toml';
import { render } from 'ink-testing-library';
import React from 'react';
import { App } from '../../dist/app.js';
import { getMissingStarshipPathDir } from '../../dist/services/installer.js';
import { requireScratchHome } from './smokeHome.mjs';

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

async function press(key) {
  instance.stdin.write(key);
  await sleep(150);
}

try {
  await waitForFrame((frame) => frame.includes('Package manager:'), 'WelcomeScreen detection');
  await press(ENTER);
  await waitForFrame((frame) => frame.includes('Nerd Font check'), 'fontcheck step');
  await press(DOWN);
  await press(DOWN);
  await press(ENTER);
  await waitForFrame((frame) => frame.includes('Choose a starting preset'), 'preset step');
  await press(ENTER);
  await waitForFrame((frame) => frame.includes('Left prompt segments'), 'segments_left step');
  await press(ENTER);
  await waitForFrame((frame) => frame.includes('Right prompt segments'), 'segments_right step');
  await press(ENTER);
  await waitForFrame((frame) => frame.includes('Style options'), 'style step');
  await press(ENTER);
  await waitForFrame((frame) => frame.includes('[installed]'), 'shell detection');
  await press(ENTER);
  await waitForFrame((frame) => frame.includes('Review your configuration'), 'review step');

  const review = show();
  assert.ok(review.includes('Starship'), 'review missing Starship task');
  assert.ok(review.includes('Write config files'), 'review missing config task');
  assert.ok(review.includes('Configure bash'), 'review missing bash rc task');

  await press(ENTER);
  await waitForFrame((frame) => frame.includes('to exit'), 'done screen', 240000);

  const done = show();
  assert.ok(done.includes('All done!'), `install reported errors:\n${done}`);

  const bashrc = nodePath.join(homeDir, '.bashrc');
  const rcLines = readFileSync(bashrc, 'utf8');
  assert.ok(rcLines.includes('# Added by ShellConfigurator'), '.bashrc missing banner');
  assert.ok(rcLines.includes('export STARSHIP_CONFIG='), '.bashrc missing STARSHIP_CONFIG');
  assert.ok(rcLines.includes('eval "$(starship init bash)"'), '.bashrc missing init line');
  assert.ok(
    rcLines.includes(`export PATH="${nodePath.join(homeDir, '.local', 'bin')}:$PATH"`),
    `.bashrc missing PATH fix-up\nPATH=${process.env.PATH}\n` +
      `getMissingStarshipPathDir()=${getMissingStarshipPathDir()}\nrcLines:\n${rcLines}`
  );

  const perShellConfig = nodePath.join(homeDir, '.config', 'starship', 'bash.toml');
  const toml = parse(readFileSync(perShellConfig, 'utf8'));
  assert.equal(typeof toml.format, 'string', 'bash config unparseable');
  assert.ok(toml.format.includes('$character'), 'bash config missing $character');

  const binary = nodePath.join(homeDir, '.local', 'bin', 'starship');
  assert.ok(existsSync(binary), 'starship binary missing');
  const { stdout } = await execFileP(binary, ['--version']);
  assert.match(stdout, /^starship\s+\d+\.\d+\.\d+/m, `bad version output: ${stdout}`);

  unmount();
  console.log('\nWizard smoke passed.');
} catch (err) {
  const last = show();
  console.error(`FAIL wizard smoke: ${err instanceof Error ? err.message : String(err)}`);
  if (last) console.error(`Last frame:\n${last}`);
  unmount();
  process.exit(1);
}
