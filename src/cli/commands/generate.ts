import { getSharedConfigPath } from '../../generators/configPaths.ts';
import { writeFileAtomic } from '../../generators/fileWrite.ts';
import type { CliFlags } from '../../services/args.ts';
import { CliRunError, CliUsageError, errorMessage } from '../../services/errors.ts';
import { renderShare } from '../../services/share.ts';
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
