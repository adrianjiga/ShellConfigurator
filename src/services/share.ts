import * as fs from 'node:fs';
import * as path from 'node:path';
import { PRESETS, rendersGlyphs } from '../config/presets.ts';
import { generateToml } from '../generators/starship.ts';
import { NO_NERD_FONT, type WizardState } from '../types.ts';
import { NERD_FONTS } from './installer.ts';
import { redactHome } from './redact.ts';
import { serializeState } from './state.ts';

const PROJECT_URL = 'https://github.com/adrianjiga/ShellConfigurator';

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

export function renderShare(state: WizardState): string {
  const shared = shareableState(state);
  const glyphs = rendersGlyphs(shared);
  const body = [
    '## starship.toml',
    '',
    'Save it as `~/.config/starship.toml`:',
    '',
    '```toml',
    generateToml(shared).trimEnd(),
    '```',
    '',
    '## Rebuild it with ShellConfigurator',
    '',
    `Save this card as \`prompt.json\`, then run \`shell-configurator apply --state prompt.json --shells <your shells>\`${glyphs ? ` (add \`--font ${NERD_FONTS[0].id}\` to install a Nerd Font, or \`--no-nerd-font\` for a version without icons)` : ''}:`,
    '',
    '```json',
    serializeState(shared).trimEnd(),
    '```',
    '',
  ].join('\n');
  const redacted = redactHome(body);
  const notes = [
    ...(glyphs
      ? ['Its icons need a [Nerd Font](https://www.nerdfonts.com/) in the terminal.']
      : []),
    ...(redacted !== body ? ['Your home folder is shown as `~`.'] : []),
    ...(shared.directorySubstitutions.length > 0
      ? ['It includes your directory substitutions, so check those paths before posting.']
      : []),
  ];
  return [
    `# Starship prompt: ${promptName(shared)}`,
    '',
    [`Made with [ShellConfigurator](${PROJECT_URL}).`, ...notes].join(' '),
    '',
    redacted,
  ].join('\n');
}

const MAX_SHARE_FILES = 100;

export function writeShareFile(state: WizardState, dir: string = process.cwd()): string {
  const temp = path.join(dir, `.starship-prompt-${process.pid}.tmp`);
  fs.writeFileSync(temp, renderShare(state), { flag: 'wx' });
  try {
    for (let n = 1; n <= MAX_SHARE_FILES; n++) {
      const file = path.join(dir, n === 1 ? 'starship-prompt.md' : `starship-prompt-${n}.md`);
      try {
        fs.linkSync(temp, file);
        return file;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      }
    }
    throw new Error(
      `starship-prompt.md through starship-prompt-${MAX_SHARE_FILES}.md all exist in ${dir}`
    );
  } finally {
    fs.rmSync(temp, { force: true });
  }
}
