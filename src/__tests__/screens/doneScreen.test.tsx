import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { render, cleanup } from 'ink-testing-library';
import { DoneScreen } from '../../screens/DoneScreen.tsx';
import { runInstallTasks, InstallTaskDeps } from '../../services/installTasks.ts';
import { DEFAULT_STATE, WizardState } from '../../types.ts';
import { applyShellConfig } from '../../generators/shellRc.ts';

afterEach(cleanup);

function fakeDeps(overrides: Partial<InstallTaskDeps> = {}): InstallTaskDeps {
  return {
    isStarshipInstalled: vi.fn().mockResolvedValue({ installed: true, version: 'starship 1.20' }),
    installStarship: vi.fn().mockResolvedValue(undefined),
    installNerdFont: vi.fn().mockResolvedValue(undefined),
    installShell: vi.fn().mockResolvedValue(undefined),
    setDefaultShell: vi.fn().mockResolvedValue(undefined),
    generateToml: vi.fn(() => 'format = "$character"'),
    writeStarshipConfig: vi.fn(() => ({ path: '/home/u/.config/starship.toml' })),
    applyShellConfig: vi.fn(() => ({ applied: true })),
    getMissingStarshipPathDir: vi.fn(() => null),
    ...overrides,
  };
}

/** Runs the real orchestrator, then renders the real Done screen over its results. */
async function runAndRender(
  overrides: Partial<WizardState>,
  deps: InstallTaskDeps = fakeDeps()
): Promise<string> {
  const state: WizardState = { ...DEFAULT_STATE, packageManager: 'apt', ...overrides };
  const installResults = await runInstallTasks(state, deps, vi.fn());
  return render(<DoneScreen state={{ ...state, installResults }} />).lastFrame() ?? '';
}

/** The line of the rendered summary that names a given shell. */
function rowFor(frame: string, label: string): string {
  return frame.split('\n').find((l) => l.includes(`${label}:`)) ?? '';
}

describe('DoneScreen over real install results', () => {
  it('does not mark a shell as configured when it needs manual setup', async () => {
    // nushell has no rc file, so applyShellConfig returns applied:false + a note.
    const frame = await runAndRender(
      { selectedShells: ['nushell'], installedShells: ['nushell'] },
      fakeDeps({ applyShellConfig })
    );
    const row = rowFor(frame, 'Nushell');

    expect(row).not.toContain('✓');
    expect(row).not.toContain('init line added');
    expect(frame).toContain('Run the above command once in Nushell');
    // The command the user has to run must be on screen, not just described.
    expect(frame).toContain('starship init nu');
  });

  it('reports an already-configured shell as skipped rather than freshly applied', async () => {
    const frame = await runAndRender(
      { selectedShells: ['zsh'], installedShells: ['zsh'] },
      fakeDeps({ applyShellConfig: vi.fn(() => ({ applied: false, note: 'already configured' })) })
    );
    const row = rowFor(frame, 'Zsh');

    expect(row).toContain('already configured');
    expect(row).not.toContain('init line added');
  });

  it('gives each shell its own status instead of one shared one', async () => {
    const frame = await runAndRender(
      { selectedShells: ['zsh', 'fish'], installedShells: ['zsh', 'fish'] },
      fakeDeps({
        applyShellConfig: vi.fn((shellId: string) => {
          if (shellId === 'fish') throw new Error('mkdir failed');
          return { applied: true };
        }),
      })
    );

    expect(rowFor(frame, 'Zsh')).toContain('✓');
    expect(rowFor(frame, 'Zsh')).toContain('init line added');
    expect(rowFor(frame, 'Fish')).toContain('✗');
    expect(frame).toContain('mkdir failed');
  });

  it('does not claim success when no results were recorded', async () => {
    const state: WizardState = {
      ...DEFAULT_STATE,
      selectedShells: ['zsh'],
      installedShells: ['zsh'],
      installResults: [],
    };
    const frame = render(<DoneScreen state={state} />).lastFrame() ?? '';

    expect(frame).not.toContain('All done!');
    expect(frame).toContain('no results recorded');
    expect(rowFor(frame, 'Zsh')).toContain('status unknown');
  });

  it('surfaces a failed config write', async () => {
    const frame = await runAndRender(
      { selectedShells: ['zsh'], installedShells: ['zsh'] },
      fakeDeps({
        writeStarshipConfig: vi.fn(() => {
          throw new Error('permission denied');
        }),
      })
    );

    expect(frame).toContain('Finished with errors');
    expect(frame).toContain('Config not written to');
    expect(frame).toContain('permission denied');
  });

  it('reports a failed default-shell change', async () => {
    const frame = await runAndRender(
      { selectedShells: ['zsh'], installedShells: ['zsh'], setDefaultShell: 'zsh' },
      fakeDeps({ setDefaultShell: vi.fn().mockRejectedValue(new Error('chsh denied')) })
    );

    expect(frame).toContain('Default shell not set to');
  });

  it('shows a clean summary when everything succeeds', async () => {
    const frame = await runAndRender({ selectedShells: ['zsh'], installedShells: ['zsh'] });

    expect(frame).toContain('All done!');
    expect(rowFor(frame, 'Zsh')).toContain('init line added');
  });
});
