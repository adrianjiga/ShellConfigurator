import * as path from 'node:path';
import { configHome, homeDir, xdgBaseDir } from '../services/paths.ts';
import type { ShellId } from '../types.ts';

export interface ShellDef {
  id: ShellId;
  label: string;
  /** Executable name on PATH — not always the same as the id (nushell → nu). */
  binary: string;
  rcFile: string | null;
  initLine: string;
  manualNote?: string;
  /**
   * For shells without an rc file: the file their manual init command writes
   * into (nushell autoload) or reads from (powershell $PROFILE). Lets the wizard
   * detect that the manual setup has already been applied.
   */
  initPath?: string;
  /** Additional files created by the manual setup, when all are required. */
  additionalInitPaths?: string[];
  /** Renders a PATH addition in this shell's own syntax, when one is needed. */
  pathLine?: (dir: string) => string;
}

export const SHELLS: ShellDef[] = [
  {
    id: 'zsh',
    binary: 'zsh',
    label: 'Zsh',
    get rcFile() {
      const zdotdir = process.env.ZDOTDIR?.trim();
      return path.join(zdotdir && path.isAbsolute(zdotdir) ? zdotdir : homeDir(), '.zshrc');
    },
    initLine: 'eval "$(starship init zsh)"',
    pathLine: (dir) => `export PATH="${dir}:$PATH"`,
  },
  {
    id: 'bash',
    binary: 'bash',
    label: 'Bash',
    get rcFile() {
      return path.join(homeDir(), '.bashrc');
    },
    initLine: 'eval "$(starship init bash)"',
    pathLine: (dir) => `export PATH="${dir}:$PATH"`,
  },
  {
    id: 'fish',
    binary: 'fish',
    label: 'Fish',
    get rcFile() {
      return path.join(configHome(), 'fish', 'config.fish');
    },
    initLine: 'starship init fish | source',
    pathLine: (dir) => `fish_add_path ${dir}`,
  },
  {
    id: 'nushell',
    binary: 'nu',
    label: 'Nushell',
    rcFile: null,
    // Run from Bash: the Nushell program is one POSIX-quoted argument to `nu -c`.
    // The config path is written in literally, so it is the file the wizard wrote.
    get initLine() {
      const pin = `export-env { $env.STARSHIP_CONFIG = "${perShellConfigPath('nushell')}" }`;
      return `nu -c ${posixShellQuote(
        `let d = ($nu.data-dir | path join vendor/autoload); mkdir $d; ` +
          `starship init nu | save -f ($d | path join starship.nu); ` +
          `'${pin}' | save -f ($d | path join starship-config.nu)`
      )}`;
    },
    manualNote: 'Run the command above from Bash (it invokes Nushell to write its autoload files).',
    get initPath() {
      return path.join(nushellDataDir(), 'vendor', 'autoload', 'starship.nu');
    },
    get additionalInitPaths() {
      return [path.join(nushellDataDir(), 'vendor', 'autoload', 'starship-config.nu')];
    },
  },
  {
    id: 'powershell',
    binary: 'pwsh',
    label: 'PowerShell',
    rcFile: null,
    // Must be set before init, or PowerShell reads the shared starship.toml.
    get initLine() {
      const configPath = perShellConfigPath('powershell').replaceAll("'", "''");
      return `$env:STARSHIP_CONFIG = '${configPath}'; Invoke-Expression (&starship init powershell)`;
    },
    manualNote: 'Add the above line to your $PROFILE file in PowerShell.',
    get initPath() {
      return path.join(configHome(), 'powershell', 'Microsoft.PowerShell_profile.ps1');
    },
  },
];

/** The per-shell config the wizard writes; mirrors getShellConfigPath in shellRc.ts. */
function perShellConfigPath(id: ShellId): string {
  return path.join(configHome(), 'starship', `${id}.toml`);
}

/** Nushell's `$nu.data-dir`. */
function nushellDataDir(): string {
  if (process.platform === 'darwin') {
    return path.join(homeDir(), 'Library', 'Application Support', 'nushell');
  }
  return path.join(xdgBaseDir('XDG_DATA_HOME', path.join(homeDir(), '.local', 'share')), 'nushell');
}

function posixShellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function getShell(id: ShellId): ShellDef | undefined {
  return SHELLS.find((s) => s.id === id);
}

/** Executable name for a shell, e.g. 'nu' for nushell. */
const SHELL_IDS: readonly ShellId[] = SHELLS.map((s) => s.id);

export function isShellId(id: unknown): id is ShellId {
  return typeof id === 'string' && (SHELL_IDS as readonly string[]).includes(id);
}

export function getShellBinary(id: ShellId): string {
  const shell = getShell(id);
  if (!shell) throw new Error(`Unknown shell: ${id}`);
  return shell.binary;
}
