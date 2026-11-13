import {
  type ConfigurableModuleId,
  getModule,
  isConfigurableModule,
  type ModuleId,
} from '../config/modules.ts';
import { getPalette, type PaletteColorName } from '../config/palettes.ts';
import { bracketsSegments, rendersGlyphs } from '../config/presets.ts';
import {
  CHARACTER_SYMBOLS,
  CONTINUATION_PROMPTS,
  NERD_FONT_SYMBOLS,
  SEPARATOR_LEFT,
  SEPARATOR_RIGHT,
} from '../config/promptSymbols.ts';
import type { WizardState } from '../types.ts';
import { tomlBasic, tomlLiteral } from './toml.ts';

/**
 * Escapes a character symbol for starship's format string. The symbols are stored
 * as the user sees them, but `$` opens a module variable, `[ ] ( )` delimit text
 * groups and `\` escapes the next character, so all of them are backslash-escaped.
 */
export function escapeFormatLiteral(symbol: string): string {
  return symbol.replace(/[\\$[\]()]/g, (c) => `\\${c}`);
}

/**
 * A style expression for a palette colour.
 *
 * Colours are referenced by *name* rather than by value: the generated config
 * carries a `[palettes.<id>]` table, so `bg:directory` resolves through it. That
 * keeps the file readable and lets a user retune the whole theme in one place.
 */
function styleExpression(name: PaletteColorName, powerline: boolean): string {
  return powerline ? `bold fg:fg bg:${name}` : `bold ${name}`;
}

function buildFormatString(segments: ConfigurableModuleId[]): string {
  return segments.map((m) => `$${m}`).join('');
}

/**
 * Leading separator styled with starship's `prev_bg` (1.20+) so a collapsed
 * module takes its separator with it.
 */
function powerlineFormat(
  content: string,
  color: PaletteColorName,
  side: 'left' | 'right',
  separator: boolean
): string {
  const block = `[ ${content} ]($style)`;
  if (!separator) return `(${block})`;
  const separatorStyle = side === 'left' ? `fg:prev_bg bg:${color}` : `fg:${color} bg:prev_bg`;
  const glyph = `[${side === 'left' ? SEPARATOR_RIGHT : SEPARATOR_LEFT}](${separatorStyle})`;
  return `(${glyph}${block})`;
}

interface BlockContext {
  state: WizardState;
  powerline: boolean;
  bracketed: boolean;
  separator: boolean;
  side: 'left' | 'right';
}

function moduleBlock(id: ModuleId, ctx: BlockContext): string {
  const { state, powerline, bracketed, separator, side } = ctx;

  // The character is not a placeable module, so it has no MODULES entry. It also
  // sits on its own line below the prompt, where there is nothing to interlock
  // with, so it is never drawn as a powerline segment.
  if (id === 'character') {
    const symbol = CHARACTER_SYMBOLS[state.characterSymbol];
    const success = escapeFormatLiteral(symbol.success);
    const error = escapeFormatLiteral(symbol.error);
    // `vimcmd_symbol` only changes the glyph in normal mode; starship's default
    // character format already reads the `symbol` variable for every mode.
    const vimSymbol = `[${escapeFormatLiteral(symbol.vim)}](${symbol.vimStyle})`;
    const vim = state.vimMode ? `\nvimcmd_symbol  = ${tomlLiteral(vimSymbol)}` : '';
    return `
[character]
success_symbol = ${tomlLiteral(`[${success}](bold ok)`)}
error_symbol   = ${tomlLiteral(`[${error}](bold err)`)}${vim}
`.trim();
  }

  const def = getModule(id);
  if (!def) return '';

  const styleFor = (name: PaletteColorName) => styleExpression(name, powerline);

  const lines = [`[${id}]`];
  // Modules that carry their colour in differently-named keys (style_user,
  // [[battery.display]]) emit it themselves from `settings`.
  if (!def.stylesItself) {
    lines.push(`style  = "${tomlBasic(styleFor(def.id))}"`);
  }
  const content =
    id === 'directory' && state.hasNerdFont
      ? `${NERD_FONT_SYMBOLS.directory}${def.content}`
      : def.content;
  if (powerline) {
    lines.push(`format = "${tomlBasic(powerlineFormat(content, def.id, side, separator))}"`);
  } else if (bracketed) {
    lines.push(`format = "${tomlBasic(`(\\[[${content}]($style)\\] )`)}"`);
  }

  const settings = def.settings?.({
    hasNerdFont: state.hasNerdFont,
    powerline,
    customFormat: powerline || bracketed,
    styleFor,
    directoryTruncationLength: state.directoryTruncationLength,
    directorySubstitutions: state.directorySubstitutions,
  });
  if (settings) lines.push(settings);

  return lines.join('\n');
}

/** The `[palettes.<id>]` table the rest of the config refers to by colour name. */
function paletteBlock(state: WizardState): string {
  const palette = getPalette(state.palette);
  const names = Object.keys(palette.colors) as PaletteColorName[];
  const width = Math.max(...names.map((n) => n.length));
  const entries = names.map(
    (name) => `${name.padEnd(width)} = "${tomlBasic(palette.colors[name])}"`
  );
  return [`[palettes.${palette.id}]`, ...entries].join('\n');
}

export function generateToml(chosen: WizardState): string {
  const state = { ...chosen, hasNerdFont: rendersGlyphs(chosen) };
  // Powerline separators are Nerd Font glyphs. Promising one without the font
  // would fill the prompt with tofu, so the plain layout is used instead.
  const powerline = state.powerline && state.hasNerdFont;
  const bracketed = bracketsSegments(state);

  // A module chosen on both sides would otherwise be emitted twice in the format
  // string and render twice in the prompt. The left side wins.
  const leftModules = [...new Set(state.leftModules)];
  const rightModules = [...new Set(state.rightModules)].filter((id) => !leftModules.includes(id));

  // An id with no module definition would put a `$bogus` starship warns about.
  const placeable = (id: ModuleId): id is ConfigurableModuleId =>
    isConfigurableModule(id) && getModule(id) !== undefined;
  const leftSegments = leftModules.filter(placeable);
  const rightSegments = rightModules.filter(placeable);

  // The fade-out arrow follows whatever module rendered last.
  const leftFormat =
    buildFormatString(leftSegments) +
    (powerline && leftSegments.length > 0 ? `[${SEPARATOR_RIGHT}](fg:prev_bg)` : '');
  const rightFormat = buildFormatString(rightSegments);

  // Use $fill to right-align modules on the same line, then \n$character
  // on a second line. This avoids right_format which shells pin to the
  // cursor line, causing misalignment on two-line prompts.
  const parts = [leftFormat || ''];
  if (rightFormat) {
    parts.push('$fill', rightFormat);
  }
  parts.push('\n$character');
  const format = parts.filter(Boolean).join('');

  // The first left-side segment starts flush; every other one is preceded by
  // its separator.
  const blocksFor = (segments: ConfigurableModuleId[], at: 'left' | 'right') =>
    segments.map((id, i) =>
      moduleBlock(id, {
        state,
        powerline,
        bracketed,
        separator: at === 'right' || i > 0,
        side: at,
      })
    );

  const characterBlock = leftModules.includes('character')
    ? [moduleBlock('character', { state, powerline, bracketed, separator: false, side: 'left' })]
    : [];

  const blocks = [
    ...blocksFor(leftSegments, 'left'),
    ...blocksFor(rightSegments, 'right'),
    ...characterBlock,
  ].join('\n\n');

  const fillBlock = rightFormat ? `\n\n[fill]\nsymbol = " "` : '';

  const lines: string[] = [
    `# Generated by ShellConfigurator`,
    `# https://github.com/adrianjiga/ShellConfigurator`,
    ``,
    `format              = "${tomlBasic(format)}"`,
    `continuation_prompt = "${tomlBasic(CONTINUATION_PROMPTS[state.continuationPrompt])}"`,
    `add_newline         = ${state.addNewline}`,
    `palette             = "${tomlBasic(state.palette)}"`,
    ``,
    blocks + fillBlock,
    ``,
    paletteBlock(state),
  ];

  return lines.join('\n');
}
