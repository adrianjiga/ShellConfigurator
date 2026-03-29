import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ShellId } from '../types.js';
import { getShell } from '../config/shells.js';

const STARSHIP_CONFIG_DIR = path.join(os.homedir(), '.config');
const STARSHIP_CONFIG_PATH = path.join(STARSHIP_CONFIG_DIR, 'starship.toml');

export function writeStarshipConfig(toml: string): void {
  if (!fs.existsSync(STARSHIP_CONFIG_DIR)) {
    fs.mkdirSync(STARSHIP_CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(STARSHIP_CONFIG_PATH, toml, 'utf8');
}

export function applyShellConfig(shellId: ShellId): { applied: boolean; note?: string } {
  const shell = getShell(shellId);
  if (!shell) return { applied: false };

  // Shells with no automatic rc file (nushell, powershell) need manual setup
  if (!shell.rcFile) {
    return { applied: false, note: shell.manualNote };
  }

  const rcPath = shell.rcFile;

  // Ensure parent directory exists (important for fish)
  const rcDir = path.dirname(rcPath);
  if (!fs.existsSync(rcDir)) {
    fs.mkdirSync(rcDir, { recursive: true });
  }

  const existing = fs.existsSync(rcPath) ? fs.readFileSync(rcPath, 'utf8') : '';

  // Idempotent: skip if already configured
  if (existing.includes('starship init')) {
    return { applied: false, note: 'already configured' };
  }

  const addition = `\n# Added by ShellConfigurator\n${shell.initLine}\n`;
  fs.appendFileSync(rcPath, addition, 'utf8');

  return { applied: true };
}

export function getConfigPath(): string {
  return STARSHIP_CONFIG_PATH;
}
