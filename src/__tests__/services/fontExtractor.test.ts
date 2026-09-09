import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { extractFontFiles } from '../../services/fontExtractor.ts';

function zipBytes(zip: Uint8Array): Uint8Array {
  return new Uint8Array(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength));
}

function encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

describe('extractFontFiles', () => {
  it('extracts only font entries and flattens their paths to basenames', async () => {
    const zip = zipSync({
      'fonts/JetBrainsMono-Regular.otf': encode('otf'),
      'nested/deep/NerdFont-Regular.ttf': encode('ttf'),
      'README.md': encode('readme'),
      'assets/icon.woff2': encode('woff2'),
      'assets/icon.woff': encode('woff'),
    });

    const files = await extractFontFiles(zipBytes(zip));

    expect(files.map((file) => file.name).sort()).toEqual([
      'JetBrainsMono-Regular.otf',
      'NerdFont-Regular.ttf',
      'icon.woff',
      'icon.woff2',
    ]);
    expect(
      new TextDecoder().decode(files.find((f) => f.name === 'NerdFont-Regular.ttf')!.bytes)
    ).toBe('ttf');
  });

  it('returns an empty list when the archive holds no font files', async () => {
    const zip = zipSync({ 'README.md': encode('nothing') });

    await expect(extractFontFiles(zipBytes(zip))).resolves.toEqual([]);
  });

  it('rejects with a clear error when the bytes are not a zip archive', async () => {
    await expect(extractFontFiles(encode('not a zip'))).rejects.toThrow(
      'Could not extract font archive'
    );
  });
});
