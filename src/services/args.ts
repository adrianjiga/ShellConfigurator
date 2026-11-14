/**
 * Minimal CLI argument parser for the public headless flag surface (D2).
 *
 * Deliberately dependency-free and hand-rolled: the tool ships a bundled,
 * offline tarball, so a flag parser must not add a runtime dependency. The
 * subcommand is the first positional token, and anything the parser does not
 * recognize is a usage error rather than a warning — a typo must never start
 * the real installer.
 */
import { posixShellQuote } from '../config/shells.ts';
import { CliUsageError } from './errors.ts';

export type Subcommand =
  | 'generate'
  | 'apply'
  | 'doctor'
  | 'repair'
  | 'uninstall'
  | 'rollback'
  | 'debug-info'
  | 'completions'
  | 'timings'
  | 'share';

export const SUBCOMMANDS: readonly Subcommand[] = [
  'generate',
  'apply',
  'doctor',
  'repair',
  'uninstall',
  'rollback',
  'debug-info',
  'completions',
  'timings',
  'share',
];

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
  configFile?: string;
  /** Write the versioned state card here (add -o to keep the TOML too) (--export). */
  exportFile?: string;
  dryRun?: boolean;
  /** Emit machine-readable output instead of the human report (--json). */
  json?: boolean;
  /** Apply the repairs the doctor can perform (--fix). */
  fix?: boolean;
  /** Let repair also apply the fixes warnings carry (--include-warnings). */
  includeWarnings?: boolean;
  /** Let uninstall go ahead without asking (--yes). */
  yes?: boolean;
  /** Let uninstall remove Starship itself (--starship). */
  starship?: boolean;
  /** List the runs rollback can undo (--list). */
  list?: boolean;
  /** The run rollback undoes, instead of the newest (--run). */
  runId?: string;
  completionShell?: string;
  listPresets?: boolean;
  listModules?: boolean;
  listFonts?: boolean;
  help: boolean;
  version: boolean;
  restore: boolean;
}

const SHORT_FLAGS: Record<string, string> = {
  '-o': '--output',
  '-d': '--dry-run',
  '-v': '--version',
  '-h': '--help',
  '-y': '--yes',
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
  '--include-warnings': (r, v) => {
    r.includeWarnings = v;
  },
  '--yes': (r, v) => {
    r.yes = v;
  },
  '--starship': (r, v) => {
    r.starship = v;
  },
  '--list': (r, v) => {
    r.list = v;
  },
  '--list-presets': (r, v) => {
    r.listPresets = v;
  },
  '--list-modules': (r, v) => {
    r.listModules = v;
  },
  '--list-fonts': (r, v) => {
    r.listFonts = v;
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
  '--run': (r, v) => {
    r.runId = v;
  },
  '--config': (r, v) => {
    r.configFile = v;
  },
};

export const KNOWN_FLAGS = {
  boolean: Object.keys(BOOLEAN_FLAGS),
  value: Object.keys(VALUE_FLAGS),
  short: { ...SHORT_FLAGS },
} as const;

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

/** Parses the `=value` form of a boolean flag; undefined when unrecognizable. */
function parseBooleanValue(raw: string): boolean | undefined {
  const normalized = raw.toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;
  return undefined;
}

export function quoteArgv(argv: string[]): string {
  return argv
    .map((arg) => (arg === '' || /[^\w@%+=:,./-]/.test(arg) ? posixShellQuote(arg) : arg))
    .join(' ');
}

/** Splits a `quoteArgv` command back into its arguments; null when it is not one. */
export function splitQuotedArgv(command: string): string[] | null {
  const argv: string[] = [];
  let current = '';
  let inArg = false;
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!;
    if (c === "'") {
      const end = command.indexOf("'", i + 1);
      if (end === -1) return null;
      current += command.slice(i + 1, end);
      inArg = true;
      i = end;
    } else if (c === '\\') {
      if (i + 1 >= command.length) return null;
      current += command[++i];
      inArg = true;
    } else if (c === ' ') {
      if (inArg) argv.push(current);
      current = '';
      inArg = false;
    } else {
      current += c;
      inArg = true;
    }
  }
  if (inArg) argv.push(current);
  return argv;
}

export function parseCliArgs(argv: string[]): CliFlags {
  const result: CliFlags = {
    subcommand: null,
    help: false,
    version: false,
    restore: false,
  };

  let subcommandSeen = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const token = splitToken(arg);
    const flag = SHORT_FLAGS[token.name] ?? token.name;

    if (!flag.startsWith('-')) {
      if (subcommandSeen) {
        if (result.subcommand === 'completions' && result.completionShell === undefined) {
          result.completionShell = arg;
          continue;
        }
        throw new CliUsageError(`Unexpected argument '${arg}'`);
      }
      if (SUBCOMMANDS.includes(flag as Subcommand)) {
        result.subcommand = flag as Subcommand;
        subcommandSeen = true;
        continue;
      }
      throw new CliUsageError(`Unknown command '${arg}' (available: ${SUBCOMMANDS.join(', ')})`);
    }

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
        const parsed = parseBooleanValue(token.inlineValue);
        if (parsed === undefined) {
          throw new CliUsageError(`Cannot parse '${arg}': '${flag}' takes true or false`);
        }
        booleanFlag(result, parsed);
      }
      continue;
    }

    // Value flags — the inline `=` value, else the next token.
    const valueFlag = VALUE_FLAGS[flag];
    if (valueFlag === undefined) {
      throw new CliUsageError(`Unknown flag '${flag}'`);
    }
    const value = token.inlineValue ?? argv[i + 1];

    if (
      token.inlineValue === undefined &&
      value !== undefined &&
      SUBCOMMANDS.includes(value as Subcommand)
    ) {
      throw new CliUsageError(`Flag '${flag}' needs a value; '${value}' is a subcommand name`);
    }

    const hasValue =
      token.inlineValue !== undefined
        ? token.inlineValue !== ''
        : value !== undefined && value !== '' && !value.startsWith('-');
    if (!hasValue) {
      throw new CliUsageError(`Flag '${flag}' needs a value`);
    }

    valueFlag(result, value);
    if (token.inlineValue === undefined) i++;
  }

  return result;
}
