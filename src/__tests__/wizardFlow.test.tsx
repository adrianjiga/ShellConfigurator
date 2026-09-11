import { parse } from '@iarna/toml';
import { cleanup, render } from 'ink-testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, waitFor } from './helpers/wait.ts';

// Only the side-effecting edges are stubbed. generateToml, the step machine, the
// screens, and runInstallTasks all run for real, so this exercises the whole
// keypress -> state -> generated config path. The installers are hoisted so tests
// can script them (failure, missing shells, font install).
const { mockDetectInstalledShells, mockInstallShell, mockInstallNerdFont } = vi.hoisted(() => ({
  mockDetectInstalledShells: vi.fn().mockResolvedValue(['zsh', 'bash', 'fish']),
  mockInstallShell: vi.fn().mockResolvedValue(undefined),
  mockInstallNerdFont: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/detector.ts', () => ({
  detectPackageManagerAsync: vi.fn().mockResolvedValue('apt'),
  isStarshipInstalledAsync: vi
    .fn()
    .mockResolvedValue({ installed: true, version: 'starship 1.20' }),
  detectInstalledShellsAsync: mockDetectInstalledShells,
  detectCurrentShellAsync: vi.fn().mockResolvedValue(null),
}));

const { mockWriteConfig, mockApplyShellConfig, mockResetSharedConfig } = vi.hoisted(() => ({
  mockWriteConfig: vi.fn((_toml: string, _shellId: string) => ({
    path: '/tmp/starship.toml',
  })),
  mockApplyShellConfig: vi.fn(() => ({ applied: true })),
  mockResetSharedConfig: vi.fn(() => ({ applied: false })),
}));

vi.mock('../generators/shellRc.ts', () => ({
  writeShellConfig: mockWriteConfig,
  applyShellConfig: mockApplyShellConfig,
  resetSharedShellConfig: mockResetSharedConfig,
  backupSharedConfig: vi.fn(() => null),
  getShellConfigPath: () => '/tmp/starship.toml',
  starshipConfigLine: () => 'export STARSHIP_CONFIG="/tmp/starship.toml"',
}));

vi.mock('../services/installer.ts', () => ({
  NERD_FONTS: [{ id: 'JetBrainsMono', label: 'JetBrains Mono', zipName: 'JetBrainsMono.zip' }],
  installStarship: vi.fn().mockResolvedValue(undefined),
  installShell: mockInstallShell,
  installNerdFont: mockInstallNerdFont,
  setDefaultShell: vi.fn().mockResolvedValue(undefined),
  getMissingStarshipPathDir: vi.fn(() => null),
  getNerdFontsDir: () => '/tmp/fonts',
  fontLabel: (id: string) => id,
}));

import { App } from '../app.tsx';

const ENTER = '\r';
const SPACE = ' ';
const DOWN = '\u001B[B';

const INITIAL_EXIT_CODE = process.exitCode;

afterEach(() => {
  cleanup();
  process.exitCode = INITIAL_EXIT_CODE;
  // clearAllMocks wipes calls but not implementations; restore the hoisted
  // defaults so a test's scripting does not leak into the next one.
  mockDetectInstalledShells.mockReset().mockResolvedValue(['zsh', 'bash', 'fish']);
  mockInstallShell.mockReset().mockResolvedValue(undefined);
  mockInstallNerdFont.mockReset().mockResolvedValue(undefined);
});
beforeEach(() => vi.clearAllMocks());

/** Walks the wizard to the end and returns the TOML that was written. */
async function runWizard(
  keys: string[],
  instanceOut?: { instance: ReturnType<typeof render> }
): Promise<string> {
  const instance = render(<App />);
  await flush();
  if (instanceOut) instanceOut.instance = instance;

  for (const key of keys) {
    instance.stdin.write(key);
    await flush();
  }

  // The install chain is async; let its microtasks drain.
  for (let i = 0; i < 20 && mockWriteConfig.mock.calls.length === 0; i++) {
    await flush();
  }

  expect(mockWriteConfig).toHaveBeenCalled();
  return mockWriteConfig.mock.calls[0]![0];
}

/** The InstallingScreen advances to Done ~1.2s after the chain ends; wait for it. */

describe('full wizard walkthrough', () => {
  it('writes parseable TOML reflecting the default choices', async () => {
    const toml = await runWizard([
      ENTER, // welcome -> fontcheck
      ENTER, // "Yes, I have one" -> preset
      ENTER, // first preset -> segments_left
      ENTER, // accept left segments -> segments_right
      ENTER, // accept right segments -> style
      ENTER, // accept style -> shells
      SPACE, // select zsh
      ENTER, // -> review
      ENTER, // -> installing
    ]);

    const parsed = parse(toml) as Record<string, unknown>;
    expect(typeof parsed.format).toBe('string');
    expect(parsed.format as string).toContain('$character');
    // The character block must be emitted, not just referenced in the format.
    expect(toml).toContain('[character]');
  });

  it('carries the prompt character choice all the way into the config', async () => {
    const toml = await runWizard([
      ENTER, // welcome
      ENTER, // fontcheck
      ENTER, // preset
      ENTER, // segments_left
      ENTER, // segments_right
      DOWN, // style: character focus starts on arrow; move down to lambda
      ENTER, // style: confirm -> shells (Tab switches section, it does not confirm)
      SPACE, // select zsh
      ENTER, // -> review
      ENTER, // -> installing
    ]);

    expect(toml).toContain('λ');
    expect(toml).not.toContain('❯');
  });

  it('applies the rc config for the selected shell', async () => {
    await runWizard([ENTER, ENTER, ENTER, ENTER, ENTER, ENTER, SPACE, ENTER, ENTER]);

    expect(mockApplyShellConfig).toHaveBeenCalledWith('zsh', expect.anything());
  });

  it('never emits a module twice even when picked on both sides', async () => {
    const toml = await runWizard([
      ENTER, // welcome
      ENTER, // fontcheck
      ENTER, // preset
      ENTER, // segments_left (directory is on by default)
      SPACE, // segments_right: try to also enable the first module
      ENTER, // -> style
      ENTER, // -> shells
      SPACE, // select zsh
      ENTER, // -> review
      ENTER, // -> installing
    ]);

    const formatLine = toml.split('\n').find((l) => l.startsWith('format')) ?? '';
    const directoryRefs = formatLine.match(/\$directory/g) ?? [];
    expect(directoryRefs.length).toBeLessThanOrEqual(1);
  });

  it('pauses at a review step showing the config before installing', async () => {
    const instance = render(<App />);
    await flush();

    for (const key of [ENTER, ENTER, ENTER, ENTER, ENTER, ENTER, SPACE, ENTER]) {
      instance.stdin.write(key);
      await flush();
    }

    const frame = instance.lastFrame();
    expect(frame).toContain('Review your configuration');
    // The rc snippet and the generated TOML are shown for the chosen shell.
    expect(frame).toContain('STARSHIP_CONFIG="/tmp/starship.toml"');
    expect(frame).toContain('eval "$(starship init zsh)"');
    expect(frame).toContain('$directory$git_branch$git_status');
    // Reviewing must not have written anything yet.
    expect(mockWriteConfig).not.toHaveBeenCalled();
    expect(mockApplyShellConfig).not.toHaveBeenCalled();
  });

  it('keeps a clean exit code when every step succeeded', async () => {
    const out: { instance: ReturnType<typeof render> } = { instance: undefined as never };
    await runWizard([ENTER, ENTER, ENTER, ENTER, ENTER, ENTER, SPACE, ENTER, ENTER], out);
    await waitFor(() => out.instance.lastFrame()?.includes('Done'), 'done screen');

    expect(process.exitCode ?? 0).toBe(0);
  });

  it('exits non-zero when an install step fails', async () => {
    // { applied: false } with no note makes the rc step fail ("Unknown shell"),
    // which must surface as a non-zero exit so scripts can detect the failure.
    mockApplyShellConfig.mockReturnValueOnce({ applied: false });
    const out: { instance: ReturnType<typeof render> } = { instance: undefined as never };
    await runWizard([ENTER, ENTER, ENTER, ENTER, ENTER, ENTER, SPACE, ENTER, ENTER], out);
    await waitFor(() => out.instance.lastFrame()?.includes('Done'), 'done screen');

    expect(process.exitCode).toBe(1);
  });

  it('installs a chosen Nerd Font through the font_select flow', async () => {
    const out: { instance: ReturnType<typeof render> } = { instance: undefined as never };
    const toml = await runWizard(
      [
        ENTER, // welcome -> fontcheck
        DOWN, // fontcheck: "No, install one for me"
        ENTER, // fontcheck -> choose a font
        ENTER, // font_select: JetBrains Mono -> preset
        ENTER, // preset -> segments_left
        ENTER, // accept left segments -> segments_right
        ENTER, // accept right segments -> style
        ENTER, // accept style -> shells
        SPACE, // select zsh
        ENTER, // -> review
        ENTER, // -> installing
      ],
      out
    );
    await waitFor(() => out.instance.lastFrame()?.includes('Done'), 'done screen');

    expect(toml).toContain('$character');
    expect(mockInstallNerdFont).toHaveBeenCalledTimes(1);
    expect(mockInstallNerdFont).toHaveBeenCalledWith('JetBrainsMono');
    expect(process.exitCode ?? 0).toBe(0);
  });

  it('writes a glyph-free config when the font install fails', async () => {
    // installNerdFont failing must not poison the generated config: hasNerdFont
    // is forced off so the result avoids glyphs the user's terminal can't render.
    mockInstallNerdFont.mockRejectedValue(new Error('Checksum mismatch'));
    const out: { instance: ReturnType<typeof render> } = { instance: undefined as never };
    const toml = await runWizard(
      [
        ENTER, // welcome
        DOWN, // fontcheck: "No, install one for me"
        ENTER, // fontcheck -> choose a font
        ENTER, // font_select: JetBrains Mono -> preset
        ENTER, // preset
        ENTER, // segments_left
        ENTER, // segments_right
        ENTER, // style
        SPACE, // select zsh
        ENTER, // -> review
        ENTER, // -> installing
      ],
      out
    );
    await waitFor(() => out.instance.lastFrame()?.includes('Done'), 'done screen');

    // git_branch under hasNerdFont:false uses the plain-text "on " fallback.
    expect(toml).toContain('symbol = "on "');
    expect(toml).not.toContain('symbol = " "');
    expect(process.exitCode).toBe(1);
  });

  it('installs a shell the machine does not have', async () => {
    // zsh is absent from this machine: detection reports only bash+fish, yet the
    // shell step must still offer zsh and the install chain must install it.
    mockDetectInstalledShells.mockResolvedValue(['bash', 'fish']);
    const out: { instance: ReturnType<typeof render> } = { instance: undefined as never };
    const toml = await runWizard(
      [
        ENTER, // welcome
        ENTER, // fontcheck: already have one
        ENTER, // preset
        ENTER, // segments_left
        ENTER, // segments_right
        ENTER, // style
        SPACE, // select zsh (missing -> "will install")
        ENTER, // -> review
        ENTER, // -> installing
      ],
      out
    );
    await waitFor(() => out.instance.lastFrame()?.includes('Done'), 'done screen');

    expect(toml).toContain('$character');
    expect(mockInstallShell).toHaveBeenCalledTimes(1);
    expect(mockInstallShell).toHaveBeenCalledWith('zsh', 'apt');
    expect(process.exitCode ?? 0).toBe(0);
  });
});

describe('dry-run wizard walkthrough', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteConfig.mockClear();
  });

  async function runDryWizard(): Promise<ReturnType<typeof render>> {
    const instance = render(<App dryRun />);
    await flush();

    // Walk straight to the shells step and pick zsh; installing must be skipped.
    instance.stdin.write(ENTER); // welcome
    await flush();
    instance.stdin.write(ENTER); // fontcheck
    await flush();
    instance.stdin.write(ENTER); // preset
    await flush();
    instance.stdin.write(ENTER); // segments_left
    await flush();
    instance.stdin.write(ENTER); // segments_right
    await flush();
    instance.stdin.write(ENTER); // style
    await flush();
    instance.stdin.write(SPACE); // select zsh
    await flush();
    instance.stdin.write(ENTER); // -> review
    await flush();
    instance.stdin.write(ENTER); // -> done (skips installing)
    await flush();

    return instance;
  }

  it('skips the install step and lands on the dry-run summary', async () => {
    const instance = await runDryWizard();

    const frame = instance.lastFrame();
    expect(frame).toContain('Dry run');
    expect(frame).toContain('Tasks that would run');
    expect(frame).toContain('Generated config');
  });

  it('never writes any config or rc files in dry-run mode', async () => {
    await runDryWizard();

    expect(mockWriteConfig).not.toHaveBeenCalled();
    expect(mockApplyShellConfig).not.toHaveBeenCalled();
  });
});
