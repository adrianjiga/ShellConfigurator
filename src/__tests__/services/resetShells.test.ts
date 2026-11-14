import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getShell } from '../../config/shells.ts';
import {
  applyShellConfig,
  getShellConfigPath,
  keepsOwnConfig,
  writeShellConfig,
} from '../../generators/shellRc.ts';
import { plannedResetShells } from '../../services/installTasks.ts';
import { DEFAULT_STATE } from '../../types.ts';

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'shellconf-reset-'));
  vi.stubEnv('HOME', home);
  vi.stubEnv('XDG_CONFIG_HOME', undefined);
  vi.stubEnv('ZDOTDIR', undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

function setUp(shellId: 'fish' | 'zsh'): void {
  writeShellConfig('format = "$character"\n', shellId);
  applyShellConfig(shellId);
}

describe('a later run that selects other shells', () => {
  it('leaves a shell set up in an earlier run alone, so it keeps its own prompt', () => {
    setUp('fish');
    const configFish = getShell('fish')!.rcFile!;
    const before = fs.readFileSync(configFish, 'utf8');

    const resets = plannedResetShells({
      ...DEFAULT_STATE,
      installedShells: ['zsh', 'fish'],
      selectedShells: ['zsh'],
    });

    expect(resets).toEqual([]);
    expect(keepsOwnConfig('fish')).toBe(true);
    expect(fs.readFileSync(configFish, 'utf8')).toBe(before);
  });

  it('still points back a shell whose own config file is gone', () => {
    setUp('fish');
    fs.rmSync(getShellConfigPath('fish'));

    expect(keepsOwnConfig('fish')).toBe(false);
    expect(
      plannedResetShells({
        ...DEFAULT_STATE,
        installedShells: ['zsh', 'fish'],
        selectedShells: ['zsh'],
      })
    ).toEqual(['fish']);
  });

  it('still guards a shell that starts Starship without a setup of its own', () => {
    const configFish = getShell('fish')!.rcFile!;
    fs.mkdirSync(path.dirname(configFish), { recursive: true });
    fs.writeFileSync(configFish, 'starship init fish | source\n');

    expect(keepsOwnConfig('fish')).toBe(false);
    expect(
      plannedResetShells({
        ...DEFAULT_STATE,
        installedShells: ['zsh', 'fish'],
        selectedShells: ['zsh'],
      })
    ).toEqual(['fish']);
  });
});
