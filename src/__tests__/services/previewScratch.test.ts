import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PREVIEW_DEPS } from '../../services/preview.ts';

let tmp: string;
const originalXdgCache = process.env.XDG_CACHE_HOME;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-preview-'));
});

afterEach(() => {
  if (originalXdgCache === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = originalXdgCache;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('DEFAULT_PREVIEW_DEPS.createScratch', () => {
  it('uses the system temp dir and leaves the app cache alone', async () => {
    process.env.XDG_CACHE_HOME = tmp;

    const scratch = await DEFAULT_PREVIEW_DEPS.createScratch();
    try {
      expect(fs.existsSync(scratch)).toBe(true);
      expect(path.dirname(scratch)).toBe(os.tmpdir());
      expect(fs.existsSync(path.join(tmp, 'shell-configurator'))).toBe(false);
    } finally {
      await DEFAULT_PREVIEW_DEPS.cleanup(scratch);
    }
    expect(fs.existsSync(scratch)).toBe(false);
  });
});

describe('DEFAULT_PREVIEW_DEPS.scaffoldProject', () => {
  it("never commits into the user's repository when GIT_DIR is inherited", async () => {
    const real = path.join(tmp, 'real');
    fs.mkdirSync(real);
    execFileSync('git', ['init', '-q'], { cwd: real });
    const previous = process.env.GIT_DIR;
    process.env.GIT_DIR = path.join(real, '.git');
    try {
      const project = await DEFAULT_PREVIEW_DEPS.scaffoldProject(path.join(tmp, 'scratch'));
      expect(fs.existsSync(path.join(project, '.git'))).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = previous;
    }
    const commits = execFileSync('git', ['rev-list', '--all'], { cwd: real, encoding: 'utf8' });
    expect(commits.trim()).toBe('');
  });
});
