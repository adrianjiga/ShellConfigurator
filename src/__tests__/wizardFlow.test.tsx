import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import React, { act } from 'react';
import { render, cleanup } from 'ink-testing-library';
import { parse } from '@iarna/toml';

// Only the side-effecting edges are stubbed. generateToml, the step machine, the
// screens, and runInstallTasks all run for real, so this exercises the whole
// keypress -> state -> generated config path.
vi.mock('../services/detector.ts', () => ({
  detectPackageManagerAsync: vi.fn().mockResolvedValue('apt'),
  isStarshipInstalledAsync: vi
    .fn()
    .mockResolvedValue({ installed: true, version: 'starship 1.20' }),
  detectInstalledShellsAsync: vi.fn().mockResolvedValue(['zsh', 'bash', 'fish']),
}));

const { mockWriteConfig, mockApplyShellConfig } = vi.hoisted(() => ({
  mockWriteConfig: vi.fn((_toml: string) => ({ path: '/tmp/starship.toml' })),
  mockApplyShellConfig: vi.fn(() => ({ applied: true })),
}));

vi.mock('../generators/shellRc.ts', () => ({
  writeStarshipConfig: mockWriteConfig,
  applyShellConfig: mockApplyShellConfig,
  getConfigPath: () => '/tmp/starship.toml',
}));

vi.mock('../services/installer.ts', () => ({
  NERD_FONTS: [{ id: 'JetBrainsMono', label: 'JetBrains Mono', zipName: 'JetBrainsMono.zip' }],
  installStarship: vi.fn().mockResolvedValue(undefined),
  installShell: vi.fn().mockResolvedValue(undefined),
  installNerdFont: vi.fn().mockResolvedValue(undefined),
  setDefaultShell: vi.fn().mockResolvedValue(undefined),
  getMissingStarshipPathDir: vi.fn(() => null),
  getNerdFontsDir: () => '/tmp/fonts',
}));

import { App } from '../app.tsx';

const ENTER = '\r';
const SPACE = ' ';

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

async function flush() {
  await act(async () => {});
}

/** Walks the wizard to the end and returns the TOML that was written. */
async function runWizard(keys: string[]): Promise<string> {
  const instance = render(<App />);
  await flush();

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
      ENTER, // -> installing
    ]);

    const parsed = parse(toml) as Record<string, unknown>;
    expect(typeof parsed.format).toBe('string');
    expect(parsed.format as string).toContain('$character');
    // The character block must be emitted, not just referenced in the format.
    expect(toml).toContain('[character]');
  });

  it('carries the prompt character choice all the way into the config', async () => {
    const DOWN = '\u001B[B';

    const toml = await runWizard([
      ENTER, // welcome
      ENTER, // fontcheck
      ENTER, // preset
      ENTER, // segments_left
      ENTER, // segments_right
      DOWN, // style: character focus starts on arrow; move down to lambda
      ENTER, // style: confirm -> shells (Tab switches section, it does not confirm)
      SPACE, // select zsh
      ENTER, // -> installing
    ]);

    expect(toml).toContain('λ');
    expect(toml).not.toContain('❯');
  });

  it('applies the rc config for the selected shell', async () => {
    await runWizard([ENTER, ENTER, ENTER, ENTER, ENTER, ENTER, SPACE, ENTER]);

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
      ENTER, // -> installing
    ]);

    const formatLine = toml.split('\n').find((l) => l.startsWith('format')) ?? '';
    const directoryRefs = formatLine.match(/\$directory/g) ?? [];
    expect(directoryRefs.length).toBeLessThanOrEqual(1);
  });
});
