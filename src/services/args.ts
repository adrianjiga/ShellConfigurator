/**
 * Minimal CLI argument parser for the public headless flag surface (D2).
 *
 * Deliberately dependency-free and hand-rolled: the tool ships a bundled,
 * offline tarball, so a flag parser must not add a runtime dependency. The
 * subcommand is the first positional token; a stray word there is an error
 * (it must not silently drop the user into the installer), while a typo'd flag
 * is only warned about so the run can still proceed.
 */
import { CliUsageError } from './errors.ts';

export type Subcommand = 'generate' | 'apply' | 'doctor' | 'repair';

export const SUBCOMMANDS: readonly Subcommand[] = ['generate', 'apply', 'doctor', 'repair'];

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
  /** Emit machine-readable output instead of the human report (--json). */
  json?: boolean;
  /** Apply the repairs the doctor can perform (--fix). */
  fix?: boolean;
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

const SHORT_FLAGS: Record<string, string> = {
  '-o': '--output',
  '-d': '--dry-run',
  '-v': '--version',
  '-h': '--help',
};

/** Boolean flags; the handler applies the value (the bare form means true). */
const BOOLEAN_FLAGS: Record<string, (result: CliFlags, value: boolean) => void> = {
  '--help': (r, v) => {
    r.help = v;
  },
  '--version': (r, v) => {
    r.version = v;
  },
  '--restore': (r, v) => {
    r.restore = v;
  },
  '--undo': (r, v) => {
    r.restore = v;
  },
  '--dry-run': (r, v) => {
    r.dryRun = v;
  },
  '--no-install': (r, v) => {
    r.dryRun = v;
  },
  '--powerline': (r, v) => {
    r.powerline = v;
  },
  '--no-powerline': (r, v) => {
    r.powerline = !v;
  },
  '--has-nerd-font': (r, v) => {
    r.hasNerdFont = v;
  },
  '--no-nerd-font': (r, v) => {
    r.hasNerdFont = !v;
  },
  '--skip-starship': (r, v) => {
    r.skipStarship = v;
  },
  '--adopt': (r, v) => {
    r.adopt = v;
  },
  '--json': (r, v) => {
    r.json = v;
  },
  '--fix': (r, v) => {
    r.fix = v;
  },
};

/** Value flags; the handler stores the consumed value. */
const VALUE_FLAGS: Record<string, (result: CliFlags, value: string) => void> = {
  '--preset': (r, v) => {
    r.preset = v;
  },
  '--palette': (r, v) => {
    r.palette = v;
  },
  '--shells': (r, v) => {
    r.shells = v
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  },
  '--font': (r, v) => {
    r.font = v;
  },
  '--character': (r, v) => {
    r.characterSymbol = v;
  },
  '--set-default': (r, v) => {
    r.setDefaultShell = v;
  },
  '--import': (r, v) => {
    r.stateFile = v;
  },
  '--state': (r, v) => {
    r.stateFile = v;
  },
  '--import-url': (r, v) => {
    r.importUrl = v;
  },
  '--output': (r, v) => {
    r.outputFile = v;
  },
  '--export': (r, v) => {
    r.exportFile = v;
  },
};

const SHORT_BOOLEAN_FLAGS = new Set(
  Object.entries(SHORT_FLAGS)
    .filter(([, long]) => BOOLEAN_FLAGS[long] !== undefined)
    .map(([short]) => short)
);

/** Splits a token into its long-form name and any inline `=` value. */
function splitToken(token: string): { name: string; inlineValue?: string } {
  const eq = token.indexOf('=');
  if (eq === -1) return { name: token };
  return { name: token.slice(0, eq), inlineValue: token.slice(eq + 1) };
}

export function quoteArgv(argv: string[]): string {
  return argv
    .map((arg) =>
      arg === '' || /[^\w@%+=:,./-]/.test(arg) ? `'${arg.replaceAll("'", `'\\''`)}'` : arg
    )
    .join(' ');
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
      if (subcommandSeen) {
        throw new CliUsageError(`Unexpected argument '${arg}'`);
      }
      if (SUBCOMMANDS.includes(flag as Subcommand)) {
        result.subcommand = flag as Subcommand;
        subcommandSeen = true;
        continue;
      }
      throw new CliUsageError(`Unknown command '${arg}' (available: ${SUBCOMMANDS.join(', ')})`);
    }

    // Combined short boolean flags (-dv); -o takes a value and cannot combine.
    if (token.inlineValue === undefined && /^-[^-]{2,}$/.test(token.name)) {
      const chars = [...token.name.slice(1)];
      if (chars.every((c) => SHORT_BOOLEAN_FLAGS.has(`-${c}`))) {
        for (const c of chars) {
          BOOLEAN_FLAGS[SHORT_FLAGS[`-${c}`]!](result, true);
        }
        continue;
      }
    }

    const booleanFlag = BOOLEAN_FLAGS[flag];
    if (booleanFlag !== undefined) {
      if (token.inlineValue === undefined) {
        booleanFlag(result, true);
      } else {
        result.warnings.push(`Flag '${flag}' does not take a value; ignoring '${arg}'`);
      }
      continue;
    }

    // Value flags — the inline `=` value, else the next token (skip it only when
    // it exists; the token we consumed is never reused).
    const valueFlag = VALUE_FLAGS[flag];
    const value = token.inlineValue ?? argv[i + 1];
    const hasValue =
      token.inlineValue !== undefined
        ? token.inlineValue !== ''
        : value !== undefined && value !== '' && !value.startsWith('-');

    if (
      token.inlineValue === undefined &&
      value !== undefined &&
      valueFlag !== undefined &&
      SUBCOMMANDS.includes(value as Subcommand)
    ) {
      throw new CliUsageError(`Flag '${flag}' needs a value; '${value}' is a subcommand name`);
    }

    if (!hasValue) {
      if (valueFlag !== undefined) {
        result.warnings.push(`Flag '${flag}' needs a value; ignoring it`);
        if (token.inlineValue === undefined && argv[i + 1] === '') i++;
      } else {
        result.warnings.push(`Unknown flag '${flag}'; ignoring it`);
      }
      continue;
    }

    if (valueFlag === undefined) {
      result.warnings.push(`Unknown flag '${flag}'; ignoring it`);
      continue;
    }
    valueFlag(result, value);
    if (token.inlineValue === undefined) i++;
  }

  return result;
}
