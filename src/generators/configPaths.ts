import * as path from 'node:path';
import { configHome, homeDir } from '../services/paths.ts';
import type { ShellId } from '../types.ts';

/**
 * Path to one shell's own config, e.g. ~/.config/starship/zsh.toml, which the
 * shell's rc file points at via STARSHIP_CONFIG.
 */
export function getShellConfigPath(shellId: ShellId): string {
  return path.join(configHome(), 'starship', `${shellId}.toml`);
}

/**
 * The shared config, ~/.config/starship.toml: per-shell configs shadow it, and
 * only an adopt run with an imported config writes it.
 */
export function getSharedConfigPath(): string {
  // Starship's own default ignores XDG_CONFIG_HOME.
  return path.join(homeDir(), '.config', 'starship.toml');
}
