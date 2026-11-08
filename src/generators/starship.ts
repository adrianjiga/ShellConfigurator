import {
  type ConfigurableModuleId,
  getModule,
  isConfigurableModule,
  type ModuleId,
} from '../config/modules.ts';
import { getPalette, type PaletteColorName } from '../config/palettes.ts';
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
 * as the user sees them, but `$` opens a module variable and `\` escapes the next
 * character, so both must be backslash-escaped in the generated config.
 */
function escapeFormatLiteral(symbol: string): string {
  return symbol.replace(/[\\$]/g, (c) => `\\${c}`);
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
 * Wraps a module's content in the separators for its position in the prompt.
 *
 * On the left the separator trails each segment and points right; on the right it
 * leads each segment and points left. Its foreground matches the current block
 * and its background matches the neighboring block, forming the conventional
 * interlocking powerline shape. The outer end fades into the terminal.
 */
function powerlineFormat(
  content: string,
  color: PaletteColorName,
  neighbour: PaletteColorName | null,
  side: 'left' | 'right'
): string {
  const separatorStyle = neighbour ? `fg:${color} bg:${neighbour}` : `fg:${color}`;
  const block = `[ ${content} ]($style)`;
  const separator = `[${side === 'left' ? SEPARATOR_RIGHT : SEPARATOR_LEFT}](${separatorStyle})`;
  // Wrapped in a conditional group: starship drops a `(…)` group whose variables
  // are all empty, so a module with nothing to show (a clean repo's git_status, a
  // command too fast for cmd_duration) collapses instead of leaving an empty
  // coloured block and a stray separator in the prompt.
  return side === 'left' ? `(${block}${separator})` : `(${separator}${block})`;
}

interface BlockContext {
  state: WizardState;
  powerline: boolean;
  /** The colour of the segment the separator points into, if there is one. */
  neighbour: PaletteColorName | null;
  side: 'left' | 'right';
}

function moduleBlock(id: ModuleId, ctx: BlockContext): string {
  const { state, powerline, neighbour, side } = ctx;

  // The character is not a placeable module, so it has no MODULES entry. It also
  // sits on its own line below the prompt, where there is nothing to interlock
  // with, so it is never drawn as a powerline segment.
  if (id === 'character') {
    const symbol = CHARACTER_SYMBOLS[state.characterSymbol];
    const success = escapeFormatLiteral(symbol.success);
    const error = escapeFormatLiteral(symbol.error);
    // `vimcmd_symbol` only changes the glyph in normal mode; starship's default
    // character format already reads the `symbol` variable for every mode.
    const vim = state.vimMode ? `\nvimcmd_symbol  = ${tomlLiteral('[❮](bold ok)')}` : '';
    return `
[character]
success_symbol = ${tomlLiteral(`[${success}](bold ok)`)}
error_symbol   = ${tomlLiteral(`[${error}](bold err)`)}${vim}
`.trim();
  }

  const def = getModule(id);
  if (!def) {
    // Unknown id (malformed state) — emit a harmless enabling stub.
    return `
[${id}]
disabled = false
`.trim();
  }

  const styleFor = (name: PaletteColorName) => styleExpression(name, powerline);

  const lines = [`[${id}]`];
  // Modules that carry their colour in differently-named keys (style_user,
  // [[battery.display]]) emit it themselves from `settings`.
  if (!def.stylesItself) {
    lines.push(`style  = "${tomlBasic(styleFor(def.id))}"`);
  }
  if (powerline) {
    const content =
      id === 'directory' && state.hasNerdFont
        ? `${NERD_FONT_SYMBOLS.directory}${def.content}`
        : def.content;
    lines.push(`format = "${tomlBasic(powerlineFormat(content, def.id, neighbour, side))}"`);
  }

  const settings = def.settings?.({
    hasNerdFont: state.hasNerdFont,
    powerline,
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

export function generateToml(state: WizardState): string {
  // Powerline separators are Nerd Font glyphs. Promising one without the font
  // would fill the prompt with tofu, so the plain layout is used instead.
  const powerline = state.powerline && state.hasNerdFont;

  // A module chosen on both sides would otherwise be emitted twice in the format
  // string and render twice in the prompt. The left side wins.
  const leftModules = [...new Set(state.leftModules)];
  const rightModules = [...new Set(state.rightModules)].filter((id) => !leftModules.includes(id));

  const leftSegments = leftModules.filter(isConfigurableModule);
  const rightSegments = rightModules.filter(isConfigurableModule);

  const leftFormat = buildFormatString(leftSegments);
  const rightFormat = buildFormatString(rightSegments);

  // Use $fill to right-align modules on the same line, then \n$character
  // on a second line. This avoids right_format which shells pin to the
  // cursor line, causing misalignment on two-line prompts.
  const parts = [leftFormat || ''];
  if (rightFormat) {
    parts.push('$fill', rightFormat);
  }
  parts.push('\\n$character');
  const format = parts.filter(Boolean).join('');

  // On the left the separator points at the next segment; on the right, the
  // previous one. Either way the segment at the outer end has no neighbour.
  const blocksFor = (segments: ConfigurableModuleId[], at: 'left' | 'right') =>
    segments.map((id, i) => {
      const neighbour = segments[at === 'left' ? i + 1 : i - 1] ?? null;
      return moduleBlock(id, { state, powerline, neighbour, side: at });
    });

  const characterBlock = leftModules.includes('character')
    ? [moduleBlock('character', { state, powerline, neighbour: null, side: 'left' })]
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
    `format              = "${format}"`,
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
