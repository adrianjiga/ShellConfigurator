import { execFile, execFileSync, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { suspendUi, resumeUi } from './tty.js';

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

/** The child currently holding the terminal, so a cancel request can kill it. */
let activeChild: ChildProcess | null = null;

/** Kills the running command, if any. Used to abort the install phase. */
export function killActiveCommand(signal: NodeJS.Signals = 'SIGTERM'): void {
  activeChild?.kill(signal);
}

export class CommandCancelledError extends Error {
  constructor(command: string) {
    super(`Cancelled: ${command}`);
    this.name = 'CommandCancelledError';
  }
}

/**
 * Runs a command with stdio: 'inherit' so sudo password prompts appear in the
 * terminal.
 *
 * Async rather than spawnSync: a blocking call freezes the whole Ink render loop
 * and gives no way to cancel. Because the child writes to the same TTY Ink draws
 * on, the UI is suspended for the child's lifetime so the two cannot interleave.
 */
export function runCommand(args: string[], options: { signal?: AbortSignal } = {}): Promise<void> {
  const [cmd, ...rest] = args;
  if (!cmd) return Promise.reject(new Error('Empty command'));

  const printable = args.join(' ');
  if (options.signal?.aborted) {
    return Promise.reject(new CommandCancelledError(printable));
  }

  return new Promise<void>((resolve, reject) => {
    suspendUi();
    const child = spawn(cmd, rest, { stdio: 'inherit' });
    activeChild = child;

    let cancelled = false;
    const onAbort = () => {
      cancelled = true;
      child.kill('SIGTERM');
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    const settle = (fn: () => void) => {
      options.signal?.removeEventListener('abort', onAbort);
      if (activeChild === child) activeChild = null;
      resumeUi();
      fn();
    };

    child.on('error', (err) => settle(() => reject(err)));

    child.on('close', (status, signal) => {
      if (cancelled) {
        settle(() => reject(new CommandCancelledError(printable)));
      } else if (signal) {
        settle(() => reject(new Error(`Command killed by signal ${signal}: ${printable}`)));
      } else if (status !== 0) {
        settle(() => reject(new Error(`Command failed with exit code ${status}: ${printable}`)));
      } else {
        settle(resolve);
      }
    });
  });
}
