import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateToml } from '../../generators/starship.ts';
import { renderShare, shareableState, writeShareFile } from '../../services/share.ts';
import { parseState } from '../../services/state.ts';
import { DEFAULT_STATE, type WizardState } from '../../types.ts';

const tokyo: WizardState = {
  ...DEFAULT_STATE,
  preset: 'tokyo-night',
  palette: 'tokyo-night',
  hasNerdFont: true,
  selectedShells: ['zsh', 'fish'],
  nerdFontToInstall: { kind: 'install', id: 'Hack' },
  setDefaultShell: 'zsh',
  characterSymbol: 'lambda',
};

const block = (text: string, lang: string) =>
  new RegExp(`\`\`\`${lang}\\n([\\s\\S]*?)\\n\`\`\``).exec(text)![1];

describe('shareableState', () => {
  it('keeps the look and drops what belongs to this machine', () => {
    expect(shareableState(tokyo)).toMatchObject({
      preset: 'tokyo-night',
      characterSymbol: 'lambda',
      hasNerdFont: true,
      selectedShells: [],
      nerdFontToInstall: { kind: 'none' },
      setDefaultShell: null,
    });
  });
});

describe('renderShare', () => {
  it('gives the TOML and a card that rebuilds exactly that TOML', () => {
    const text = renderShare(tokyo);
    expect(text).toMatch(/^# Starship prompt: Tokyo Night\n/);
    expect(text).toContain('need a [Nerd Font]');
    expect(block(text, 'toml')).toBe(generateToml(tokyo).trimEnd());
    const card = parseState(block(text, 'json'));
    expect(generateToml(card)).toBe(generateToml(tokyo));
    expect(card.selectedShells).toEqual([]);
    expect(text).toContain('--shells <your shells>');
    expect(text).toContain('--no-nerd-font');
  });

  it('names a custom prompt and leaves out the font notes when it shows no icons', () => {
    const text = renderShare({ ...DEFAULT_STATE, preset: null, hasNerdFont: false });
    expect(text).toMatch(/^# Starship prompt: Custom\n/);
    expect(text).not.toContain('Nerd Font');
  });
});

describe('renderShare and the home folder', () => {
  it('shows the home folder in directory substitutions as ~, and says so', () => {
    const home = os.homedir();
    const text = renderShare({
      ...tokyo,
      directorySubstitutions: [{ from: `${home}/work/acme`, to: 'acme' }],
    });
    expect(text).not.toContain(home);
    expect(text).toContain('~/work/acme');
    expect(text).toContain('Your home folder is shown as `~`.');
    expect(renderShare(tokyo)).not.toContain('home folder');
  });
});

describe('writeShareFile', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shellconf-share-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('writes starship-prompt.md, then numbered names, never over an existing file', () => {
    fs.writeFileSync(path.join(dir, 'starship-prompt.md'), 'mine');
    expect(writeShareFile(tokyo, dir)).toBe(path.join(dir, 'starship-prompt-2.md'));
    expect(writeShareFile(tokyo, dir)).toBe(path.join(dir, 'starship-prompt-3.md'));
    expect(fs.readFileSync(path.join(dir, 'starship-prompt.md'), 'utf8')).toBe('mine');
    expect(fs.readFileSync(path.join(dir, 'starship-prompt-2.md'), 'utf8')).toBe(
      renderShare(tokyo)
    );
  });
});
