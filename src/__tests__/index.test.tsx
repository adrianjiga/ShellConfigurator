import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('ink', async () => {
  const actual = await vi.importActual<typeof import('ink')>('ink');
  return {
    ...actual,
    render: vi.fn().mockReturnValue({
      waitUntilExit: () => Promise.resolve(),
    }),
  };
});

vi.mock('../app.tsx', () => ({
  App: () => null,
}));

import { render } from 'ink';
import { handleCliArgs, reportFatal, restoreTerminal } from '../index.tsx';

describe('index CLI handling', () => {
  const originalArgv = process.argv.slice();
  const originalExitCode = process.exitCode;

  let stdoutWrite: ReturnType<typeof vi.spyOn>;
  let stderrWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true as never);
    stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as never);
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    stdoutWrite.mockRestore();
    stderrWrite.mockRestore();
    vi.mocked(render).mockClear();
  });

  it.each(['--version', '-v'])('prints version for %s', (flag) => {
    process.argv = ['node', 'index.tsx', flag];
    const result = handleCliArgs();
    expect(result).toBe(true);
    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringMatching(/^\d+\.\d+\.\d+\n$/));
  });

  it.each(['--help', '-h'])('prints help and exits for %s', (flag) => {
    process.argv = ['node', 'index.tsx', flag];
    const result = handleCliArgs();
    expect(result).toBe(true);
    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
  });

  it('does not consume args when unknown flags are passed', () => {
    process.argv = ['node', 'index.tsx', '--bogus'];
    const result = handleCliArgs();
    expect(result).toBe(false);
    expect(stdoutWrite).not.toHaveBeenCalled();
  });

  it('treats non-flag args as not a flag request', () => {
    process.argv = ['node', 'index.tsx', 'somefile'];
    const result = handleCliArgs();
    expect(result).toBe(false);
  });
});

describe('index restoreTerminal', () => {
  let setRawMode: ReturnType<typeof vi.fn>;
  let stdoutWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setRawMode = vi.fn();
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stdin, 'setRawMode', {
      value: setRawMode,
      configurable: true,
    });
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('disables raw mode on a TTY stdin', () => {
    restoreTerminal();
    expect(setRawMode).toHaveBeenCalledWith(false);
  });

  it('shows the cursor again', () => {
    restoreTerminal();
    expect(stdoutWrite).toHaveBeenCalledWith('\u001B[?25h');
  });

  it('does not throw when stdin has no setRawMode', () => {
    Object.defineProperty(process.stdin, 'setRawMode', { value: undefined, configurable: true });
    expect(() => restoreTerminal()).not.toThrow();
  });

  it('swallows write errors', () => {
    process.stdout.write = (() => {
      throw new Error('EPIPE');
    }) as typeof process.stdout.write;
    expect(() => restoreTerminal()).not.toThrow();
  });
});

describe('index reportFatal', () => {
  let stderrWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as never);
    process.exitCode = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = 0;
  });

  it('writes an Error stack and sets exit code 1', () => {
    const err = new Error('boom');
    reportFatal('ShellConfigurator crashed', err);
    expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('ShellConfigurator crashed'));
    expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('Error: boom'));
    expect(process.exitCode).toBe(1);
  });

  it('stringifies non-Error values', () => {
    reportFatal('prefix', 'some string');
    expect(stderrWrite).toHaveBeenCalledWith('\nprefix: some string\n');
    expect(process.exitCode).toBe(1);
  });
});
