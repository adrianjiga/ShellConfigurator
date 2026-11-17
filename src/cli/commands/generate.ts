import * as path from 'node:path';
import { getSharedConfigPath } from '../../generators/configPaths.ts';
import { writeFileAtomic } from '../../generators/fileWrite.ts';
import { generateToml } from '../../generators/starship.ts';
import type { CliFlags } from '../../services/args.ts';
import { CliRunError, CliUsageError, errorMessage } from '../../services/errors.ts';
import { renderShare } from '../../services/share.ts';
import { serializeState } from '../../services/state.ts';
import { stateFromFlags } from '../../services/stateFlags.ts';

const NOT_SHARED_FLAGS: Array<[keyof CliFlags, string]> = [
  ['shells', '--shells'],
  ['setDefaultShell', '--set-default'],
  ['skipStarship', '--skip-starship'],
  ['exportFile', '--export'],
  ['dryRun', '--dry-run'],
];

export function runMarkdownCommand(flags: CliFlags): void {
  const refused = NOT_SHARED_FLAGS.filter(([key]) => flags[key]).map(([, name]) => name);
  if (refused.length > 0) {
    throw new CliUsageError(
      `${refused.join(', ')} cannot be used with generate --markdown, which shares the look only.`
    );
  }
  const state = stateFromFlags(flags);
  if (state.keepExistingConfig) {
    throw new CliUsageError(
      `An adopt-mode card keeps your own config, so there is no generated prompt to share; share ${getSharedConfigPath()} itself.`
    );
  }
  const text = renderShare(state);
  if (!flags.outputFile) {
    process.stdout.write(text);
    return;
  }
  try {
    writeFileAtomic(flags.outputFile, text);
  } catch (err) {
    throw new CliRunError(`Could not write '${flags.outputFile}': ${errorMessage(err)}`);
  }
  process.stdout.write(`Wrote ${flags.outputFile}\n`);
}

/** The full `generate` subcommand: TOML (or a state card) from flags. */
export function runGenerate(flags: CliFlags): void {
  if (flags.adopt || flags.importUrl) {
    throw new CliUsageError('--adopt and --import-url are only valid with the apply subcommand.');
  }
  const state = stateFromFlags(flags);
  if (state.keepExistingConfig) {
    throw new CliUsageError(
      'generate has nothing to write for an adopt-mode card; use apply, or drop keepExistingConfig.'
    );
  }
  const toml = generateToml(state);

  if (
    flags.outputFile &&
    flags.exportFile &&
    path.resolve(flags.outputFile) === path.resolve(flags.exportFile)
  ) {
    throw new CliUsageError(
      `Refusing to write the TOML and the state card to the same file: ${flags.outputFile}`
    );
  }

  if (flags.exportFile) {
    try {
      writeFileAtomic(flags.exportFile, serializeState(state));
    } catch (err) {
      throw new CliRunError(
        `Could not write state card to '${flags.exportFile}': ${errorMessage(err)}`
      );
    }
  }

  if (flags.outputFile) {
    try {
      writeFileAtomic(flags.outputFile, toml);
    } catch (err) {
      throw new CliRunError(`Could not write TOML to '${flags.outputFile}': ${errorMessage(err)}`);
    }
  } else if (!flags.exportFile) {
    process.stdout.write(toml);
  }
}

export function runGenerateCommand(flags: CliFlags): void {
  if (flags.markdown) runMarkdownCommand(flags);
  else runGenerate(flags);
}
