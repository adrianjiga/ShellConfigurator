import { spawnSync } from 'node:child_process';
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
import { planUninstall, runUninstall } from '../../services/uninstall.ts';
import { DEFAULT_STATE } from '../../types.ts';
import { stubPlatform } from '../helpers/platform.ts';

let home: string;
let restorePlatform: () => void;
const at = (name: string) => path.join(home, name);
const LINE = '[ -n "$BASH_VERSION" ] && [ -f ~/.bashrc ] && . ~/.bashrc';

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

    expect(fs.readFileSync(at('.bash_profile'), 'utf8')).toBe(`${LOGIN_MARKER}\n${LINE}\n`);
    expect(fs.readFileSync(at('.bashrc'), 'utf8')).toContain('starship init bash');
    expect(result).toEqual({ applied: true, note: '.bash_profile now loads .bashrc' });
  });

  it('is the ~/.profile that exists, so no new ~/.bash_profile hides it', () => {
    fs.writeFileSync(at('.profile'), 'export EDITOR=vim\n');

    applyShellConfig('bash');

    expect(fs.existsSync(at('.bash_profile'))).toBe(false);
    expect(fs.readFileSync(at('.profile'), 'utf8')).toBe(
      `export EDITOR=vim\n\n${LOGIN_MARKER}\n${LINE}\n`
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

  it('loads ~/.bashrc only in Bash, since other login shells read ~/.profile too', () => {
    fs.writeFileSync(at('.profile'), 'export EDITOR=vim\n');
    fs.writeFileSync(at('.bashrc'), 'echo bashrc-ran\n');
    applyShellConfig('bash');
    fs.writeFileSync(at('.bashrc'), 'echo bashrc-ran\n');

    const run = (shell: string) =>
      spawnSync(shell, ['-c', `. ${at('.profile')}`], { env: { HOME: home }, encoding: 'utf8' });
    const posix = ['dash', 'zsh'].find((shell) => !run(shell).error);
    expect(posix).toBeDefined();
    expect(run(posix!).stdout).toBe('');
    expect(run('bash').stdout).toContain('bashrc-ran');
  });

  it('keeps the Bash step done with a note when the login file cannot be written', () => {
    fs.writeFileSync(at('.bash_profile'), 'export EDITOR=vim\n');
    fs.chmodSync(at('.bash_profile'), 0o444);

    const result = applyShellConfig('bash');

    expect(result.applied).toBe(true);
    expect(result.note).toContain('could not make .bash_profile load .bashrc');
    expect(fs.readFileSync(at('.bashrc'), 'utf8')).toContain('starship init bash');
  });

  it('is taken back out by uninstall, deleting a login file that held nothing else', async () => {
    applyShellConfig('bash');
    fs.writeFileSync(at('.profile'), `export EDITOR=vim\n\n${LOGIN_MARKER}\n${LINE}\n`);

    const report = await runUninstall(await planUninstall({ shells: ['bash'] }));

    expect(report.ok).toBe(true);
    expect(fs.existsSync(at('.bash_profile'))).toBe(false);
    expect(fs.readFileSync(at('.profile'), 'utf8')).toBe('export EDITOR=vim\n');
    expect(fs.readdirSync(home).some((name) => name.startsWith('.profile.bak-'))).toBe(true);
  });

  it('is taken out by uninstall also when .bashrc has no ShellConfigurator block', async () => {
    fs.writeFileSync(at('.bashrc'), 'eval "$(starship init bash)"\n');
    applyShellConfig('bash', { pointAtSharedConfig: true });
    expect(fs.readFileSync(at('.bashrc'), 'utf8')).not.toContain('ShellConfigurator');
    expect(fs.existsSync(at('.bash_profile'))).toBe(true);

    const steps = await planUninstall({});
    expect(steps.map((step) => step.title)).toContain('Bash login file');
    await runUninstall(steps);

    expect(fs.existsSync(at('.bash_profile'))).toBe(false);
  });

  it('fails only its own uninstall step when the login file cannot be changed', async () => {
    fs.writeFileSync(at('.bash_profile'), 'export EDITOR=vim\n');
    applyShellConfig('bash');
    fs.chmodSync(at('.bash_profile'), 0o444);

    const report = await runUninstall(await planUninstall({ shells: ['bash'] }));

    const status = (title: string) => report.actions.find((a) => a.title === title)?.status;
    expect(status('Bash rc')).toBe('removed');
    expect(status('Bash login file')).toBe('failed');
  });

  it('is not touched on Linux, where terminals start Bash without a login', () => {
    restorePlatform();
    restorePlatform = stubPlatform('linux');

    applyShellConfig('bash');

    expect(fs.existsSync(at('.bash_profile'))).toBe(false);
    expect(bashLoginFile()).toBe(at('.bash_profile'));
  });
});
