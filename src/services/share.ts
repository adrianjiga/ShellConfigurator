import * as fs from 'node:fs';
import * as path from 'node:path';
import { PRESETS, rendersGlyphs } from '../config/presets.ts';
import { generateToml } from '../generators/starship.ts';
import { NO_NERD_FONT, type WizardState } from '../types.ts';
import { NERD_FONTS } from './installer.ts';
import { redactHome } from './redact.ts';
import { serializeState } from './state.ts';

const PROJECT_URL = 'https://github.com/adrianjiga/ShellConfigurator';

/** The state with only what shapes the prompt: no shells, font install or default shell of this machine. */
export function shareableState(state: WizardState): WizardState {
  return {
    ...state,
    selectedShells: [],
    nerdFontToInstall: NO_NERD_FONT,
    setDefaultShell: null,
    skipStarshipInstall: false,
    keepExistingConfig: false,
  };
}

function promptName(state: WizardState): string {
  const label = PRESETS.find((preset) => preset.id === state.preset)?.label ?? 'Custom';
  return label.replace(/\s*\(.*\)$/, '');
}

/**
 * The prompt as Markdown to paste into an issue, a gist or the Starship presets
 * gallery: the starship.toml, and the state card that rebuilds it here.
 */
export function renderShare(state: WizardState): string {
  const shared = shareableState(state);
  const glyphs = rendersGlyphs(shared);
  const toml = generateToml(shared);
  const card = serializeState(shared);
  const home = redactHome(`${toml}\n${card}`) !== `${toml}\n${card}`;
  const text = [
    `# Starship prompt: ${promptName(shared)}`,
    '',
    `Made with [ShellConfigurator](${PROJECT_URL}).${glyphs ? ' Its icons need a [Nerd Font](https://www.nerdfonts.com/) in the terminal.' : ''}${home ? ' Your home folder is shown as `~`.' : ''}`,
    '',
    '## starship.toml',
    '',
    'Save it as `~/.config/starship.toml`:',
    '',
    '```toml',
    toml.trimEnd(),
    '```',
    '',
    '## Rebuild it with ShellConfigurator',
    '',
    `Save this card as \`prompt.json\`, then run \`shell-configurator apply --state prompt.json --shells <your shells>\`${glyphs ? ` (add \`--font ${NERD_FONTS[0].id}\` to install a Nerd Font, or \`--no-nerd-font\` for a version without icons)` : ''}:`,
    '',
    '```json',
    card.trimEnd(),
    '```',
    '',
  ].join('\n');
  return redactHome(text);
}

/** Writes the share text to `starship-prompt.md` in `dir`, or the first free numbered name. */
export function writeShareFile(state: WizardState, dir: string = process.cwd()): string {
  for (let n = 1; ; n++) {
    const file = path.join(dir, n === 1 ? 'starship-prompt.md' : `starship-prompt-${n}.md`);
    try {
      fs.writeFileSync(file, renderShare(state), { flag: 'wx' });
      return file;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
}
