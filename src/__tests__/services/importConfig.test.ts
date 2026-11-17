import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockDetectInstalledShells,
  mockDetectPackageManager,
  mockDetectContainer,
  mockDetectTerminal,
  mockFindStarship,
  mockRunInstallTasks,
  mockRecordRun,
} = vi.hoisted(() => ({
  mockFindStarship: vi.fn(
    async (): Promise<{ installed: boolean; pathDir?: string }> => ({
      installed: false,
    })
  ),
  mockDetectInstalledShells: vi.fn(),
  mockDetectPackageManager: vi.fn(),
  mockDetectContainer: vi.fn(),
  mockDetectTerminal: vi.fn(),
  mockRunInstallTasks: vi.fn(),
  mockRecordRun: vi.fn(),
}));

vi.mock('../../services/detector.ts', async () => {
  const actual = await vi.importActual<typeof import('../../services/detector.ts')>(
    '../../services/detector.ts'
  );
  return {
    ...actual,
    detectInstalledShellsAsync: mockDetectInstalledShells,
    detectPackageManagerAsync: mockDetectPackageManager,
    detectContainerAsync: mockDetectContainer,
    detectTerminalAsync: mockDetectTerminal,
    findStarshipAsync: mockFindStarship,
  };
});

vi.mock('../../services/installTasks.ts', async () => {
  const actual = await vi.importActual<typeof import('../../services/installTasks.ts')>(
    '../../services/installTasks.ts'
  );
  return {
    ...actual,
    runInstallTasks: mockRunInstallTasks,
  };
});

vi.mock('../../services/history.ts', async () => {
  const actual = await vi.importActual<typeof import('../../services/history.ts')>(
    '../../services/history.ts'
  );
  return {
    ...actual,
    recordRun: mockRecordRun,
    recordRunSafely: (options: Parameters<typeof actual.recordRun>[0]) =>
      actual.recordRunSafely(options, mockRecordRun),
  };
});

import type { CliFlags } from '../../services/args.ts';
import { CliRunError, CliUsageError } from '../../services/errors.ts';
import { runApply } from '../../services/headless.ts';
import { customCommands, fetchImportedConfig } from '../../services/importConfig.ts';
import { DEFAULT_INSTALL_TASK_DEPS } from '../../services/installTasks.ts';
import { stubPlatform } from '../helpers/platform.ts';

const flags = (partial: Partial<CliFlags>): CliFlags => ({
  subcommand: 'generate',
  help: false,
  version: false,
  ...partial,
});

describe('runApply --import-url', () => {
  let stdoutWrite: ReturnType<typeof vi.spyOn>;
  let stderrWrite: ReturnType<typeof vi.spyOn>;

  let restorePlatform: () => void;
  let scratchHome: string;
  beforeEach(() => {
    restorePlatform = stubPlatform('linux');
    scratchHome = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-configurator-home-'));
    vi.stubEnv('HOME', scratchHome);
    vi.stubEnv('XDG_CONFIG_HOME', undefined);
    vi.stubEnv('XDG_STATE_HOME', undefined);
    vi.stubEnv('ZDOTDIR', undefined);
    vi.clearAllMocks();
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true as never);
    stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as never);
    mockDetectInstalledShells.mockResolvedValue(['zsh']);
    mockDetectPackageManager.mockResolvedValue('apt');
    mockDetectContainer.mockResolvedValue(false);
    mockDetectTerminal.mockResolvedValue(null);
    mockRecordRun.mockReturnValue(undefined);
    process.exitCode = undefined;
  });

  afterEach(() => {
    restorePlatform();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(scratchHome, { recursive: true, force: true });
  });

  it('does not download an import URL when the plan has no shells', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('[a]', { status: 200 }));

    await expect(
      runApply(flags({ subcommand: 'apply', importUrl: 'https://example.com/raw' }))
    ).rejects.toThrow(/none are selected/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('shows terminal control characters of a fetched config in a dry run instead of sending them', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('[character]\n\u001b[1A\u001b[2Kformat = "$all"\n', { status: 200 })
    );

    await runApply(
      flags({
        subcommand: 'apply',
        shells: ['zsh'],
        dryRun: true,
        importUrl: 'https://example.com/raw',
      })
    );

    const output = stdoutWrite.mock.calls
      .map((call: [string, ...unknown[]]) => String(call[0]))
      .join('');
    expect(output).toContain('\\u001b[1A\\u001b[2Kformat');
    expect(output).not.toContain('\u001b[2K');
  });

  it('adopts an imported URL in dry-run instead of generating a TOML', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('[character]\nsuccess_symbol = "…"\n', { status: 200 })
    );

    await runApply(
      flags({
        subcommand: 'apply',
        shells: ['zsh'],
        importUrl: 'https://gist.example/raw',
        dryRun: true,
      })
    );

    const output = stdoutWrite.mock.calls
      .map((call: [string, ...unknown[]]) => String(call[0]))
      .join('');
    expect(output).toContain('Config to keep');
    expect(output).toContain('success_symbol = "…"');
    expect(output).not.toContain('Generated starship.toml');
    expect(mockRunInstallTasks).not.toHaveBeenCalled();
  });

  it('feeds the fetched config into the install as the shared config', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('[character]\nsuccess_symbol = "…"\n', { status: 200 })
    );
    const fakeTask = { id: 'config', label: 'Keep existing Starship config', status: 'done' };
    mockRunInstallTasks.mockResolvedValue([fakeTask] as never);

    await runApply(
      flags({ subcommand: 'apply', shells: ['zsh'], importUrl: 'https://gist.example/raw' })
    );

    expect(mockRunInstallTasks).toHaveBeenCalledWith(
      expect.objectContaining({
        keepExistingConfig: true,
        sharedConfigToml: '[character]\nsuccess_symbol = "…"\n',
      }),
      DEFAULT_INSTALL_TASK_DEPS,
      expect.any(Function),
      expect.any(AbortSignal)
    );
  });

  it('rejects a non-http import URL as a usage error', async () => {
    await expect(
      runApply(flags({ subcommand: 'apply', shells: ['zsh'], importUrl: 'ftp://nope' }))
    ).rejects.toThrow(CliUsageError);
  });

  it('refuses a plain-http import URL', async () => {
    await expect(fetchImportedConfig('http://example.com/starship.toml')).rejects.toThrow(
      /requires an https URL/
    );
  });

  it('accepts an uppercase scheme', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[a]', { status: 200 }));

    await expect(fetchImportedConfig('HTTPS://example.com/starship.toml')).resolves.toBe('[a]');
  });

  it('refuses a URL with a user name or password before fetching, without printing them', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const error = await fetchImportedConfig(
      'https://user:s3cret@example.com/config.toml?token=abc123'
    ).catch((err: Error) => err);

    expect(error).toBeInstanceOf(CliUsageError);
    expect((error as Error).message).toContain('cannot send a user name or password');
    expect((error as Error).message).not.toMatch(/s3cret|abc123/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('warns about the commands an imported config runs on every prompt', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('[custom.ip]\ncommand = "curl -s https://ip.example"\nwhen = true\n', {
        status: 200,
      })
    );

    await runApply(
      flags({
        subcommand: 'apply',
        shells: ['zsh'],
        dryRun: true,
        importUrl: 'https://example.com/c',
      })
    );

    expect(stderrWrite).toHaveBeenCalledWith(
      expect.stringContaining('command = "curl -s https://ip.example"')
    );
  });

  it('refuses a redirect through plain http on the way, not only at the end', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'http://example.com/cfg.toml' } })
    );

    await expect(fetchImportedConfig('https://example.com/start')).rejects.toThrow(
      "Could not fetch 'https://example.com/start': redirected to a non-https URL http://example.com/cfg.toml"
    );
  });

  it('refuses a redirect to a URL with a user name or password, without printing them', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: 'https://user:t0ken@example.com/cfg.toml' },
      })
    );

    const err = await fetchImportedConfig('https://example.com/start').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CliRunError);
    expect((err as Error).message).toBe(
      "Could not fetch 'https://example.com/start': redirected to a URL with a user name or password (https://example.com/cfg.toml), which --import-url does not send."
    );
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('follows https redirects to the config', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(null, { status: 301, headers: { location: '/moved/cfg.toml' } })
      )
      .mockResolvedValueOnce(new Response('[character]\n'));

    await expect(fetchImportedConfig('https://example.com/start')).resolves.toBe('[character]\n');
    expect(fetchSpy.mock.calls[1]![0]).toBe('https://example.com/moved/cfg.toml');
  });

  it('releases the body of every redirect it follows', async () => {
    const redirect = new Response('moved', { status: 302, headers: { location: '/cfg.toml' } });
    const cancel = vi.spyOn(redirect.body!, 'cancel');
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(redirect)
      .mockResolvedValueOnce(new Response('[character]\n'));

    await fetchImportedConfig('https://example.com/start');

    expect(cancel).toHaveBeenCalled();
  });

  it('keeps the query out of fetch error messages, also the one fetch gives', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('failed: https://example.com/config.toml?token=abc123')
    );

    const error = await fetchImportedConfig('https://example.com/config.toml?token=abc123').catch(
      (err: Error) => err
    );

    expect((error as Error).message).not.toContain('abc123');
    expect((error as Error).message).toContain("'https://example.com/config.toml'");
  });

  it('rejects an HTTP error when fetching an imported config as a run failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }));

    await expect(
      runApply(
        flags({ subcommand: 'apply', shells: ['zsh'], importUrl: 'https://example.com/404' })
      )
    ).rejects.toThrow(/HTTP 404/);
    await expect(fetchImportedConfig('https://example.com/404', { timeoutMs: 5 })).rejects.toThrow(
      CliRunError
    );
  });

  it('rejects an empty body from a URL fetch', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));

    await expect(
      runApply(
        flags({ subcommand: 'apply', shells: ['zsh'], importUrl: 'https://example.com/empty' })
      )
    ).rejects.toThrow(/no config content/);
  });

  it('rejects a whitespace-only body from a URL fetch', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(' \n\t\n', { status: 200 }));
    await expect(fetchImportedConfig('https://example.com/blank')).rejects.toThrow(
      /no config content/
    );
  });

  it('ignores a content-length that is not a number and checks the real bytes', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('format = "$all"\n', { status: 200, headers: { 'content-length': 'lots' } })
    );
    await expect(fetchImportedConfig('https://example.com/odd-length')).resolves.toContain(
      'format = "$all"'
    );
  });

  it('rejects an HTML page instead of adopting it as a config', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<!DOCTYPE html><html><body>gist</body></html>', { status: 200 })
    );

    await expect(fetchImportedConfig('https://gist.example.com/not-raw')).rejects.toThrow(
      /returned HTML, not a TOML config/
    );
  });

  it('rejects an oversized imported config based on the declared content-length', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('small', { status: 200, headers: { 'content-length': '9000000' } })
    );

    await expect(
      runApply(
        flags({ subcommand: 'apply', shells: ['zsh'], importUrl: 'https://example.com/lies' })
      )
    ).rejects.toThrow(/server reports 9000000 bytes/);
  });

  it('rejects an oversized imported config based on the actual downloaded bytes', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('a'.repeat(1_000_001), { status: 200 })
    );

    await expect(
      runApply(
        flags({ subcommand: 'apply', shells: ['zsh'], importUrl: 'https://example.com/huge' })
      )
    ).rejects.toThrow(/config exceeds 1000000 bytes/);
  });

  it('stops reading an oversized streamed body instead of buffering it whole', async () => {
    let cancelled = false;
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 50) throw new Error('kept reading past the cap');
        controller.enqueue(new Uint8Array(100_000));
      },
      cancel() {
        cancelled = true;
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 200 }));

    await expect(
      fetchImportedConfig('https://example.com/stream', { maxBytes: 1_000_000 })
    ).rejects.toThrow(/config exceeds 1000000 bytes/);
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThanOrEqual(12);
  });

  it('times out a hung import fetch and says how long it waited', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new DOMException('The operation was aborted', 'TimeoutError')
    );

    await expect(fetchImportedConfig('https://example.com/slow', { timeoutMs: 1 })).rejects.toThrow(
      /timed out after 1ms/
    );
  });

  it('reports a body that fails mid-read as a run failure, not a stack trace', async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(10));
        controller.error(new Error('ECONNRESET'));
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 200 }));

    await expect(fetchImportedConfig('https://example.com/reset')).rejects.toThrow(CliRunError);
    await expect(fetchImportedConfig('https://example.com/reset')).rejects.toThrow(/ECONNRESET/);
  });

  it('keeps a token out of the message when reading the body fails', async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('socket hang up at https://example.com/cfg?token=s3cret'));
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 200 }));

    const err = await fetchImportedConfig('https://example.com/cfg').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CliRunError);
    expect((err as Error).message).toContain('socket hang up at https://example.com/cfg');
    expect((err as Error).message).not.toContain('s3cret');
  });

  it('passes a timeout signal to fetch so a hung request aborts', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('[a]', { status: 200 }));

    await fetchImportedConfig('https://example.com/fast', { timeoutMs: 5 });

    const signal = (fetchSpy.mock.calls[0]![1] as RequestInit).signal!;
    expect(signal.aborted).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(signal.aborted).toBe(true);
    expect((signal.reason as Error).name).toBe('TimeoutError');
  });

  it('reports a network failure when fetching an imported config', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ENOTFOUND'));

    await expect(
      runApply(
        flags({ subcommand: 'apply', shells: ['zsh'], importUrl: 'https://offline.test/raw' })
      )
    ).rejects.toThrow(/Could not fetch.*ENOTFOUND/);
  });
});

describe('customCommands', () => {
  it('lists every line that may set a command, in any TOML form', () => {
    const toml = [
      '[directory]',
      'truncation_length = 3',
      '[custom.git_email]',
      'command = "git config user.email"',
      'when = "git rev-parse"',
      '[ custom . spaced ]',
      '"command" = "quoted key"',
      'custom.dotted.command = "dotted key"',
      '[custom]',
      'inline = { command = "inline table", when = true }',
      'multi = { shell = ["bash"] }',
      '[custom.long]',
      'command = """',
      'curl -s https://example.com',
      '"""',
      '# command = "a comment"',
    ].join('\n');

    expect(customCommands(toml)).toEqual([
      '[custom.git_email]',
      'command = "git config user.email"',
      'when = "git rev-parse"',
      '[ custom . spaced ]',
      '"command" = "quoted key"',
      'custom.dotted.command = "dotted key"',
      '[custom]',
      'inline = { command = "inline table", when = true }',
      'multi = { shell = ["bash"] }',
      '[custom.long]',
      'command = """',
      'curl -s https://example.com',
      '"""',
    ]);
  });

  it('lists a key or table spelled with escapes, which could hide a command', () => {
    expect(
      customCommands('["\\u0063ustom".x]\n"\\u0063ommand" = "id"\nformat = "\\u2192 $all"\n')
    ).toEqual(['["\\u0063ustom".x]', '"\\u0063ommand" = "id"']);
  });

  it('finds nothing in a config without commands', () => {
    expect(customCommands('[directory]\ntruncation_length = 3\n')).toEqual([]);
  });
});
