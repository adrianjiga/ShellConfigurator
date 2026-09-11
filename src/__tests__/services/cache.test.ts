import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cachedFont,
  cacheFont,
  fontCachePath,
  pinnedDigest,
  sha256Digest,
} from '../../services/cache.ts';

let tmpDir: string;
const savedEnv = { ...process.env };

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shellconf-cache-'));
  process.env.XDG_CACHE_HOME = tmpDir;
});
afterEach(() => {
  process.env = { ...savedEnv };
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('sha256Digest', () => {
  it('matches a known vector', () => {
    expect(sha256Digest(Buffer.from('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });
});

describe('fontCachePath', () => {
  it('points at <cacheDir>/fonts/<id>.zip', () => {
    expect(fontCachePath('JetBrainsMono')).toBe(
      path.join(tmpDir, 'shell-configurator', 'fonts', 'JetBrainsMono.zip')
    );
  });
});

describe('cacheFont / pinnedDigest / cachedFont', () => {
  it('writes the archive and pins its SHA-256, returning the digest', () => {
    const buffer = Buffer.from('fake font zip bytes');

    const digest = cacheFont('JetBrainsMono', buffer);

    expect(digest).toBe(sha256Digest(buffer));
    expect(fontCachePath('JetBrainsMono')).includes('JetBrainsMono.zip');
    expect(JSON.stringify(fs.readFileSync(fontCachePath('JetBrainsMono'), 'utf8'))).toContain(
      'fake font zip'
    );
    expect(pinnedDigest('JetBrainsMono')).toBe(digest);
  });

  it('reports the pin even if the archive is gone', () => {
    cacheFont('FiraCode', Buffer.from('bytes'));
    fs.rmSync(fontCachePath('FiraCode'));

    expect(pinnedDigest('FiraCode')).not.toBeNull();
    expect(cachedFont('FiraCode')).toBeNull();
  });

  it('returns null before anything has been cached', () => {
    expect(pinnedDigest('Meslo')).toBeNull();
    expect(cachedFont('Meslo')).toBeNull();
  });

  it('returns a usable CachedFont for a verified archive', () => {
    const buffer = Buffer.from('verified archive');
    const digest = cacheFont('Hack', buffer);

    const cached = cachedFont('Hack');

    expect(cached).toEqual({
      id: 'Hack',
      path: fontCachePath('Hack'),
      digest,
      bytes: buffer.byteLength,
    });
  });

  it('treats a tampered archive as absent instead of returning corrupted bytes', () => {
    cacheFont('SourceCodePro', Buffer.from('good bytes'));
    fs.writeFileSync(fontCachePath('SourceCodePro'), Buffer.from('evil bytes'));

    expect(cachedFont('SourceCodePro')).toBeNull();
    expect(pinnedDigest('SourceCodePro')).not.toBeNull();
  });

  it('overwrites a stale pin when the same font is cached again', () => {
    const first = cacheFont('CascadiaCode', Buffer.from('version one'));
    const second = cacheFont('CascadiaCode', Buffer.from('version two'));

    expect(second).not.toBe(first);
    expect(pinnedDigest('CascadiaCode')).toBe(second);
    expect(cachedFont('CascadiaCode')?.digest).toBe(second);
  });
});
