import * as os from 'os';
import * as path from 'path';
import { ShellId } from '../types.js';

export interface ShellDef {
  id: ShellId;
  label: string;
  rcFile: string | null;
  initLine: string;
  manualNote?: string;
  /** Renders a PATH addition in this shell's own syntax, when one is needed. */
  pathLine?: (dir: string) => string;
}

export const SHELLS: ShellDef[] = [
  {
    id: 'zsh',
    label: 'Zsh',
    rcFile: path.join(os.homedir(), '.zshrc'),
    initLine: 'eval "$(starship init zsh)"',
    pathLine: (dir) => `export PATH="${dir}:$PATH"`,
  },
  {
    id: 'bash',
    label: 'Bash',
    rcFile: path.join(os.homedir(), '.bashrc'),
    initLine: 'eval "$(starship init bash)"',
    pathLine: (dir) => `export PATH="${dir}:$PATH"`,
  },
  {
    id: 'fish',
    label: 'Fish',
    rcFile: path.join(os.homedir(), '.config', 'fish', 'config.fish'),
    initLine: 'starship init fish | source',
    pathLine: (dir) => `fish_add_path ${dir}`,
  },
  {
    id: 'nushell',
    label: 'Nushell',
    rcFile: null,
    initLine: 'starship init nu | save -f ($nu.data-dir | path join "vendor/autoload/starship.nu")',
    manualNote: 'Run the above command once in Nushell to set up Starship.',
  },
  {
    id: 'powershell',
    label: 'PowerShell',
    rcFile: null,
    initLine: 'Invoke-Expression (&starship init powershell)',
    manualNote: 'Add the above line to your $PROFILE file in PowerShell.',
  },
];

export function getShell(id: ShellId): ShellDef | undefined {
  return SHELLS.find((s) => s.id === id);
}
