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
  it('creates its scratch dir when the app cache dir does not exist yet', async () => {
    // XDG_CACHE_HOME points at an existing dir whose shell-configurator child is
    // absent, which is the state of a fresh machine before any font is cached.
    process.env.XDG_CACHE_HOME = tmp;

    const scratch = await DEFAULT_PREVIEW_DEPS.createScratch();

    expect(fs.existsSync(scratch)).toBe(true);
    expect(scratch.startsWith(`${path.join(tmp, 'shell-configurator')}${path.sep}`)).toBe(true);

    await DEFAULT_PREVIEW_DEPS.cleanup(scratch);
  });
});
