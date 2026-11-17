import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('fs', () => ({
  constants: { W_OK: 2 },
  lstatSync: vi.fn(),
  statSync: vi.fn(),
  realpathSync: vi.fn(),
  accessSync: vi.fn(),
  chmodSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  appendFileSync: vi.fn(),
  copyFileSync: vi.fn(),
  rmSync: vi.fn(),
}));

function expectBefore(text: string, first: string, second: string): void {
  expect(text.indexOf(first)).toBeGreaterThanOrEqual(0);
  expect(text.indexOf(second)).toBeGreaterThan(text.indexOf(first));
}

/** The content of the module's last atomic write (the temp-file write). */
function lastWrittenContent(): string {
  return vi.mocked(fs.writeFileSync).mock.calls.at(-1)?.[1] as string;
}

import * as fs from 'node:fs';
import { getShell, posixShellQuote } from '../../config/shells.ts';
import { applyShellConfig } from '../../generators/shellRc.ts';
import { hasBinary } from '../helpers/binaries.ts';
import { stubPlatform } from '../helpers/platform.ts';

const expectedConfigPath = path.join(os.homedir(), '.config', 'starship', 'zsh.toml');
const ownBin = posixShellQuote(path.join(os.homedir(), '.local', 'bin'));

beforeEach(() => {
  vi.stubEnv('XDG_CONFIG_HOME', undefined);
  vi.stubEnv('ZDOTDIR', undefined);
  vi.stubEnv('STARSHIP_CONFIG', undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('applyShellConfig', () => {
  let restorePlatform: () => void;
  beforeEach(() => {
    vi.resetAllMocks();
    restorePlatform = stubPlatform('linux');
  });
  afterEach(() => restorePlatform());

  it('appends init line to shell rc file', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => '# existing content');

    const result = applyShellConfig('zsh');

    expect(result.applied).toBe(true);
    expect(lastWrittenContent()).toContain('starship init zsh');
    expect(fs.renameSync).toHaveBeenCalled();
  });

  it('points STARSHIP_CONFIG at the per-shell config before the init line', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => '');

    const result = applyShellConfig('zsh');

    expect(result.applied).toBe(true);
    const finalContent = lastWrittenContent();
    const expected = `export STARSHIP_CONFIG='${expectedConfigPath}'`;
    expect(finalContent).toContain(expected);
    // The env must be set before `starship init` runs.
    expectBefore(finalContent, expected, 'starship init');
  });

  it('drops a stale unset guard from a CRLF rc file', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(
      () => '# mine\r\n# Added by ShellConfigurator\r\nunset STARSHIP_CONFIG\r\n'
    );

    applyShellConfig('zsh');

    expect(lastWrittenContent()).not.toContain('unset STARSHIP_CONFIG');
  });

  it('replaces an export an earlier run wrote for a different config path', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(
      () =>
        '# Added by ShellConfigurator\nexport STARSHIP_CONFIG="/old/xdg/starship/zsh.toml"\neval "$(starship init zsh)"\n'
    );

    const result = applyShellConfig('zsh');

    expect(result.applied).toBe(true);
    const content = lastWrittenContent();
    expect(content).not.toContain('/old/xdg/');
    expect(content).toContain(`export STARSHIP_CONFIG='${expectedConfigPath}'`);
    expect(content.match(/starship init zsh/g)).toHaveLength(1);
  });

  it('leaves a user comment that only starts like the marker alone', () => {
    const own = '# Added by ShellConfigurator users: keep this\nunset STARSHIP_CONFIG\n';
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => own);

    applyShellConfig('zsh');

    expect(lastWrittenContent().startsWith(own)).toBe(true);
  });

  it("moves an earlier run's double-quoted export to the quoted form", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(
      () =>
        `# Added by ShellConfigurator\nexport STARSHIP_CONFIG="${expectedConfigPath}"\neval "$(starship init zsh)"\n`
    );

    expect(applyShellConfig('zsh').applied).toBe(true);
    const content = lastWrittenContent();
    expect(content).not.toContain(`STARSHIP_CONFIG="`);
    expect(content).toContain(`export STARSHIP_CONFIG='${expectedConfigPath}'`);
    expect(content.match(/starship init zsh/g)).toHaveLength(1);
  });

  it('quotes a path with spaces and dollar signs so the shell takes it literally', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => '');

    applyShellConfig('fish', { ensurePathDir: "/Users/J Doe/$bin/it's" });

    expect(lastWrittenContent()).toContain(`fish_add_path '/Users/J Doe/$bin/it\\'s'`);
  });

  it('keeps the PATH line of a per-shell block when switching to adopt mode', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(
      () =>
        `# Added by ShellConfigurator\nexport PATH=${ownBin}:"$PATH"\nexport STARSHIP_CONFIG='${expectedConfigPath}'\neval "$(starship init zsh)"\n`
    );

    applyShellConfig('zsh', { pointAtSharedConfig: true });

    expect(lastWrittenContent()).toBe(
      `# Added by ShellConfigurator (shared config)\nexport PATH=${ownBin}:"$PATH"\neval "$(starship init zsh)"\n`
    );
  });

  it('keeps the closing fi of a user if-block wrapped around a removed block', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() =>
      [
        'if command -v starship >/dev/null; then',
        '# Added by ShellConfigurator',
        'unset STARSHIP_CONFIG',
        'fi',
        '',
      ].join('\n')
    );

    applyShellConfig('zsh');

    const content = lastWrittenContent();
    expect(content).not.toContain('unset STARSHIP_CONFIG');
    expect(content).toMatch(/then\nfi\n/);
  });

  it('uses fish syntax for the STARSHIP_CONFIG line', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => '');

    applyShellConfig('fish');

    const finalContent = lastWrittenContent();
    const expected = `set -gx STARSHIP_CONFIG '${path.join(os.homedir(), '.config', 'starship', 'fish.toml')}'`;
    expect(finalContent).toContain(expected);
  });

  it('omits the STARSHIP_CONFIG line when pointing at the shared config', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => '');

    const result = applyShellConfig('zsh', { pointAtSharedConfig: true });

    expect(result.applied).toBe(true);
    const finalContent = lastWrittenContent();
    expect(finalContent).not.toContain('STARSHIP_CONFIG');
    expect(finalContent).toContain('starship init zsh');
  });

  it('treats an rc that only has the init line as already configured in adopt mode', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => 'eval "$(starship init zsh)"');

    const result = applyShellConfig('zsh', { pointAtSharedConfig: true });

    expect(result.applied).toBe(false);
    expect(result.note).toBe('already configured');
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('adopt mode repairs an rc left pointing at a per-shell config', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() =>
      [
        '# Added by ShellConfigurator',
        `export STARSHIP_CONFIG='${expectedConfigPath}'`,
        'eval "$(starship init zsh)"',
      ].join('\n')
    );

    const result = applyShellConfig('zsh', { pointAtSharedConfig: true });

    expect(result.applied).toBe(true);
    const finalContent = lastWrittenContent();
    expect(finalContent).toContain('starship init zsh');
    expect(finalContent).not.toContain('STARSHIP_CONFIG');
  });

  it('stays idempotent across a second adopt run', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() =>
      ['# Added by ShellConfigurator (shared config)', 'eval "$(starship init zsh)"'].join('\n')
    );

    const result = applyShellConfig('zsh', { pointAtSharedConfig: true });

    expect(result.applied).toBe(false);
    expect(result.note).toBe('already configured');
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('non-adopt mode replaces an init-only block left by an adopt run', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() =>
      ['# Added by ShellConfigurator (shared config)', 'eval "$(starship init zsh)"'].join('\n')
    );

    const result = applyShellConfig('zsh');

    expect(result.applied).toBe(true);
    const finalContent = lastWrittenContent();
    expectBefore(finalContent, 'STARSHIP_CONFIG', 'starship init zsh');
  });

  it('keeps user lines glued directly under a stale adopt block', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() =>
      [
        '# Added by ShellConfigurator (shared config)',
        'eval "$(starship init zsh)"',
        'export EDITOR=vim',
      ].join('\n')
    );

    const result = applyShellConfig('zsh');

    expect(result.applied).toBe(true);
    const finalContent = lastWrittenContent();
    expect(finalContent).toContain('export EDITOR=vim');
    expect(finalContent.match(/starship init zsh/g)).toHaveLength(1);
    expect(finalContent).toContain('STARSHIP_CONFIG');
  });

  it('keeps user lines glued under the per-shell block an adopt run removes', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() =>
      [
        '# Added by ShellConfigurator',
        `export STARSHIP_CONFIG='${expectedConfigPath}'`,
        'eval "$(starship init zsh)"',
        'export EDITOR=vim',
      ].join('\n')
    );

    const result = applyShellConfig('zsh', { pointAtSharedConfig: true });

    expect(result.applied).toBe(true);
    const finalContent = lastWrittenContent();
    expect(finalContent).toContain('export EDITOR=vim');
    expect(finalContent).not.toContain('STARSHIP_CONFIG');
    expect(finalContent.match(/starship init zsh/g)).toHaveLength(1);
  });

  it('puts a needed PATH line above a user init line, not after it', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(
      () => `# mine\nexport STARSHIP_CONFIG='${expectedConfigPath}'\neval "$(starship init zsh)"\n`
    );

    applyShellConfig('zsh', { ensurePathDir: '/home/u/.local/bin' });

    const content = lastWrittenContent();
    expectBefore(content, `export PATH='/home/u/.local/bin':"$PATH"`, 'starship init zsh');
  });

  it('adds a missing export inside its own managed block, above the init line', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(
      () => '# Added by ShellConfigurator\neval "$(starship init zsh)"\n'
    );

    applyShellConfig('zsh');

    expect(lastWrittenContent()).toBe(
      `# Added by ShellConfigurator\nexport STARSHIP_CONFIG='${expectedConfigPath}'\neval "$(starship init zsh)"\n`
    );
  });

  it('keeps user lines glued under the unset block a per-shell run removes', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() =>
      ['# Added by ShellConfigurator', 'unset STARSHIP_CONFIG', 'export EDITOR=vim'].join('\n')
    );

    const result = applyShellConfig('bash');

    expect(result.applied).toBe(true);
    const finalContent = lastWrittenContent();
    expect(finalContent).toContain('export EDITOR=vim');
    expect(finalContent).not.toContain('unset STARSHIP_CONFIG');
  });

  it('is idempotent — skips when the STARSHIP_CONFIG line is already present', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(
      () => `export STARSHIP_CONFIG='${expectedConfigPath}'\neval "$(starship init zsh)"`
    );

    const result = applyShellConfig('zsh');

    expect(result.applied).toBe(false);
    expect(result.note).toBe('already configured');
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('still recognises managed lines that gained trailing spaces', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(
      () =>
        `# Added by ShellConfigurator  \nexport STARSHIP_CONFIG='${expectedConfigPath}'  \neval "$(starship init zsh)"  \n`
    );

    const result = applyShellConfig('zsh');

    expect(result).toMatchObject({ applied: false, note: 'already configured' });
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('creates the rc when its folder exists but the file does not', () => {
    const rcPath = getShell('zsh')!.rcFile!;
    vi.mocked(fs.existsSync).mockImplementation((p) => String(p) !== rcPath);

    const result = applyShellConfig('zsh');

    expect(result.applied).toBe(true);
    expect(fs.readFileSync).not.toHaveBeenCalledWith(rcPath, 'utf8');
    expect(lastWrittenContent()).toBe(
      `# Added by ShellConfigurator\nexport STARSHIP_CONFIG='${expectedConfigPath}'\neval "$(starship init zsh)"\n`
    );
  });

  it('adds the missing STARSHIP_CONFIG line but not a duplicate init line', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    // A shell set up by an old wizard run has the init line but no per-shell config line.
    vi.mocked(fs.readFileSync).mockImplementation(() => 'eval "$(starship init zsh)"');

    const result = applyShellConfig('zsh');

    expect(result.applied).toBe(true);
    const finalContent = lastWrittenContent();
    expect(finalContent).toContain(`export STARSHIP_CONFIG='${expectedConfigPath}'`);
    // The init line was already in the rc and must not be added a second time.
    expect(finalContent.match(/starship init zsh/g)).toHaveLength(1);
    // Above the user's init line, closed by a blank line so that line stays theirs.
    expect(finalContent).toBe(
      `# Added by ShellConfigurator\nexport STARSHIP_CONFIG='${expectedConfigPath}'\n\neval "$(starship init zsh)"`
    );
  });

  it('works for bash', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => '');

    const result = applyShellConfig('bash');

    expect(result.applied).toBe(true);
    expect(lastWrittenContent()).toContain('starship init bash');
  });

  it('works for fish', () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => !String(p).includes('conf.d'));
    vi.mocked(fs.readFileSync).mockImplementation(() => '');

    const result = applyShellConfig('fish');

    expect(result.applied).toBe(true);
    expect(lastWrittenContent()).toContain('starship init fish');
  });

  it('adds only the fish export when conf.d already inits starship', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => '');

    applyShellConfig('fish');

    expect(lastWrittenContent()).toContain('set -gx STARSHIP_CONFIG');
    expect(lastWrittenContent()).not.toContain('starship init fish');
  });

  it('adds back an init line that was removed after an earlier run', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(
      () => `# Added by ShellConfigurator\nexport STARSHIP_CONFIG='${expectedConfigPath}'\n`
    );

    const result = applyShellConfig('zsh');

    expect(result.applied).toBe(true);
    expect(lastWrittenContent()).toContain('eval "$(starship init zsh)"');
  });

  it('does not count a commented-out export as present', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(
      () => `# export STARSHIP_CONFIG='${expectedConfigPath}'\neval "$(starship init zsh)"\n`
    );

    const result = applyShellConfig('zsh');

    expect(result.applied).toBe(true);
    expect(lastWrittenContent()).toMatch(/^export STARSHIP_CONFIG=/m);
  });

  it('only notes the PATH change when the PATH line was really added', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(
      () => `export PATH='/home/u/.local/bin':"$PATH"\n`
    );

    const result = applyShellConfig('zsh', { ensurePathDir: '/home/u/.local/bin' });

    expect(result.applied).toBe(true);
    expect(result.note).toBeUndefined();
  });

  it('returns manual note for nushell (no rc file)', () => {
    const result = applyShellConfig('nushell');

    expect(result.applied).toBe(false);
    expect(result.note).toBe(
      'Run its setup command from Bash (it invokes Nushell to write its autoload files).'
    );
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it.skipIf(!hasBinary('bash'))(
    'provides a Nushell setup command that Bash can parse',
    async () => {
      const { execFileSync } = await import('node:child_process');
      const command = getShell('nushell')!.initLine;

      expect(command).toMatch(/^nu -c '/);
      expect(() => execFileSync('bash', ['-n', '-c', command])).not.toThrow();
    }
  );

  it('returns manual note for powershell (no rc file)', () => {
    const result = applyShellConfig('powershell');

    expect(result.applied).toBe(false);
    expect(result.note).toBe('Add its setup line to your $PROFILE file in PowerShell.');
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('pins STARSHIP_CONFIG to the per-shell config in the powershell init line', () => {
    const line = getShell('powershell')!.initLine;

    expect(line).toContain('$env:STARSHIP_CONFIG =');
    expect(line).toContain('starship/powershell.toml');
    expect(line).toContain('Invoke-Expression (&starship init powershell)');
  });

  it('reports nushell as already configured when its autoload file exists', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const result = applyShellConfig('nushell');

    expect(result.applied).toBe(false);
    expect(result.note).toBe('already configured');
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('reports adopt-mode Nushell configured only once the per-shell pin is gone', () => {
    const pin = getShell('nushell')!.additionalInitPaths![0]!;
    vi.mocked(fs.existsSync).mockImplementation((p) => String(p) !== pin);
    expect(applyShellConfig('nushell', { pointAtSharedConfig: true }).note).toBe(
      'already configured'
    );

    vi.mocked(fs.existsSync).mockReturnValue(true);
    expect(applyShellConfig('nushell', { pointAtSharedConfig: true }).note).not.toBe(
      'already configured'
    );
  });

  it('does not report Nushell configured if only one autoload file exists', () => {
    const nushell = getShell('nushell')!;
    vi.mocked(fs.existsSync).mockImplementation((file) => file === nushell.initPath);

    const result = applyShellConfig('nushell');

    expect(result.note).not.toBe('already configured');
  });

  it('reports powershell as already configured when $PROFILE contains the init line', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => `${getShell('powershell')!.initLine}\n`);

    const result = applyShellConfig('powershell');

    expect(result.applied).toBe(false);
    expect(result.note).toBe('already configured');
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('finds the powershell init line in the all-hosts profile.ps1', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation((p) =>
      String(p).endsWith('profile.ps1') && !String(p).includes('Microsoft')
        ? 'Invoke-Expression (&starship init powershell)\n'
        : ''
    );

    expect(applyShellConfig('powershell').note).toBe('already configured');
  });

  it('keeps the manual note when powershell $PROFILE exists but lacks the init line', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => '# my profile\n');

    const result = applyShellConfig('powershell');

    expect(result.applied).toBe(false);
    expect(result.note).not.toBe('already configured');
    expect(result.note).toContain('$PROFILE');
  });

  it('keeps the manual note when the powershell profile cannot be read', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('EACCES');
    });

    const result = applyShellConfig('powershell');

    expect(result.applied).toBe(false);
    expect(result.note).not.toBe('already configured');
    expect(result.note).toContain('$PROFILE');
  });

  it('creates rc parent directory if it does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.readFileSync).mockImplementation(() => '');

    applyShellConfig('fish');

    expect(fs.mkdirSync).toHaveBeenCalled();
  });

  it('still applies config when starship init appears only in a comment', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(
      () => '# starship init was removed\n# See https://starship.rs'
    );

    const result = applyShellConfig('zsh');

    expect(result.applied).toBe(true);
    expect(lastWrittenContent()).toContain('starship init zsh');
  });

  it('appends the ShellConfigurator banner before the init line', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => '');

    const result = applyShellConfig('zsh');

    expect(result.applied).toBe(true);
    const finalContent = lastWrittenContent();
    expect(finalContent).toContain('# Added by ShellConfigurator');
    expect(finalContent).toContain('eval "$(starship init zsh)"');
  });

  it('throws with a helpful message when the rc directory cannot be created', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    expect(() => applyShellConfig('zsh')).toThrow('Cannot create directory');
    expect(() => applyShellConfig('zsh')).toThrow('EACCES: permission denied');
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('adds a PATH line before the init line when starship is not reachable', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => '');

    const result = applyShellConfig('zsh', { ensurePathDir: '/home/u/.local/bin' });

    const finalContent = lastWrittenContent();
    expect(finalContent).toContain(`export PATH='/home/u/.local/bin':"$PATH"`);
    // Order matters: `starship init` cannot resolve before PATH is set.
    expectBefore(finalContent, 'export PATH', 'starship init');
    expect(result.note).toContain('/home/u/.local/bin');
  });

  it('uses fish syntax for the PATH line', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => '');

    applyShellConfig('fish', { ensurePathDir: '/home/u/.local/bin' });

    const finalContent = lastWrittenContent();
    expect(finalContent).toContain("fish_add_path '/home/u/.local/bin'");
    expect(finalContent).not.toContain('export PATH');
  });

  it('omits the PATH line when starship is already reachable', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => '');

    const result = applyShellConfig('zsh', { ensurePathDir: null });

    expect(lastWrittenContent()).not.toContain('export PATH');
    expect(result.note).toBeUndefined();
  });

  it('does not duplicate a PATH line that is already present', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => `export PATH='/home/u/.local/bin':"$PATH"`);

    applyShellConfig('zsh', { ensurePathDir: '/home/u/.local/bin' });

    const finalContent = lastWrittenContent();
    // The PATH line was already in the rc; a rewrite must not duplicate it.
    expect(finalContent.match(/export PATH='\/home\/u\/\.local\/bin':"\$PATH"/g)).toHaveLength(1);
    expect(finalContent).toContain('starship init zsh');
  });

  it('is idempotent for fish', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(
      () =>
        `set -gx STARSHIP_CONFIG '${path.join(os.homedir(), '.config', 'starship', 'fish.toml')}'\nstarship init fish | source`
    );

    const result = applyShellConfig('fish');

    expect(result.applied).toBe(false);
    expect(result.note).toBe('already configured');
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('removes a stale unset guard so the per-shell config takes effect', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const fishConfig = path.join(os.homedir(), '.config', 'starship', 'fish.toml');
    // A later wizard run reset fish to the shared config, leaving a stale guard
    // that stomps on the per-shell wiring added earlier.
    vi.mocked(fs.readFileSync).mockImplementation(
      () =>
        `\n# Added by ShellConfigurator\nset -gx STARSHIP_CONFIG '${fishConfig}'\nstarship init fish | source\n\n# Added by ShellConfigurator\nset -e STARSHIP_CONFIG\n`
    );

    const result = applyShellConfig('fish');

    expect(result.applied).toBe(true);
    expect(result.note).toBe('removed a stale ShellConfigurator block');
    const written = lastWrittenContent();
    expect(written).toContain(`set -gx STARSHIP_CONFIG '${fishConfig}'`);
    expect(written).toContain('starship init fish | source');
    expect(written).not.toContain('set -e STARSHIP_CONFIG');
  });

  it('repairs a shell whose rc only has the stale unset guard', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(
      () => '# Existing user content\n\n# Added by ShellConfigurator\nunset STARSHIP_CONFIG\n'
    );

    const result = applyShellConfig('bash');

    expect(result.applied).toBe(true);
    const written = lastWrittenContent();
    expect(written).toContain('# Existing user content');
    expect(written).toContain('export STARSHIP_CONFIG');
    expect(written).toContain('starship init bash');
    expect(written).not.toContain('unset STARSHIP_CONFIG');
  });

  it('drops only the stale unset block when both generations of config coexist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(
      () =>
        `\n# Added by ShellConfigurator\neval "$(starship init zsh)"\n\n# Added by ShellConfigurator\nexport STARSHIP_CONFIG='${expectedConfigPath}'\n\n# Added by ShellConfigurator\nunset STARSHIP_CONFIG\n`
    );

    const result = applyShellConfig('zsh');

    expect(result.applied).toBe(true);
    const written = lastWrittenContent();
    expect(written).toContain('eval "$(starship init zsh)"');
    expect(written).toContain(`export STARSHIP_CONFIG='${expectedConfigPath}'`);
    expect(written).not.toContain('unset STARSHIP_CONFIG');
  });
});
