import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cachedFont,
  cachedStarshipVersion,
  cacheFont,
  fontCachePath,
  forgetStarshipVersion,
  pinnedDigest,
  recordStarshipVersion,
  sha256Digest,
} from '../../services/cache.ts';
import { cacheDir } from '../../services/paths.ts';
import { restoreEnv } from '../helpers/env.ts';

let tmpDir: string;
const savedEnv = { ...process.env };

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shellconf-cache-'));
  process.env.XDG_CACHE_HOME = tmpDir;
});
afterEach(() => {
  restoreEnv(savedEnv);
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
      buffer,
    });
    expect(cached?.buffer.equals(buffer)).toBe(true);
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

describe('cached font without a usable pin', () => {
  it('treats an archive with no pin file as absent', () => {
    fs.mkdirSync(path.dirname(fontCachePath('Hack')), { recursive: true });
    fs.writeFileSync(fontCachePath('Hack'), 'bytes');
    expect(cachedFont('Hack')).toBeNull();
  });

  it('treats an empty pin file as no pin', () => {
    cacheFont('Hack', Buffer.from('bytes'));
    fs.writeFileSync(fontCachePath('Hack').replace(/\.zip$/, '.sha256'), '\n');
    expect(pinnedDigest('Hack')).toBeNull();
    expect(cachedFont('Hack')).toBeNull();
  });
});

describe('starship version record', () => {
  it('is null before any version was recorded', () => {
    expect(cachedStarshipVersion()).toBeNull();
  });

  it('creates the cache folder and reads back what it recorded', () => {
    recordStarshipVersion('starship 1.27.0');
    expect(fs.existsSync(cacheDir())).toBe(true);
    expect(cachedStarshipVersion()).toBe('starship 1.27.0');
  });

  it('forgets a recorded version, and tolerates there being none', () => {
    recordStarshipVersion('starship 1.27.0');
    forgetStarshipVersion();
    expect(cachedStarshipVersion()).toBeNull();
    expect(() => forgetStarshipVersion()).not.toThrow();
  });

  it('treats an empty record as none', () => {
    fs.mkdirSync(cacheDir(), { recursive: true });
    fs.writeFileSync(path.join(cacheDir(), 'starship.version'), '  \n');
    expect(cachedStarshipVersion()).toBeNull();
  });

  it('rethrows a read error that is not a missing file', () => {
    fs.mkdirSync(path.join(cacheDir(), 'starship.version'), { recursive: true });
    expect(() => cachedStarshipVersion()).toThrow(/EISDIR/);
  });
});
