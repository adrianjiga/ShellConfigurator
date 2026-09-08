import { cleanup, render } from 'ink-testing-library';
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WelcomeScreen } from '../../screens/WelcomeScreen.tsx';
import { detectPackageManagerAsync, isStarshipInstalledAsync } from '../../services/detector.ts';
import { DEFAULT_STATE } from '../../types.ts';

vi.mock('../../services/detector.ts', () => ({
  detectPackageManagerAsync: vi.fn(),
  isStarshipInstalledAsync: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
beforeEach(() => {
  vi.mocked(detectPackageManagerAsync).mockResolvedValue('apt');
  vi.mocked(isStarshipInstalledAsync).mockResolvedValue({ installed: false });
});

function setup() {
  const onNext = vi.fn();
  const instance = render(<WelcomeScreen state={{ ...DEFAULT_STATE }} onNext={onNext} />);
  return { instance, onNext };
}

async function flush() {
  await act(async () => {});
}

const ENTER = '\r';
const DOWN = '\u001B[B';

describe('WelcomeScreen', () => {
  it('shows a placeholder while detection is in flight', async () => {
    vi.mocked(isStarshipInstalledAsync).mockReturnValue(new Promise(() => {}));
    const { instance } = setup();

    expect(instance.lastFrame()).toContain('Detecting system...');
  });

  it('advances with Enter when Starship is already installed', async () => {
    vi.mocked(isStarshipInstalledAsync).mockResolvedValue({
      installed: true,
      version: 'starship 1.22.1',
    });
    const { instance, onNext } = setup();
    await flush();
    await flush();

    expect(instance.lastFrame()).toContain('Starship is installed');
    instance.stdin.write(ENTER);
    await flush();

    expect(onNext).toHaveBeenCalledWith({ starshipInstalled: true, packageManager: 'apt' });
  });

  it('installs automatically when Starship is missing', async () => {
    const { instance, onNext } = setup();
    await flush();
    await flush();

    expect(instance.lastFrame()).toContain('Starship is not installed');
    instance.stdin.write(ENTER);
    await flush();

    expect(onNext).toHaveBeenCalledWith({ starshipInstalled: false, packageManager: 'apt' });
  });

  it('offers a manual install, then continue without installing', async () => {
    vi.mocked(detectPackageManagerAsync).mockResolvedValue('script');
    const { instance, onNext } = setup();
    await flush();
    await flush();

    instance.stdin.write(DOWN); // → "I'll install it manually"
    await flush();
    instance.stdin.write(ENTER);
    await flush();

    expect(instance.lastFrame()).toContain('Re-check (I installed it)');

    instance.stdin.write(DOWN); // → "Continue without Starship"
    await flush();
    instance.stdin.write(ENTER);
    await flush();

    expect(onNext).toHaveBeenCalledWith({
      starshipInstalled: false,
      packageManager: 'script',
      skipStarshipInstall: true,
    });
  });

  it('re-checks after a manual install and then advances', async () => {
    const { instance, onNext } = setup();
    await flush();
    await flush();

    instance.stdin.write(DOWN); // → "I'll install it manually"
    await flush();
    instance.stdin.write(ENTER);
    await flush();

    vi.mocked(isStarshipInstalledAsync).mockResolvedValueOnce({
      installed: true,
      version: 'starship 1.22.1',
    });
    instance.stdin.write(ENTER); // → "Re-check (I installed it)"
    await flush();
    await flush();

    expect(instance.lastFrame()).toContain('Starship is installed');
    instance.stdin.write(ENTER);
    await flush();

    expect(onNext).toHaveBeenCalledWith({ starshipInstalled: true, packageManager: 'apt' });
  });
});
