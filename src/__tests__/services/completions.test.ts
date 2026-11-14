import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KNOWN_FLAGS, SUBCOMMANDS } from '../../services/args.ts';
import {
  COMPLETION_SHELLS,
  FLAGS,
  GLOBAL_FLAGS,
  SUBCOMMAND_INFO,
  WIZARD_FLAGS,
} from '../../services/cliSurface.ts';
import { completionScript } from '../../services/completions.ts';

const has = (binary: string) =>
  spawnSync('sh', ['-c', 'command -v "$1"', 'sh', binary]).status === 0;

describe('the CLI description', () => {
  const described = [
    ...Object.values(FLAGS),
    ...GLOBAL_FLAGS,
    ...WIZARD_FLAGS,
    ...Object.values(SUBCOMMAND_INFO).flatMap((info) => info.flags),
  ];

  it('describes every flag the parser accepts, and only those', () => {
    const parsed = [...KNOWN_FLAGS.boolean, ...KNOWN_FLAGS.value].sort();
    expect([...new Set(Object.values(FLAGS).map((f) => f.name))].sort()).toEqual(parsed);
    for (const flag of described) {
      if (flag.short) expect(KNOWN_FLAGS.short[flag.short]).toBe(flag.name);
    }
  });

  it('gives values to exactly the parser value flags', () => {
    for (const flag of described) {
      expect(KNOWN_FLAGS.value.includes(flag.name), flag.name).toBe(flag.values !== undefined);
    }
  });

  it('describes every subcommand', () => {
    expect(Object.keys(SUBCOMMAND_INFO).sort()).toEqual([...SUBCOMMANDS].sort());
  });
});

describe('completionScript', () => {
  it.each(COMPLETION_SHELLS)('names every subcommand in the %s script', (shell) => {
    const script = completionScript(shell);
    for (const sub of SUBCOMMANDS) expect(script).toContain(sub);
  });

  it('registers each script with its shell', () => {
    expect(completionScript('bash')).toContain(
      'complete -F _shell_configurator shell-configurator'
    );
    expect(completionScript('zsh')).toMatch(/^#compdef shell-configurator\n/);
    expect(completionScript('fish')).toContain('complete -c shell-configurator -f');
  });
});

describe('the generated scripts in real shells', () => {
  let dir: string;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shellconf-completions-'));
    for (const shell of COMPLETION_SHELLS) {
      fs.writeFileSync(path.join(dir, `c.${shell}`), completionScript(shell));
    }
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  const run = (binary: string, args: string[]) =>
    execFileSync(binary, args, { cwd: dir, encoding: 'utf8' });

  it('parses in bash', () => {
    expect(() => run('bash', ['-n', 'c.bash'])).not.toThrow();
  });

  it('completes words, flags and values in bash', () => {
    const out = run('bash', [
      '-c',
      `source ./c.bash
t() { COMP_WORDS=("$@"); COMP_CWORD=$(( $# - 1 )); COMPREPLY=(); _shell_configurator; echo "\${COMPREPLY[*]}"; }
t shell-configurator un
t shell-configurator generate --pre
t shell-configurator apply --preset tok
t shell-configurator uninstall --shells zsh,fi
t shell-configurator completions ""
t shell-configurator rollback --l`,
    ]);
    expect(out.split('\n')).toEqual([
      'uninstall',
      '--preset',
      'tokyo-night',
      'zsh,fish',
      'bash zsh fish',
      '--list',
      '',
    ]);
  });

  it.skipIf(!has('zsh'))('parses and completes in zsh', () => {
    expect(() => run('zsh', ['-n', 'c.zsh'])).not.toThrow();
    const out = run('zsh', [
      '-f',
      '-c',
      `compdef() { :; }
compadd() { print -r -- "$*"; }
_values() { print -r -- "$*"; }
source ./c.zsh
words=(shell-configurator generate --character ""); CURRENT=4; _shell-configurator
words=(shell-configurator apply --shells ""); CURRENT=4; _shell-configurator`,
    ]);
    expect(out).toBe('-- arrow lambda dollar\n-s , shell zsh bash fish nushell powershell\n');
  });

  it.skipIf(!has('zsh'))('completes on the first Tab when zsh autoloads it from $fpath', () => {
    const fpathDir = path.join(dir, 'fpath');
    fs.mkdirSync(fpathDir, { recursive: true });
    fs.writeFileSync(path.join(fpathDir, '_shell-configurator'), completionScript('zsh'));
    const out = run('zsh', [
      '-f',
      '-c',
      `compdef() { :; }
compadd() { print -r -- "$*"; }
fpath=(${fpathDir} $fpath)
autoload -Uz _shell-configurator
words=(shell-configurator generate --character ""); CURRENT=4; _shell-configurator`,
    ]);
    expect(out).toBe('-- arrow lambda dollar\n');
  });

  it.skipIf(!has('fish'))('parses and completes in fish', () => {
    expect(() => run('fish', ['--no-execute', 'c.fish'])).not.toThrow();
    const out = run('fish', [
      '-c',
      "source ./c.fish; complete -C 'shell-configurator debug-' ; complete -C 'shell-configurator generate --character l'",
    ]);
    expect(out).toContain('debug-info\tPrint a report of the setup for a bug report');
    expect(out).toContain('lambda\tThe prompt character symbol');
  });
});
