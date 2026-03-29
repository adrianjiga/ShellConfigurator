import { execSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ShellId, PackageManager } from '../types.js';

// Package names per shell per package manager
const SHELL_PACKAGES: Record<ShellId, Partial<Record<PackageManager, string>>> = {
  bash:       { pacman: 'bash',        apt: 'bash',        dnf: 'bash',        brew: 'bash'        },
  zsh:        { pacman: 'zsh',         apt: 'zsh',         dnf: 'zsh',         brew: 'zsh'         },
  fish:       { pacman: 'fish',        apt: 'fish',        dnf: 'fish',        brew: 'fish'        },
  nushell:    { pacman: 'nushell',     apt: 'nushell',     dnf: 'nushell',     brew: 'nushell'     },
  powershell: { pacman: 'powershell',  apt: 'powershell',  dnf: 'powershell',  brew: 'powershell'  },
};

const INSTALL_CMDS: Record<PackageManager, (pkg: string) => string[]> = {
  pacman: (pkg) => ['sudo', 'pacman', '-S', '--noconfirm', pkg],
  apt:    (pkg) => ['sudo', 'apt-get', 'install', '-y', pkg],
  dnf:    (pkg) => ['sudo', 'dnf', 'install', '-y', pkg],
  brew:   (pkg) => ['brew', 'install', pkg],
  curl:   (_)   => [],
};

// Nerd Font definitions: id → GitHub release zip name
export const NERD_FONTS: Array<{ id: string; label: string; zipName: string }> = [
  { id: 'JetBrainsMono', label: 'JetBrains Mono',  zipName: 'JetBrainsMono.zip'  },
  { id: 'FiraCode',      label: 'Fira Code',        zipName: 'FiraCode.zip'       },
  { id: 'Hack',          label: 'Hack',             zipName: 'Hack.zip'           },
  { id: 'CascadiaCode',  label: 'Cascadia Code',    zipName: 'CascadiaCode.zip'   },
  { id: 'Meslo',         label: 'Meslo LG',         zipName: 'Meslo.zip'          },
  { id: 'SourceCodePro', label: 'Source Code Pro',  zipName: 'SourceCodePro.zip'  },
];

const NERD_FONTS_BASE_URL =
  'https://github.com/ryanoasis/nerd-fonts/releases/latest/download';

// Runs a command with stdio: 'inherit' so sudo password prompts appear in terminal.
// Ink pauses while this runs (it's synchronous/blocking).
function runCommand(args: string[]): void {
  const [cmd, ...rest] = args;
  if (!cmd) throw new Error('Empty command');

  const result = spawnSync(cmd, rest, { stdio: 'inherit' });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Command failed with exit code ${result.status}: ${args.join(' ')}`);
  }
}

export async function installStarship(pm: PackageManager): Promise<void> {
  if (pm === 'curl') {
    // Official install script — installs to ~/.local/bin, no sudo needed
    runCommand(['sh', '-c', 'curl -sS https://starship.rs/install.sh | sh -s -- --yes']);
    return;
  }

  const cmdArgs = INSTALL_CMDS[pm]('starship');
  if (cmdArgs.length === 0) throw new Error(`No install method for package manager: ${pm}`);
  runCommand(cmdArgs);
}

export async function installShell(shellId: ShellId, pm: PackageManager): Promise<void> {
  const pkg = SHELL_PACKAGES[shellId][pm];
  if (!pkg) throw new Error(`No package for ${shellId} on ${pm}`);

  if (pm === 'curl') throw new Error(`Cannot auto-install ${shellId} without a package manager`);

  runCommand(INSTALL_CMDS[pm](pkg));
}

export async function installNerdFont(fontId: string): Promise<void> {
  const font = NERD_FONTS.find((f) => f.id === fontId);
  if (!font) throw new Error(`Unknown font: ${fontId}`);

  const fontsDir = path.join(os.homedir(), '.local', 'share', 'fonts');
  fs.mkdirSync(fontsDir, { recursive: true });

  const zipPath = path.join(os.tmpdir(), font.zipName);
  const url = `${NERD_FONTS_BASE_URL}/${font.zipName}`;

  // Download
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download font: HTTP ${response.status}`);

  const buffer = await response.arrayBuffer();
  fs.writeFileSync(zipPath, Buffer.from(buffer));

  // Extract with unzip
  runCommand(['unzip', '-o', '-q', zipPath, '-d', fontsDir]);

  // Clean up zip
  fs.unlinkSync(zipPath);

  // Refresh font cache
  runCommand(['fc-cache', '-fv']);
}

export async function setDefaultShell(shellId: ShellId): Promise<void> {
  const binaries: Record<ShellId, string> = {
    bash:       'bash',
    zsh:        'zsh',
    fish:       'fish',
    nushell:    'nu',
    powershell: 'pwsh',
  };

  const binary = binaries[shellId];
  let shellPath: string;

  try {
    shellPath = execSync(`which ${binary}`, { encoding: 'utf8', stdio: 'pipe' }).trim();
  } catch {
    throw new Error(`${binary} not found in PATH`);
  }

  // chsh prompts for current user's password itself — run with stdio: 'inherit'
  runCommand(['chsh', '-s', shellPath]);
}
