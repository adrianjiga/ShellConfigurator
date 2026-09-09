import * as os from 'node:os';
import * as path from 'node:path';
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
  /** Renders a PATH addition in this shell's own syntax, when one is needed. */
  pathLine?: (dir: string) => string;
}

export const SHELLS: ShellDef[] = [
  {
    id: 'zsh',
    binary: 'zsh',
    label: 'Zsh',
    rcFile: path.join(os.homedir(), '.zshrc'),
    initLine: 'eval "$(starship init zsh)"',
    pathLine: (dir) => `export PATH="${dir}:$PATH"`,
  },
  {
    id: 'bash',
    binary: 'bash',
    label: 'Bash',
    rcFile: path.join(os.homedir(), '.bashrc'),
    initLine: 'eval "$(starship init bash)"',
    pathLine: (dir) => `export PATH="${dir}:$PATH"`,
  },
  {
    id: 'fish',
    binary: 'fish',
    label: 'Fish',
    rcFile: path.join(os.homedir(), '.config', 'fish', 'config.fish'),
    initLine: 'starship init fish | source',
    pathLine: (dir) => `fish_add_path ${dir}`,
  },
  {
    id: 'nushell',
    binary: 'nu',
    label: 'Nushell',
    rcFile: null,
    initLine: `mkdir ($nu.data-dir | path join "vendor/autoload"); $"export-env { $env.STARSHIP_CONFIG = '($nu.default-config-dir | path dirname | path join starship nushell.toml)' }" | save -f ($nu.data-dir | path join "vendor/autoload/starship-config.nu"); starship init nu | save -f ($nu.data-dir | path join "vendor/autoload/starship.nu")`,
    manualNote: 'Run the above command once in Nushell to set up Starship.',
    initPath: path.join(os.homedir(), '.local', 'share', 'nu', 'vendor', 'autoload', 'starship.nu'),
  },
  {
    id: 'powershell',
    binary: 'pwsh',
    label: 'PowerShell',
    rcFile: null,
    initLine: 'Invoke-Expression (&starship init powershell)',
    manualNote: 'Add the above line to your $PROFILE file in PowerShell.',
    initPath: path.join(os.homedir(), '.config', 'powershell', 'Microsoft.PowerShell_profile.ps1'),
  },
];

export function getShell(id: ShellId): ShellDef | undefined {
  return SHELLS.find((s) => s.id === id);
}

/** Executable name for a shell, e.g. 'nu' for nushell. */
export function getShellBinary(id: ShellId): string {
  return SHELLS.find((s) => s.id === id)?.binary ?? id;
}
