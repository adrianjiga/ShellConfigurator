import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readTerminalFontFamily, wireTerminalFont } from '../../services/terminalFont.ts';

let tmp: string;
const originalXdg = process.env.XDG_CONFIG_HOME;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-terminal-'));
  process.env.XDG_CONFIG_HOME = tmp;
});

afterEach(() => {
  if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = originalXdg;
  fs.rmSync(tmp, { recursive: true, force: true });
});

function read(rel: string): string {
  return fs.readFileSync(path.join(tmp, rel), 'utf8');
}

function write(rel: string, content: string): void {
  const filePath = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

describe('wireTerminalFont', () => {
  it('creates a kitty config with the font family', () => {
    const result = wireTerminalFont('kitty', 'JetBrainsMono Nerd Font');

    expect(result.applied).toBe(true);
    expect(read('kitty/kitty.conf')).toBe('font_family JetBrainsMono Nerd Font\n');
  });

  it('replaces an existing kitty font and is idempotent', () => {
    write('kitty/kitty.conf', 'font_size 12\nfont_family Hack Nerd Font\n');

    const result = wireTerminalFont('kitty', 'FiraCode Nerd Font');
    expect(result.applied).toBe(true);
    expect(result.backedUpTo).toBeDefined();
    expect(read('kitty/kitty.conf')).toBe('font_size 12\nfont_family FiraCode Nerd Font\n');

    const again = wireTerminalFont('kitty', 'FiraCode Nerd Font');
    expect(again.applied).toBe(false);
    expect(again.note).toBe('font already set');
    expect(read('kitty/kitty.conf')).toBe('font_size 12\nfont_family FiraCode Nerd Font\n');
  });

  it('writes the ghostty font-family key', () => {
    const result = wireTerminalFont('ghostty', 'Hack Nerd Font');

    expect(result.applied).toBe(true);
    expect(read('ghostty/config')).toBe('font-family = Hack Nerd Font\n');
  });

  it('preserves the foot size suffix while replacing the family', () => {
    write('foot/foot.ini', '[main]\nfont=monospace:size=11\n');

    const result = wireTerminalFont('foot', 'FiraCode Nerd Font');

    expect(result.applied).toBe(true);
    expect(read('foot/foot.ini')).toBe('[main]\nfont=FiraCode Nerd Font:size=11\n');
  });

  it('creates a foot [main] section when missing', () => {
    wireTerminalFont('foot', 'Hack Nerd Font');

    expect(read('foot/foot.ini')).toBe('[main]\nfont=Hack Nerd Font\n');
  });

  it('creates an alacritty toml font table', () => {
    wireTerminalFont('alacritty', 'JetBrainsMono Nerd Font');

    expect(read('alacritty/alacritty.toml')).toBe('[font]\nfamily = "JetBrainsMono Nerd Font"\n');
  });

  it('updates only the family inside an existing alacritty [font] table', () => {
    write(
      'alacritty/alacritty.toml',
      '[window]\nopacity = 0.9\n\n[font]\nfamily = "Old"\nsize = 12\n'
    );

    wireTerminalFont('alacritty', 'FiraCode Nerd Font');

    expect(read('alacritty/alacritty.toml')).toBe(
      '[window]\nopacity = 0.9\n\n[font]\nfamily = "FiraCode Nerd Font"\nsize = 12\n'
    );
  });

  it('advises instead of editing a legacy alacritty.yml', () => {
    write('alacritty/alacritty.yml', 'font:\n  family: "Old"\n');

    const result = wireTerminalFont('alacritty', 'Hack Nerd Font');

    expect(result.applied).toBe(false);
    expect(result.note).toContain('alacritty.yml');
    expect(read('alacritty/alacritty.yml')).toBe('font:\n  family: "Old"\n');
  });

  it('never edits wezterm and returns the snippet instead', () => {
    const result = wireTerminalFont('wezterm', 'Hack Nerd Font');

    expect(result.applied).toBe(false);
    expect(result.note).toContain('config.font = wezterm.font("Hack Nerd Font")');
    expect(fs.existsSync(path.join(tmp, 'wezterm/wezterm.lua'))).toBe(false);
  });
});

describe('readTerminalFontFamily', () => {
  it('reads back the family written for each editable terminal', () => {
    wireTerminalFont('kitty', 'Kitty Font');
    wireTerminalFont('ghostty', 'Ghostty Font');
    wireTerminalFont('foot', 'Foot Font');
    wireTerminalFont('alacritty', 'Alacritty Font');

    expect(readTerminalFontFamily('kitty')).toBe('Kitty Font');
    expect(readTerminalFontFamily('ghostty')).toBe('Ghostty Font');
    expect(readTerminalFontFamily('foot')).toBe('Foot Font');
    expect(readTerminalFontFamily('alacritty')).toBe('Alacritty Font');
  });

  it('returns null when nothing is configured', () => {
    expect(readTerminalFontFamily('kitty')).toBeNull();
    expect(readTerminalFontFamily('wezterm')).toBeNull();
  });
});
