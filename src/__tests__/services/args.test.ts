import { describe, expect, it } from 'vitest';
import { type CliFlags, parseCliArgs } from '../../services/args.ts';

describe('parseCliArgs', () => {
  it('returns defaults when argv is empty', () => {
    const f = parseCliArgs([]);
    expect(f.subcommand).toBeNull();
    expect(f.preset).toBeUndefined();
    expect(f.help).toBe(false);
    expect(f.version).toBe(false);
    expect(f.restore).toBe(false);
    expect(f.dryRun).toBeUndefined();
  });

  describe('subcommands', () => {
    it('recognises generate', () => {
      expect(parseCliArgs(['generate']).subcommand).toBe('generate');
    });

    it('recognises apply', () => {
      expect(parseCliArgs(['apply']).subcommand).toBe('apply');
    });

    it('ignores unknown positional tokens', () => {
      expect(parseCliArgs(['deploy']).subcommand).toBeNull();
    });
  });

  describe('boolean flags', () => {
    const cases: Array<[string, keyof CliFlags, boolean]> = [
      ['--help', 'help', true],
      ['-h', 'help', true],
      ['--version', 'version', true],
      ['-v', 'version', true],
      ['--restore', 'restore', true],
      ['--undo', 'restore', true],
      ['--dry-run', 'dryRun', true],
      ['-d', 'dryRun', true],
      ['--no-install', 'dryRun', true],
      ['--powerline', 'powerline', true],
      ['--no-powerline', 'powerline', false],
      ['--has-nerd-font', 'hasNerdFont', true],
      ['--no-nerd-font', 'hasNerdFont', false],
      ['--skip-starship', 'skipStarship', true],
    ];

    it.each(cases)('%s sets %s to %s', (arg, key, expected) => {
      expect(parseCliArgs([arg])[key]).toBe(expected);
    });
  });

  describe('value flags', () => {
    it('--preset takes next token', () => {
      expect(parseCliArgs(['--preset', 'catppuccin']).preset).toBe('catppuccin');
    });

    it('--palette takes next token', () => {
      expect(parseCliArgs(['--palette', 'vivid']).palette).toBe('vivid');
    });

    it('--shells splits on comma', () => {
      expect(parseCliArgs(['--shells', 'zsh,bash,fish']).shells).toEqual(['zsh', 'bash', 'fish']);
    });

    it('--shells trims whitespace', () => {
      expect(parseCliArgs(['--shells', ' zsh , fish ']).shells).toEqual(['zsh', 'fish']);
    });

    it('--font takes next token', () => {
      expect(parseCliArgs(['--font', 'JetBrainsMono']).font).toBe('JetBrainsMono');
    });

    it('--font none', () => {
      expect(parseCliArgs(['--font', 'none']).font).toBe('none');
    });

    it('--character takes next token', () => {
      expect(parseCliArgs(['--character', 'lambda']).characterSymbol).toBe('lambda');
    });

    it('--set-default takes next token', () => {
      expect(parseCliArgs(['--set-default', 'zsh']).setDefaultShell).toBe('zsh');
    });

    it('-o maps to outputFile', () => {
      expect(parseCliArgs(['-o', '/tmp/out.toml']).outputFile).toBe('/tmp/out.toml');
    });

    it('--preset=id inline value', () => {
      expect(parseCliArgs(['--preset=catppuccin']).preset).toBe('catppuccin');
    });

    it('--shells=zsh,bash inline value', () => {
      expect(parseCliArgs(['--shells=zsh,bash']).shells).toEqual(['zsh', 'bash']);
    });

    it('--state=card.json inline value', () => {
      expect(parseCliArgs(['--state=card.json']).stateFile).toBe('card.json');
    });

    it('-o=out.toml short flag inline value', () => {
      expect(parseCliArgs(['-o=out.toml']).outputFile).toBe('out.toml');
    });

    it('does not reuse the next token after an inline value', () => {
      const f = parseCliArgs(['--preset=catppuccin', '--no-powerline']);
      expect(f.preset).toBe('catppuccin');
      expect(f.powerline).toBe(false);
    });

    it('ignores an inline value on a boolean flag', () => {
      const f = parseCliArgs(['--powerline=true']);
      expect(f.powerline).toBeUndefined();
    });

    it('--output maps to outputFile', () => {
      expect(parseCliArgs(['--output', 'out.toml']).outputFile).toBe('out.toml');
    });

    it('--export writes state card', () => {
      expect(parseCliArgs(['--export', 'state.json']).exportFile).toBe('state.json');
    });

    it('--import and --state map to stateFile', () => {
      expect(parseCliArgs(['--import', 'base.json']).stateFile).toBe('base.json');
      expect(parseCliArgs(['--state', 'base.json']).stateFile).toBe('base.json');
    });
  });

  describe('short flag expansion', () => {
    it('-v sets version', () => {
      expect(parseCliArgs(['-v']).version).toBe(true);
    });

    it('-h sets help', () => {
      expect(parseCliArgs(['-h']).help).toBe(true);
    });

    it('-d sets dryRun', () => {
      expect(parseCliArgs(['-d']).dryRun).toBe(true);
    });

    it('-o sets outputFile', () => {
      expect(parseCliArgs(['-o', 'out.toml']).outputFile).toBe('out.toml');
    });
  });

  describe('combines subcommand + flags', () => {
    it('generate with preset and output', () => {
      const f = parseCliArgs(['generate', '--preset', 'pure', '-o', 'out.toml']);
      expect(f.subcommand).toBe('generate');
      expect(f.preset).toBe('pure');
      expect(f.outputFile).toBe('out.toml');
    });

    it('apply with state file and dry-run', () => {
      const f = parseCliArgs(['apply', '--state', 'card.json', '--dry-run']);
      expect(f.subcommand).toBe('apply');
      expect(f.stateFile).toBe('card.json');
      expect(f.dryRun).toBe(true);
    });
  });

  it('skips value when next token is a flag', () => {
    const f = parseCliArgs(['--preset', '--no-powerline']);
    expect(f.preset).toBeUndefined();
    expect(f.powerline).toBe(false);
  });
});
