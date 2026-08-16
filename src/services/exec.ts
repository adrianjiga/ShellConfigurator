import { execFile, execFileSync, spawnSync } from 'child_process';
import { promisify } from 'util';

const execFileP = promisify(execFile);

/**
 * `command -v` is used rather than `which`, which is absent on minimal, Fedora,
 * and Alpine images. The command name is passed as `$1` instead of being spliced
 * into the script, so it can never be interpreted as shell syntax.
 */
const COMMAND_EXISTS_SCRIPT = 'command -v "$1"';

export function commandExists(cmd: string): boolean {
  try {
    execFileSync('sh', ['-c', COMMAND_EXISTS_SCRIPT, 'sh', cmd], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export async function commandExistsAsync(cmd: string): Promise<boolean> {
  try {
    await execFileP('sh', ['-c', COMMAND_EXISTS_SCRIPT, 'sh', cmd]);
    return true;
  } catch {
    return false;
  }
}

/** Runs a command and resolves its trimmed stdout; rejects on a non-zero exit. */
export async function runCapture(cmd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileP(cmd, args, { encoding: 'utf8' });
  return stdout.trim();
}

/** Absolute path of a command, or null when it is not on PATH. */
export function commandPath(cmd: string): string | null {
  try {
    return execFileSync('sh', ['-c', COMMAND_EXISTS_SCRIPT, 'sh', cmd], {
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Runs a command with stdio: 'inherit' so sudo password prompts appear in terminal.
 * This blocks the event loop, so Ink cannot repaint until the child exits — the UI
 * is frozen rather than paused, and the child writes to the same TTY Ink draws on.
 */
export function runCommand(args: string[]): void {
  const [cmd, ...rest] = args;
  if (!cmd) throw new Error('Empty command');

  const result = spawnSync(cmd, rest, { stdio: 'inherit' });

  if (result.error) throw result.error;
  if (result.signal) {
    throw new Error(`Command killed by signal ${result.signal}: ${args.join(' ')}`);
  }
  if (result.status !== 0) {
    throw new Error(`Command failed with exit code ${result.status}: ${args.join(' ')}`);
  }
}
