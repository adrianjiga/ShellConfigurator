#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import * as nodePath from 'node:path';
import { runSmoke } from './smokeHome.mjs';

await runSmoke('Pack smoke', () => {
  const dir = mkdtempSync(nodePath.join(os.tmpdir(), 'shellconf-pack-'));
  try {
    const tarball = execFileSync('npm', ['pack', '--silent', '--pack-destination', dir], {
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .at(-1);
    execFileSync('tar', ['-xzf', nodePath.join(dir, tarball), '-C', dir]);
    const version = execFileSync(
      process.execPath,
      [nodePath.join(dir, 'package', 'dist', 'index.js'), '--version'],
      { encoding: 'utf8', cwd: dir }
    ).trim();
    const expected = JSON.parse(readFileSync('package.json', 'utf8')).version;
    assert.equal(version, expected, 'the packed CLI reports a different version');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
