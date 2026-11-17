import type { CliFlags, Subcommand } from '../services/args.ts';
import { SUBCOMMAND_INFO } from '../services/cliSurface.ts';
import { CliUsageError } from '../services/errors.ts';

/** The config flags present on the command line, by the name shown to the user. */
export function presentConfigFlags(flags: CliFlags): string[] {
  const present: string[] = [];
  if (flags.preset) present.push('--preset');
  if (flags.palette) present.push('--palette');
  if (flags.powerline !== undefined)
    present.push(flags.powerline ? '--powerline' : '--no-powerline');
  if (flags.shells) present.push('--shells');
  if (flags.font) present.push('--font');
  if (flags.hasNerdFont !== undefined)
    present.push(flags.hasNerdFont ? '--has-nerd-font' : '--no-nerd-font');
  if (flags.characterSymbol) present.push('--character');
  if (flags.setDefaultShell) present.push('--set-default');
  if (flags.skipStarship) present.push('--skip-starship');
  if (flags.adopt) present.push('--adopt');
  if (flags.importUrl) present.push('--import-url');
  if (flags.outputFile) present.push('--output');
  if (flags.exportFile) present.push('--export');
  return present;
}

/** Every flag on the command line except the help and version flags, by the name shown to the user. */
function presentFlags(flags: CliFlags): string[] {
  const present = presentConfigFlags(flags);
  const others: Array<[unknown, string]> = [
    [flags.stateFile, '--state'],
    [flags.dryRun, '--dry-run'],
    [flags.json, '--json'],
    [flags.markdown, '--markdown'],
    [flags.fix, '--fix'],
    [flags.timings, '--timings'],
    [flags.includeWarnings, '--include-warnings'],
    [flags.yes, '--yes'],
    [flags.starship, '--starship'],
    [flags.list, '--list'],
    [flags.runId, '--run'],
    [flags.configFile, '--config'],
  ];
  for (const [value, name] of others) if (value) present.push(name);
  return present;
}

function acceptedFlags(subcommand: Subcommand): Set<string> {
  return new Set(SUBCOMMAND_INFO[subcommand].flags.map((info) => info.name));
}

const NOT_STATE_FLAGS = new Set(['--import-url', '--output', '--export']);

export function refuseUnusedFlags(flags: CliFlags, subcommand: Subcommand): void {
  const accepted = acceptedFlags(subcommand);
  const layered =
    subcommand === 'doctor'
      ? presentConfigFlags(flags).filter((flag) => !NOT_STATE_FLAGS.has(flag))
      : [];
  const unused = presentFlags(flags).filter(
    (flag) => !accepted.has(flag) && !layered.includes(flag)
  );
  if (subcommand === 'doctor' && flags.dryRun && !flags.fix) unused.push('--dry-run without --fix');
  if (unused.length > 0) {
    throw new CliUsageError(`${unused.join(', ')} cannot be used with ${subcommand}.`);
  }
}

export function warnIgnoredFlags(flags: CliFlags, subcommand: string): void {
  if (flags.stateFile) return;
  for (const flag of presentConfigFlags(flags)) {
    process.stderr.write(
      `shell-configurator: warning: ${flag} is ignored by ${subcommand} without --state\n`
    );
  }
}
