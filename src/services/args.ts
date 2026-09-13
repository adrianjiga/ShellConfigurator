/**
 * Minimal CLI argument parser for the public headless flag surface (D2).
 *
 * Deliberately dependency-free and hand-rolled: the tool ships a bundled,
 * offline tarball, so a flag parser must not add a runtime dependency. It
 * recognises the subcommand as the first positional token and then walks the
 * flags. Anything unknown is collected as a warning rather than an error so
 * the same argv can still fall through to the existing global-flag handling —
 * a typo'd flag must be surfaced, but it must not abort the run.
 */

export type Subcommand = 'generate' | 'apply';

export interface CliFlags {
  /** The subcommand, or null when the run is interactive or a plain flag. */
  subcommand: Subcommand | null;
  preset?: string;
  palette?: string;
  /** Explicit powerline choice; undefined defers to the preset default. */
  powerline?: boolean;
  /** Comma-separated shell ids from --shells. */
  shells?: string[];
  /** 'none' or a Nerd Font id. */
  font?: string;
  /** Whether the machine already renders Nerd Font glyphs. */
  hasNerdFont?: boolean;
  characterSymbol?: string;
  setDefaultShell?: string;
  /** Skip the Starship install step (config-only run). */
  skipStarship?: boolean;
  /** A state card to use as the base for the run (--import/--state). */
  stateFile?: string;
  /** Adopt the existing ~/.config/starship.toml instead of regenerating it. */
  adopt?: boolean;
  /** Fetch a starship.toml from a URL and adopt it as the shared config. */
  importUrl?: string;
  /** Where TOML is written (-o); missing means stdout. */
  outputFile?: string;
  /** Write the versioned state card here (add -o to keep the TOML too) (--export). */
  exportFile?: string;
  dryRun?: boolean;
  // Global flags, kept for parity with index.tsx's existing surface.
  help: boolean;
  version: boolean;
  restore: boolean;
  /**
   * Problems found while parsing: unknown flags, values given to boolean flags,
   * and known value flags that got no value. Ignored for the run — the caller
   * prints them to stderr so the user sees the typo.
   */
  warnings: string[];
}

/** A flag that takes no value, so the next token is not consumed as its value. */
const SHORT_FLAGS: Record<string, string> = {
  '-o': '--output',
  '-d': '--dry-run',
  '-v': '--version',
  '-h': '--help',
};

/** Flags whose presence alone is the value. An `=` form is a contradiction. */
const BOOLEAN_FLAGS = new Set<string>([
  '--help',
  '--version',
  '--restore',
  '--undo',
  '--dry-run',
  '--no-install',
  '--powerline',
  '--no-powerline',
  '--has-nerd-font',
  '--no-nerd-font',
  '--skip-starship',
  '--adopt',
]);

/** Flags that consume the next token (or an inline `=value`) as their value. */
const VALUE_FLAGS = new Set<string>([
  '--preset',
  '--palette',
  '--shells',
  '--font',
  '--character',
  '--set-default',
  '--import',
  '--state',
  '--import-url',
  '--output',
  '--export',
]);

/** Splits a token into its long-form name and any inline `=` value. */
function splitToken(token: string): { name: string; inlineValue?: string } {
  const eq = token.indexOf('=');
  if (eq === -1) return { name: token };
  return { name: token.slice(0, eq), inlineValue: token.slice(eq + 1) };
}

export function parseCliArgs(argv: string[]): CliFlags {
  const result: CliFlags = {
    subcommand: null,
    help: false,
    version: false,
    restore: false,
    warnings: [],
  };

  let subcommandSeen = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const token = splitToken(arg);
    const flag = SHORT_FLAGS[token.name] ?? token.name;

    if (!flag.startsWith('-')) {
      if (!subcommandSeen && (flag === 'generate' || flag === 'apply')) {
        result.subcommand = flag;
        subcommandSeen = true;
      }
      continue;
    }

    // Boolean flags — the value is the flag itself. `--flag=x` is not boolean:
    // a value on a boolean flag is a contradiction, so warn and drop the token.
    if (token.inlineValue === undefined) {
      switch (flag) {
        case '--help':
          result.help = true;
          continue;
        case '--version':
          result.version = true;
          continue;
        case '--restore':
        case '--undo':
          result.restore = true;
          continue;
        case '--dry-run':
          result.dryRun = true;
          continue;
        case '--no-install':
          result.dryRun = true;
          continue;
        case '--powerline':
          result.powerline = true;
          continue;
        case '--no-powerline':
          result.powerline = false;
          continue;
        case '--has-nerd-font':
          result.hasNerdFont = true;
          continue;
        case '--no-nerd-font':
          result.hasNerdFont = false;
          continue;
        case '--skip-starship':
          result.skipStarship = true;
          continue;
        case '--adopt':
          result.adopt = true;
          continue;
      }
    } else if (BOOLEAN_FLAGS.has(flag)) {
      result.warnings.push(`Flag '${flag}' does not take a value; ignoring '${arg}'`);
      continue;
    }

    // Value flags — the inline `=` value, else the next token (skip it only when
    // it exists; the token we consumed is never reused).
    const value = token.inlineValue ?? argv[i + 1];
    const hasValue = value !== undefined && !value.startsWith('-');

    if (!hasValue) {
      if (VALUE_FLAGS.has(flag)) {
        result.warnings.push(`Flag '${flag}' needs a value; ignoring it`);
      } else if (flag.startsWith('-')) {
        result.warnings.push(`Unknown flag '${flag}'; ignoring it`);
      }
      continue;
    }

    switch (flag) {
      case '--preset':
        result.preset = value;
        break;
      case '--palette':
        result.palette = value;
        break;
      case '--shells':
        result.shells = value
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        break;
      case '--font':
        result.font = value;
        break;
      case '--character':
        result.characterSymbol = value;
        break;
      case '--set-default':
        result.setDefaultShell = value;
        break;
      case '--import':
      case '--state':
        result.stateFile = value;
        break;
      case '--import-url':
        result.importUrl = value;
        break;
      case '--output':
        result.outputFile = value;
        break;
      case '--export':
        result.exportFile = value;
        break;
      default:
        result.warnings.push(`Unknown flag '${flag}'; ignoring it`);
        continue;
    }
    if (token.inlineValue === undefined) i++;
  }

  return result;
}
