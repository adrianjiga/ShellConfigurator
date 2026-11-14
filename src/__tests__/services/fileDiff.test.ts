import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getShell } from '../../config/shells.ts';
import { getSharedConfigPath, getShellConfigPath } from '../../generators/shellRc.ts';
import { generateToml } from '../../generators/starship.ts';
import { plannedFileChanges, unifiedDiff } from '../../services/fileDiff.ts';
import { DEFAULT_STATE, type WizardState } from '../../types.ts';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shellconf-diff-'));
  vi.stubEnv('HOME', tmpDir);
  vi.stubEnv('XDG_CONFIG_HOME', undefined);
  vi.stubEnv('ZDOTDIR', undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

describe('unifiedDiff', () => {
  it('is empty when nothing changes', () => {
    expect(unifiedDiff('a\nb\n', 'a\nb\n', 'f')).toBe('');
  });

  it('shows a new file as all additions from /dev/null', () => {
    expect(unifiedDiff(null, 'a\nb\n', 'f')).toBe(
      '--- /dev/null\n+++ f\n@@ -0,0 +1,2 @@\n+a\n+b\n'
    );
  });

  it('keeps three lines of context and splits hunks that are far apart', () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    const after = [...before];
    after[1] = 'changed 2';
    after.splice(17, 0, 'inserted');
    expect(unifiedDiff(`${before.join('\n')}\n`, `${after.join('\n')}\n`, 'f')).toBe(
      [
        '--- f',
        '+++ f',
        '@@ -1,5 +1,5 @@',
        ' line 1',
        '-line 2',
        '+changed 2',
        ' line 3',
        ' line 4',
        ' line 5',
        '@@ -15,6 +15,7 @@',
        ' line 15',
        ' line 16',
        ' line 17',
        '+inserted',
        ' line 18',
        ' line 19',
        ' line 20',
        '',
      ].join('\n')
    );
  });

  it('marks a last line without a newline the way git does', () => {
    expect(unifiedDiff('a\nb', 'a\nb\n', 'f')).toBe(
      '--- f\n+++ f\n@@ -1,2 +1,2 @@\n a\n-b\n\\ No newline at end of file\n+b\n'
    );
  });

  it('produces patches that `patch` applies to get the new file back', () => {
    let seed = 7;
    const random = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    const words = ['a', 'b', 'c', 'd', 'export X=1', ''];
    for (let round = 0; round < 40; round++) {
      const before = Array.from({ length: random(25) }, () => words[random(words.length)]);
      const after = [...before];
      for (let edit = random(6); edit > 0; edit--) {
        const at = random(after.length + 1);
        if (random(2) === 0 && after.length > 0) after.splice(at, 1);
        else after.splice(at, 0, words[random(words.length)]);
      }
      const ending = () => (random(4) === 0 ? '' : '\n');
      const beforeText = before.length ? `${before.join('\n')}${ending()}` : '';
      const afterText = after.length ? `${after.join('\n')}${ending()}` : '';
      const diff = unifiedDiff(beforeText, afterText, 'f');
      if (beforeText === afterText) {
        expect(diff).toBe('');
        continue;
      }
      const file = path.join(tmpDir, `round-${round}`);
      fs.writeFileSync(file, beforeText);
      execFileSync('patch', ['-s', file], { input: diff });
      expect(fs.readFileSync(file, 'utf8')).toBe(afterText);
    }
  });
});

function state(overrides: Partial<WizardState> = {}): WizardState {
  return { ...DEFAULT_STATE, selectedShells: ['zsh'], installedShells: ['zsh'], ...overrides };
}

describe('plannedFileChanges', () => {
  it('creates the per-shell config and adds the block to an existing rc', () => {
    const rc = getShell('zsh')!.rcFile!;
    write(rc, 'alias ll="ls -l"\n');

    const changes = plannedFileChanges(state(), [], null);

    expect(changes.map((c) => [c.path, c.status])).toEqual([
      [getShellConfigPath('zsh'), 'create'],
      [rc, 'modify'],
    ]);
    const rcChange = changes[1];
    expect(rcChange).toMatchObject({ added: 4, removed: 0 });
    expect(rcChange.status !== 'unreadable' && rcChange.diff).toContain(
      ' alias ll="ls -l"\n+\n+# Added by ShellConfigurator\n'
    );
    expect(fs.readFileSync(rc, 'utf8')).toBe('alias ll="ls -l"\n');
    expect(fs.existsSync(getShellConfigPath('zsh'))).toBe(false);
  });

  it('leaves out files a run would not change', () => {
    write(getShellConfigPath('zsh'), generateToml(state()));
    const rc = getShell('zsh')!.rcFile!;
    expect(plannedFileChanges(state(), [], null).map((c) => c.path)).toEqual([rc]);

    const configured = plannedFileChanges(state(), [], null)[0];
    write(rc, '');
    execFileSync('patch', ['-s', rc], {
      input: configured.status === 'unreadable' ? '' : configured.diff,
    });
    expect(plannedFileChanges(state(), [], null)).toEqual([]);
  });

  it('adds the PATH line the run would add', () => {
    const changes = plannedFileChanges(state(), [], '/opt/bin');
    const rc = changes.find((c) => c.path === getShell('zsh')!.rcFile);
    expect(rc?.status !== 'unreadable' && rc?.diff).toContain("+export PATH='/opt/bin'");
  });

  it('diffs the shared config in import mode and writes no per-shell config', () => {
    write(getSharedConfigPath(), 'add_newline = true\n');
    const changes = plannedFileChanges(
      state({ keepExistingConfig: true, sharedConfigToml: 'add_newline = false\n' }),
      [],
      null
    );
    expect(changes[0]).toMatchObject({ path: getSharedConfigPath(), status: 'modify' });
    expect(changes[0].status !== 'unreadable' && changes[0].diff).toContain(
      '-add_newline = true\n+add_newline = false\n'
    );
    expect(changes.some((c) => c.path === getShellConfigPath('zsh'))).toBe(false);
  });

  it('keeps an adopted config without an import untouched', () => {
    write(getSharedConfigPath(), 'x = 1\n');
    const changes = plannedFileChanges(state({ keepExistingConfig: true }), [], null);
    expect(changes.map((c) => c.path)).toEqual([getShell('zsh')!.rcFile!]);
  });

  it('adds the unset guard to a shell the run resets', () => {
    const bashrc = getShell('bash')!.rcFile!;
    write(bashrc, 'eval "$(starship init bash)"\n');
    const changes = plannedFileChanges(state(), ['bash'], null);
    const reset = changes.find((c) => c.path === bashrc);
    expect(reset?.status !== 'unreadable' && reset?.diff).toContain('+unset STARSHIP_CONFIG');
  });

  it('changes no rc file when the Starship install is skipped', () => {
    const changes = plannedFileChanges(state({ skipStarshipInstall: true }), [], null);
    expect(changes.map((c) => c.path)).toEqual([getShellConfigPath('zsh')]);
  });

  it('shows a config that differs only in its final newline as a one-line edit', () => {
    write(getShellConfigPath('zsh'), `${generateToml(state())}\n`);
    const config = plannedFileChanges(state(), [], null)[0];
    expect(config).toMatchObject({ path: getShellConfigPath('zsh'), added: 1, removed: 1 });
    expect(config.status !== 'unreadable' && config.diff).toContain('\\ No newline at end of file');
  });

  it('reports a file it cannot read instead of throwing', () => {
    const io = {
      exists: () => true,
      readFile: () => {
        throw new Error('EACCES');
      },
    };
    expect(plannedFileChanges(state(), [], null, io)).toContainEqual({
      path: getShell('zsh')!.rcFile!,
      status: 'unreadable',
      error: 'EACCES',
    });
  });
});
