import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('../../services/whatChanged.ts');

import { getShell } from '../../config/shells.ts';
import { getSharedConfigPath, getShellConfigPath } from '../../generators/shellRc.ts';
import { planRollback, runRollback } from '../../services/rollback.ts';
import { beginRunCapture, finishRunCapture, readRunManifest } from '../../services/runCapture.ts';
import {
  renderWhatChanged,
  type WhatChangedRun,
  whatChangedPath,
  writeWhatChangedSafely,
} from '../../services/whatChanged.ts';
import { DEFAULT_STATE } from '../../types.ts';

let tmpDir: string;
const savedEnv = { ...process.env };

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shellconf-changed-'));
  process.env.XDG_CONFIG_HOME = path.join(tmpDir, 'config');
  process.env.XDG_STATE_HOME = path.join(tmpDir, 'state');
});
afterEach(() => {
  process.env = { ...savedEnv };
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function run(overrides: Partial<WhatChangedRun> = {}): WhatChangedRun {
  return {
    kind: 'apply',
    timestamp: '2026-11-14T10:00:00.000Z',
    command: 'apply --shells zsh,nushell',
    state: {
      ...DEFAULT_STATE,
      selectedShells: ['zsh', 'nushell'],
      nerdFontToInstall: { kind: 'install', id: 'Hack' },
    },
    results: [
      { id: 'starship', label: 'Install Starship', status: 'done', note: 'starship 1.27.0' },
      { id: 'rc_zsh', label: 'Configure zsh', status: 'failed', error: 'read-only' },
      { id: 'font', label: 'Install Hack', status: 'done' },
    ],
    manifest: {
      version: 1,
      runId: 'run-1',
      files: [
        { path: '/etc/zshrc-ish', before: '0', after: 'abc' },
        { path: getShellConfigPath('zsh'), before: null, after: 'def' },
        { path: '/gone', before: '2', after: null },
      ],
    },
    ...overrides,
  };
}

describe('renderWhatChanged', () => {
  it('lists the tasks, the changed files, the shells and how to undo the run', () => {
    const text = renderWhatChanged(run());

    expect(text).toContain('# What ShellConfigurator changed');
    expect(text).toContain(
      'Headless apply on 2026-11-14T10:00:00.000Z (`shell-configurator apply --shells zsh,nushell`), run id `run-1`.'
    );
    expect(text).toContain('- ✓ Install Starship (starship 1.27.0)');
    expect(text).toContain('- ✗ Configure zsh — read-only');
    expect(text).toContain('- ✓ Install Hack');
    expect(text).toContain('- modified `/etc/zshrc-ish`');
    expect(text).toContain(`- created \`${getShellConfigPath('zsh')}\``);
    expect(text).toContain('- removed `/gone`');
    expect(text).toContain(
      `- Zsh: Starship lines in \`${getShell('zsh')!.rcFile!.replace(os.homedir(), '~')}\``
    );
    expect(text).toMatch(/- Nushell: set up by hand with `nu -c /);
    expect(text).toContain('- `shell-configurator rollback` puts the files above back');
    expect(text).toContain('add `--font Hack` to remove the font');
  });

  it('offers no font removal when the run installed no font', () => {
    const skipped = run().results.map((task) =>
      task.id === 'font' ? { ...task, status: 'skipped' as const } : task
    );
    expect(renderWhatChanged(run({ results: skipped }))).not.toContain('--font');
    const inContainer = run().results.filter((task) => task.id !== 'font');
    expect(renderWhatChanged(run({ results: inContainer }))).not.toContain('--font');
  });

  it('says a later uninstall or rollback may have undone the run', () => {
    expect(renderWhatChanged(run())).toContain(
      'A later `uninstall` or `rollback` may have undone it since; `shell-configurator rollback --list`'
    );
  });

  it('names the shared config in adopt mode, where no per-shell config is written', () => {
    const text = renderWhatChanged(
      run({ state: { ...run().state, keepExistingConfig: true, selectedShells: ['zsh'] } })
    );
    expect(text).toContain(
      `reads the shared config \`${getSharedConfigPath().replace(os.homedir(), '~')}\``
    );
    expect(text).not.toContain('; config `');
    expect(text).toContain('`shell-configurator uninstall` removes the Starship lines;');
  });

  it('drops URL credentials and queries from the command and keeps a backtick inside its code span', () => {
    const text = renderWhatChanged(
      run({
        command:
          "apply --import-url 'https://user:token@example.com/cfg.toml?sig=abc' --shells 'a`b'",
      })
    );
    expect(text).not.toContain('token');
    expect(text).not.toContain('sig=abc');
    expect(text).toContain(
      "(`` shell-configurator apply --import-url https://example.com/cfg.toml --shells 'a`b' ``)"
    );
  });

  it('shows the home directory as ~', () => {
    const text = renderWhatChanged(
      run({
        manifest: {
          version: 1,
          runId: 'r',
          files: [{ path: path.join(os.homedir(), '.zshrc'), before: '0', after: 'x' }],
        },
      })
    );
    expect(text).toContain('- modified `~/.zshrc`');
    expect(text).not.toContain(os.homedir());
  });
});

/** A captured run that changed `file` to `content`; returns its runId. */
function capturedRun(file: string, content: string): string {
  const capture = beginRunCapture([file]);
  fs.writeFileSync(file, content);
  return finishRunCapture(capture)!.runId;
}

describe('writeWhatChangedSafely', () => {
  const { manifest: _, ...details } = run();
  const rc = () => path.join(tmpDir, 'rc');

  it('writes the summary of a run that changed files, as part of that run', () => {
    const runId = capturedRun(rc(), 'one');
    const file = writeWhatChangedSafely(runId, details);

    expect(file).toBe(path.join(process.env.XDG_CONFIG_HOME!, 'starship', 'WHAT-CHANGED.md'));
    expect(file).toBe(whatChangedPath());
    const manifest = readRunManifest(runId)!;
    expect(fs.readFileSync(file!, 'utf8')).toBe(
      renderWhatChanged({
        ...details,
        manifest: { ...manifest, files: manifest.files.slice(0, 1) },
      })
    );
    expect(manifest.files.at(-1)).toMatchObject({ path: file, before: null, summary: true });
  });

  it('leaves the last summary alone when the run changed nothing', () => {
    fs.mkdirSync(path.dirname(whatChangedPath()), { recursive: true });
    fs.writeFileSync(whatChangedPath(), 'earlier');
    expect(writeWhatChangedSafely(null, details)).toBeNull();
    expect(fs.readFileSync(whatChangedPath(), 'utf8')).toBe('earlier');
  });

  it('is put back to the earlier summary when its run is rolled back', () => {
    writeWhatChangedSafely(capturedRun(rc(), 'one'), details);
    const first = fs.readFileSync(whatChangedPath(), 'utf8');
    const second = capturedRun(rc(), 'two');
    writeWhatChangedSafely(second, { ...details, timestamp: 'later' });
    expect(fs.readFileSync(whatChangedPath(), 'utf8')).not.toBe(first);

    const report = runRollback(second, planRollback(readRunManifest(second)!));

    expect(report.complete).toBe(true);
    expect(fs.readFileSync(whatChangedPath(), 'utf8')).toBe(first);
  });

  it('does not make rolling back an older run partial once a later run rewrote it', () => {
    const other = path.join(tmpDir, 'other');
    const first = capturedRun(rc(), 'one');
    writeWhatChangedSafely(first, details);
    writeWhatChangedSafely(capturedRun(other, 'x'), { ...details, timestamp: 'later' });
    const latest = fs.readFileSync(whatChangedPath(), 'utf8');

    const report = runRollback(first, planRollback(readRunManifest(first)!));

    expect(report.complete).toBe(true);
    expect(fs.existsSync(rc())).toBe(false);
    expect(fs.readFileSync(whatChangedPath(), 'utf8')).toBe(latest);
  });

  it('returns null instead of throwing when it cannot write', () => {
    const runId = capturedRun(rc(), 'one');
    fs.mkdirSync(process.env.XDG_CONFIG_HOME!, { recursive: true });
    fs.writeFileSync(path.join(process.env.XDG_CONFIG_HOME!, 'starship'), 'a file, not a folder');
    expect(writeWhatChangedSafely(runId, details)).toBeNull();
    expect(readRunManifest(runId)!.files.map((f) => f.path)).toEqual([rc()]);
  });
});
