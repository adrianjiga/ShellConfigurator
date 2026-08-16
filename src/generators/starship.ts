import { WizardState, CharacterSymbol } from '../types.ts';
import { getModule, type ConfigurableModuleId, type ModuleId } from '../config/modules.ts';
import { getPalette, type PaletteColorName } from '../config/palettes.ts';
import { tomlBasic, tomlLiteral } from './toml.ts';

const SYMBOLS: Record<CharacterSymbol, { success: string; error: string }> = {
  arrow: { success: '❯', error: '❯' },
  lambda: { success: 'λ', error: 'λ' },
  dollar: { success: '\\$', error: '\\$' },
};

/**
 * Powerline separators, U+E0B0 and U+E0B2. These live in the Nerd Font private use
 * area, so a powerline prompt is only ever generated when a Nerd Font is present.
 */
const SEPARATOR_RIGHT = '';
const SEPARATOR_LEFT = '';

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

function buildFormatString(modules: ModuleId[]): string {
  return modules
    .filter((m) => m !== 'character')
    .map((m) => `$${m}`)
    .join('');
}

/**
 * Wraps a module's content in the separators for its position in the prompt.
 *
 * On the left the separator trails each segment and points right, tinted with the
 * *next* segment's background so the two blocks interlock. On the right it leads
 * each segment and points left, tinted with the previous one. Either way the outer
 * end of the run has no neighbour, so its separator gets no background and fades
 * into the terminal.
 */
function powerlineFormat(
  content: string,
  color: PaletteColorName,
  neighbour: PaletteColorName | null,
  side: 'left' | 'right'
): string {
  const bg = neighbour ? ` bg:${neighbour}` : '';
  const block = `[ ${content} ]($style)`;
  const separator =
    side === 'left'
      ? `[${SEPARATOR_RIGHT}](fg:${color}${bg})`
      : `[${SEPARATOR_LEFT}](fg:${color}${bg})`;
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
    const symbol = SYMBOLS[state.characterSymbol];
    return `
[character]
success_symbol = ${tomlLiteral(`[${symbol.success}](bold ok)`)}
error_symbol   = ${tomlLiteral(`[${symbol.error}](bold err)`)}
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
    lines.push(`format = "${tomlBasic(powerlineFormat(def.content, def.id, neighbour, side))}"`);
  }

  const settings = def.settings?.({ hasNerdFont: state.hasNerdFont, styleFor });
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

  const leftFormat = buildFormatString(leftModules);
  const rightFormat = buildFormatString(rightModules);

  // Use $fill to right-align modules on the same line, then \n$character
  // on a second line. This avoids right_format which shells pin to the
  // cursor line, causing misalignment on two-line prompts.
  const parts = [leftFormat || ''];
  if (rightFormat) {
    parts.push('$fill', rightFormat);
  }
  parts.push('\\n$character');
  const format = parts.filter(Boolean).join('');

  // Separators are tinted with the neighbouring segment's colour, so each side is
  // walked in the order it renders. The character is excluded: it is on its own
  // line and is not part of either run.
  const isSegment = (id: ModuleId): id is ConfigurableModuleId => id !== 'character';
  const leftSegments = leftModules.filter(isSegment);
  const rightSegments = rightModules.filter(isSegment);

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
    `format       = "${format}"`,
    `add_newline  = true`,
    `palette      = "${tomlBasic(state.palette)}"`,
    ``,
    blocks + fillBlock,
    ``,
    paletteBlock(state),
  ];

  return lines.join('\n');
}
