import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRouteCli, mockRender, mockWaitUntilExit } = vi.hoisted(() => ({
  mockRouteCli: vi.fn(),
  mockRender: vi.fn(),
  mockWaitUntilExit: vi.fn(),
}));

vi.mock('../cli/route.ts', () => ({ routeCli: mockRouteCli }));
vi.mock('../app.tsx', () => ({ App: () => null }));
vi.mock('ink', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ink')>()),
  render: mockRender,
}));

import { main } from '../index.tsx';
import { parseCliArgs } from '../services/args.ts';

describe('main', () => {
  const tty = { stdin: process.stdin.isTTY, stdout: process.stdout.isTTY };
  beforeEach(() => {
    vi.clearAllMocks();
    mockWaitUntilExit.mockResolvedValue(undefined);
    mockRender.mockReturnValue({ waitUntilExit: mockWaitUntilExit, unmount: vi.fn() });
  });
  afterEach(() => {
    process.stdin.isTTY = tty.stdin;
    process.stdout.isTTY = tty.stdout;
  });

  it('leaves a handled command to the CLI and never draws the wizard', async () => {
    mockRouteCli.mockResolvedValue({ handled: true, flags: parseCliArgs(['list', 'fonts']) });

    await main();

    expect(mockRender).not.toHaveBeenCalled();
  });

  it('draws the wizard on a terminal, with Ctrl+C left to the app, and waits for it', async () => {
    mockRouteCli.mockResolvedValue({ handled: false, flags: parseCliArgs(['--dry-run']) });
    process.stdin.isTTY = true;
    process.stdout.isTTY = true;

    await main();

    expect(mockRender).toHaveBeenCalledWith(expect.anything(), {
      exitOnCtrlC: false,
      interactive: true,
    });
    expect(mockWaitUntilExit).toHaveBeenCalled();
  });

  it('reports a render error and closes the wizard instead of waiting for Ctrl+C', async () => {
    mockRouteCli.mockResolvedValue({ handled: false, flags: parseCliArgs([]) });
    process.stdin.isTTY = true;
    process.stdout.isTTY = true;
    const unmount = vi.fn();
    mockRender.mockReturnValue({ waitUntilExit: mockWaitUntilExit, unmount });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exitCode = process.exitCode;
    try {
      await main();
      const boundary = mockRender.mock.calls[0]![0] as {
        props: { onError: (err: unknown) => void };
      };

      boundary.props.onError(new Error('boom'));
      await new Promise((resolve) => setImmediate(resolve));

      expect(stderr).toHaveBeenCalledWith(
        expect.stringContaining('ShellConfigurator hit a render error')
      );
      expect(process.exitCode).toBe(1);
      expect(unmount).toHaveBeenCalled();
    } finally {
      stderr.mockRestore();
      process.exitCode = exitCode;
    }
  });

  it('refuses to draw the wizard without a terminal', async () => {
    mockRouteCli.mockResolvedValue({ handled: false, flags: parseCliArgs([]) });
    process.stdin.isTTY = false;

    await expect(main()).rejects.toThrow('The wizard needs a terminal');
    expect(mockRender).not.toHaveBeenCalled();
  });
});
