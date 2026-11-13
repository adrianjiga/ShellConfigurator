import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readTerminalFontFamily, wireTerminalFont } from '../../services/terminalFont.ts';

let tmp: string;
const originalXdg = process.env.XDG_CONFIG_HOME;
const originalHome = process.env.HOME;
const originalKittyDir = process.env.KITTY_CONFIG_DIRECTORY;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-terminal-'));
  process.env.XDG_CONFIG_HOME = tmp;
  process.env.HOME = tmp;
});

afterEach(() => {
  if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = originalXdg;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalKittyDir === undefined) delete process.env.KITTY_CONFIG_DIRECTORY;
  else process.env.KITTY_CONFIG_DIRECTORY = originalKittyDir;
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

    expect(read('alacritty/alacritty.toml')).toBe(
      '[font.normal]\nfamily = "JetBrainsMono Nerd Font"\n'
    );
  });

  it('updates only the family inside an existing alacritty [font.normal] table', () => {
    write(
      'alacritty/alacritty.toml',
      '[window]\nopacity = 0.9\n\n[font]\nsize = 12\n\n[font.normal]\nfamily = "Old"\nstyle = "Regular"\n'
    );

    wireTerminalFont('alacritty', 'FiraCode Nerd Font');

    expect(read('alacritty/alacritty.toml')).toBe(
      '[window]\nopacity = 0.9\n\n[font]\nsize = 12\n\n[font.normal]\nfamily = "FiraCode Nerd Font"\nstyle = "Regular"\n'
    );
  });

  it('updates an inline alacritty font table without adding a duplicate table', () => {
    write('alacritty/alacritty.toml', '[font]\nnormal = { family = "Old", style = "Regular" }\n');

    wireTerminalFont('alacritty', 'Hack Nerd Font');

    expect(read('alacritty/alacritty.toml')).toBe(
      '[font]\nnormal = { family = "Hack Nerd Font", style = "Regular" }\n'
    );

    const again = wireTerminalFont('alacritty', 'Hack Nerd Font');
    expect(again.applied).toBe(false);
  });

  it('updates an inline alacritty font table with a trailing comment', () => {
    write('alacritty/alacritty.toml', '[font]\nnormal = { family = "Old" } # main font\n');

    wireTerminalFont('alacritty', 'Hack Nerd Font');

    expect(read('alacritty/alacritty.toml')).toBe(
      '[font]\nnormal = { family = "Hack Nerd Font" } # main font\n'
    );
  });

  it('recognises an alacritty [font.normal] header with spacing or a comment', () => {
    write('alacritty/alacritty.toml', '[ font.normal ] # main font\nfamily = "Old"\n');

    wireTerminalFont('alacritty', 'Hack Nerd Font');

    expect(read('alacritty/alacritty.toml')).toBe(
      '[ font.normal ] # main font\nfamily = "Hack Nerd Font"\n'
    );
  });

  it.each(['[font]\nnormal.family = "Old"\nstyle = "Bold"\n', 'font.normal.family = "Old"\n'])(
    'updates the dotted alacritty family key written as %s',
    (original) => {
      write('alacritty/alacritty.toml', original);

      wireTerminalFont('alacritty', 'Hack Nerd Font');

      expect(read('alacritty/alacritty.toml')).toBe(original.replace('"Old"', '"Hack Nerd Font"'));
      expect(read('alacritty/alacritty.toml').match(/^\[font.normal\]/gm)).toBeNull();
    }
  );

  it('leaves an inline normal table outside the font tables alone', () => {
    const colors = '[colors]\nnormal = { black = "#000000", red = "#ff0000" }\n';
    write('alacritty/alacritty.toml', colors);

    wireTerminalFont('alacritty', 'Hack Nerd Font');

    expect(read('alacritty/alacritty.toml')).toBe(
      `${colors}\n[font.normal]\nfamily = "Hack Nerd Font"\n`
    );
  });

  it('starts a new line when the file ends on the [font.normal] header', () => {
    write('alacritty/alacritty.toml', '[font]\nsize = 12\n[font.normal]');

    wireTerminalFont('alacritty', 'Hack Nerd Font');

    expect(read('alacritty/alacritty.toml')).toBe(
      '[font]\nsize = 12\n[font.normal]\nfamily = "Hack Nerd Font"\n'
    );
  });

  it('accepts the top-level inline font.normal form', () => {
    write('alacritty/alacritty.toml', 'font.normal = { family = "Old" }\n');

    wireTerminalFont('alacritty', 'Hack Nerd Font');

    expect(read('alacritty/alacritty.toml')).toBe('font.normal = { family = "Hack Nerd Font" }\n');
  });

  it('adds a [font.normal] table when only [font] exists', () => {
    write('alacritty/alacritty.toml', '[font]\nsize = 12\n');

    wireTerminalFont('alacritty', 'Hack Nerd Font');

    expect(read('alacritty/alacritty.toml')).toBe(
      '[font]\nsize = 12\n\n[font.normal]\nfamily = "Hack Nerd Font"\n'
    );
  });

  it('advises instead of editing a legacy alacritty.yml', () => {
    write('alacritty/alacritty.yml', 'font:\n  family: "Old"\n');

    const result = wireTerminalFont('alacritty', 'Hack Nerd Font');

    expect(result.applied).toBe(false);
    expect(result.note).toContain('alacritty.yml');
    expect(read('alacritty/alacritty.yml')).toBe('font:\n  family: "Old"\n');
  });

  it('edits a kitty config in KITTY_CONFIG_DIRECTORY instead of creating the XDG one', () => {
    process.env.KITTY_CONFIG_DIRECTORY = path.join(tmp, 'kitty-env');
    write('kitty-env/kitty.conf', 'font_family Hack Nerd Font\n');

    const result = wireTerminalFont('kitty', 'FiraCode Nerd Font');

    expect(result.applied).toBe(true);
    expect(result.path).toBe(path.join(tmp, 'kitty-env', 'kitty.conf'));
    expect(read('kitty-env/kitty.conf')).toBe('font_family FiraCode Nerd Font\n');
    expect(fs.existsSync(path.join(tmp, 'kitty', 'kitty.conf'))).toBe(false);
    expect(readTerminalFontFamily('kitty')).toBe('FiraCode Nerd Font');
  });

  it.skipIf(process.platform !== 'darwin')(
    'edits the macOS Preferences kitty config instead of creating the XDG one',
    () => {
      write('Library/Preferences/kitty/kitty.conf', 'font_family Hack Nerd Font\n');

      const result = wireTerminalFont('kitty', 'FiraCode Nerd Font');

      expect(result.applied).toBe(true);
      expect(result.path).toBe(path.join(tmp, 'Library', 'Preferences', 'kitty', 'kitty.conf'));
      expect(read('Library/Preferences/kitty/kitty.conf')).toBe('font_family FiraCode Nerd Font\n');
      expect(fs.existsSync(path.join(tmp, 'kitty', 'kitty.conf'))).toBe(false);
    }
  );

  it('edits a legacy ~/.alacritty.toml instead of creating the XDG one', () => {
    write('.alacritty.toml', '[font.normal]\nfamily = "Old"\n');

    const result = wireTerminalFont('alacritty', 'FiraCode Nerd Font');

    expect(result.applied).toBe(true);
    expect(result.path).toBe(path.join(tmp, '.alacritty.toml'));
    expect(read('.alacritty.toml')).toBe('[font.normal]\nfamily = "FiraCode Nerd Font"\n');
    expect(fs.existsSync(path.join(tmp, 'alacritty', 'alacritty.toml'))).toBe(false);
    expect(readTerminalFontFamily('alacritty')).toBe('FiraCode Nerd Font');
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
