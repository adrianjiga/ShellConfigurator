import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyShellConfig,
  bashLoginContent,
  bashLoginFile,
  LOGIN_MARKER,
} from '../../generators/shellRc.ts';
import { plannedFileChanges } from '../../services/fileDiff.ts';
import { trackedFiles } from '../../services/runCapture.ts';
import { DEFAULT_STATE } from '../../types.ts';
import { stubPlatform } from '../helpers/platform.ts';

let home: string;
let restorePlatform: () => void;
const at = (name: string) => path.join(home, name);

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'shellconf-login-'));
  vi.stubEnv('HOME', home);
  restorePlatform = stubPlatform('darwin');
});

afterEach(() => {
  restorePlatform();
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

describe('the Bash login file on macOS', () => {
  it('is created as ~/.bash_profile when there is none, and loads ~/.bashrc', () => {
    const result = applyShellConfig('bash');

    expect(fs.readFileSync(at('.bash_profile'), 'utf8')).toBe(
      `${LOGIN_MARKER}\n[ -f ~/.bashrc ] && . ~/.bashrc\n`
    );
    expect(fs.readFileSync(at('.bashrc'), 'utf8')).toContain('starship init bash');
    expect(result).toEqual({ applied: true, note: '.bash_profile now loads .bashrc' });
  });

  it('is the ~/.profile that exists, so no new ~/.bash_profile hides it', () => {
    fs.writeFileSync(at('.profile'), 'export EDITOR=vim\n');

    applyShellConfig('bash');

    expect(fs.existsSync(at('.bash_profile'))).toBe(false);
    expect(fs.readFileSync(at('.profile'), 'utf8')).toBe(
      `export EDITOR=vim\n\n${LOGIN_MARKER}\n[ -f ~/.bashrc ] && . ~/.bashrc\n`
    );
  });

  it.each([
    '[ -f ~/.bashrc ] && . ~/.bashrc',
    'if [ -f "$HOME/.bashrc" ]; then source "$HOME/.bashrc"; fi',
  ])('is left alone when it already loads ~/.bashrc with %s', (line) => {
    fs.writeFileSync(at('.bash_profile'), `${line}\n`);

    expect(bashLoginContent(`${line}\n`)).toBe(`${line}\n`);
    applyShellConfig('bash');
    expect(fs.readFileSync(at('.bash_profile'), 'utf8')).toBe(`${line}\n`);
  });

  it('is changed once, however often Bash is set up', () => {
    applyShellConfig('bash');
    const first = fs.readFileSync(at('.bash_profile'), 'utf8');

    expect(applyShellConfig('bash').applied).toBe(false);
    expect(fs.readFileSync(at('.bash_profile'), 'utf8')).toBe(first);
  });

  it('shows in the dry-run diff and is captured for rollback', () => {
    const changes = plannedFileChanges({ ...DEFAULT_STATE, selectedShells: ['bash'] }, [], null);

    expect(changes.map((change) => change.path)).toContain(at('.bash_profile'));
    expect(trackedFiles()).toEqual(
      expect.arrayContaining([at('.bash_profile'), at('.bash_login'), at('.profile')])
    );
  });

  it('is not touched on Linux, where terminals start Bash without a login', () => {
    restorePlatform();
    restorePlatform = stubPlatform('linux');

    applyShellConfig('bash');

    expect(fs.existsSync(at('.bash_profile'))).toBe(false);
    expect(bashLoginFile()).toBe(at('.bash_profile'));
  });
});
