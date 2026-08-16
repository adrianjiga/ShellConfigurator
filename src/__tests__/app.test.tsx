import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import React, { act } from 'react';
import { render, cleanup } from 'ink-testing-library';

// Detection is the only thing WelcomeScreen and ShellScreen do on mount; stub it so
// the wizard is driven purely by keystrokes.
vi.mock('../services/detector.ts', () => ({
  detectPackageManagerAsync: vi.fn().mockResolvedValue('apt'),
  isStarshipInstalledAsync: vi
    .fn()
    .mockResolvedValue({ installed: true, version: 'starship 1.20' }),
  detectInstalledShellsAsync: vi.fn().mockResolvedValue(['zsh', 'bash']),
}));

import { App } from '../app.tsx';

const ENTER = '\r';
const ESC = '';
const DOWN = '[B';

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

async function flush() {
  await act(async () => {});
}

function setup() {
  const instance = render(<App />);
  return instance;
}

async function press(instance: ReturnType<typeof render>, key: string) {
  instance.stdin.write(key);
  await flush();
}

describe('App wizard routing', () => {
  it('starts on the welcome screen and reports detection', async () => {
    const instance = setup();
    await flush();

    expect(instance.lastFrame()).toContain('Welcome to ShellConfigurator');
    expect(instance.lastFrame()).toContain('Starship is installed');
  });

  it('advances welcome → font check → preset on Enter', async () => {
    const instance = setup();
    await flush();

    await press(instance, ENTER);
    expect(instance.lastFrame()).toContain('Nerd Font check');

    // "Yes, I have one" is first — skips the font picker entirely.
    await press(instance, ENTER);
    expect(instance.lastFrame()).toContain('Choose a starting preset');
  });

  it('walks back to the previous step with Esc', async () => {
    const instance = setup();
    await flush();

    await press(instance, ENTER);
    expect(instance.lastFrame()).toContain('Nerd Font check');

    await press(instance, ESC);
    expect(instance.lastFrame()).toContain('Welcome to ShellConfigurator');
  });

  it('skips the font picker when the user already has a font', async () => {
    const instance = setup();
    await flush();

    await press(instance, ENTER); // welcome -> fontcheck
    await press(instance, ENTER); // "Yes, I have one" -> preset (font_select skipped)

    expect(instance.lastFrame()).not.toContain('Choose a Nerd Font to install');
    expect(instance.lastFrame()).toContain('Choose a starting preset');
  });

  it('routes to the font picker when the user asks for an install', async () => {
    const instance = setup();
    await flush();

    await press(instance, ENTER); // welcome -> fontcheck
    await press(instance, DOWN); // move to "No, install one for me"
    await press(instance, ENTER);

    expect(instance.lastFrame()).toContain('Choose a Nerd Font to install');
  });

  it('carries live segment edits into the preview', async () => {
    const instance = setup();
    await flush();

    await press(instance, ENTER); // welcome
    await press(instance, ENTER); // fontcheck -> preset
    await press(instance, ENTER); // preset -> segments_left

    expect(instance.lastFrame()).toContain('Left prompt segments');
    // The preview pane renders alongside the picker.
    expect(instance.lastFrame()).toContain('Preview');
  });
});
