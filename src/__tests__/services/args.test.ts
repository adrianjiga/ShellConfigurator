import { describe, expect, it } from 'vitest';
import { type CliFlags, parseCliArgs, quoteArgv } from '../../services/args.ts';

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

    it('recognises doctor', () => {
      expect(parseCliArgs(['doctor']).subcommand).toBe('doctor');
    });

    it('recognises repair', () => {
      expect(parseCliArgs(['repair']).subcommand).toBe('repair');
    });

    it('rejects an unknown word in the subcommand position', () => {
      expect(() => parseCliArgs(['deploy'])).toThrow(/Unknown command 'deploy'/);
      expect(() => parseCliArgs(['docter'])).toThrow(/Unknown command 'docter'/);
      expect(() => parseCliArgs(['generat'])).toThrow(/Unknown command 'generat'/);
    });

    it('lists the available commands in the error', () => {
      expect(() => parseCliArgs(['deploy'])).toThrow(/generate, apply, doctor, repair/);
    });

    it('rejects a second positional argument', () => {
      expect(() => parseCliArgs(['generate', 'apply'])).toThrow(/Unexpected argument 'apply'/);
    });

    it('rejects a bare word dropped after a boolean flag', () => {
      expect(() => parseCliArgs(['--powerline', 'false'])).toThrow(/Unknown command 'false'/);
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
      ['--adopt', 'adopt', true],
      ['--json', 'json', true],
      ['--fix', 'fix', true],
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

    it('--import-url takes next token', () => {
      expect(parseCliArgs(['--import-url', 'https://example.com/starship.toml']).importUrl).toBe(
        'https://example.com/starship.toml'
      );
    });

    it('--state=card.json inline value', () => {
      expect(parseCliArgs(['--state=card.json']).stateFile).toBe('card.json');
    });

    it('-o=out.toml short flag inline value', () => {
      expect(parseCliArgs(['-o=out.toml']).outputFile).toBe('out.toml');
    });

    it('accepts an inline value that starts with a dash', () => {
      expect(parseCliArgs(['-o=-out.toml']).outputFile).toBe('-out.toml');
      expect(parseCliArgs(['--output=-weird.toml']).outputFile).toBe('-weird.toml');
    });

    it('does not reuse the next token after an inline value', () => {
      const f = parseCliArgs(['--preset=catppuccin', '--no-powerline']);
      expect(f.preset).toBe('catppuccin');
      expect(f.powerline).toBe(false);
    });

    it('parses an inline boolean value', () => {
      expect(parseCliArgs(['--powerline=true']).powerline).toBe(true);
      expect(parseCliArgs(['--powerline=false']).powerline).toBe(false);
      expect(parseCliArgs(['--dry-run=yes']).dryRun).toBe(true);
      expect(parseCliArgs(['--dry-run=no']).dryRun).toBe(false);
      expect(parseCliArgs(['--no-powerline=true']).powerline).toBe(false);
    });

    it('rejects an unparseable inline boolean value', () => {
      expect(() => parseCliArgs(['--dry-run=maybe'])).toThrow(/'--dry-run' takes true or false/);
    });

    it('rejects an empty inline value instead of accepting it silently', () => {
      expect(() => parseCliArgs(['--preset='])).toThrow(/Flag '--preset' needs a value/);
    });

    it('rejects an empty -o value instead of falling back to stdout', () => {
      expect(() => parseCliArgs(['-o='])).toThrow(/Flag '--output' needs a value/);
    });

    it('rejects an empty --shells value instead of wiping the selection', () => {
      expect(() => parseCliArgs(['--shells='])).toThrow(/Flag '--shells' needs a value/);
    });

    it('rejects an empty next-token value', () => {
      expect(() => parseCliArgs(['--preset', '', '--dry-run'])).toThrow(
        /Flag '--preset' needs a value/
      );
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

    it('does not let a value flag swallow a subcommand name', () => {
      expect(() => parseCliArgs(['--preset', 'apply', '--state', 'card.json'])).toThrow(
        /Flag '--preset' needs a value; 'apply' is a subcommand name/
      );
      expect(() => parseCliArgs(['--shells', 'apply'])).toThrow(/is a subcommand name/);
      expect(() => parseCliArgs(['--set-default', 'generate'])).toThrow(/is a subcommand name/);
    });

    it('still accepts an inline value that happens to match a subcommand name', () => {
      expect(parseCliArgs(['--preset=apply']).preset).toBe('apply');
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

    it('applies every boolean short flag in a cluster', () => {
      const f = parseCliArgs(['-dv']);
      expect(f.dryRun).toBe(true);
      expect(f.version).toBe(true);
    });

    it('-dvh sets all three boolean shorts', () => {
      const f = parseCliArgs(['-dvh']);
      expect(f.dryRun).toBe(true);
      expect(f.version).toBe(true);
      expect(f.help).toBe(true);
    });

    it('keeps a cluster containing -o unknown', () => {
      expect(() => parseCliArgs(['-do'])).toThrow("Unknown flag '-do'");
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

  it('rejects a value flag whose next token is a flag instead of swallowing it', () => {
    expect(() => parseCliArgs(['--preset', '--no-powerline'])).toThrow(
      /Flag '--preset' needs a value/
    );
  });

  describe('quoteArgv', () => {
    it('leaves shell-safe tokens bare', () => {
      expect(quoteArgv(['generate', '--preset', 'pure-prompt', '-o', 'out.toml'])).toBe(
        'generate --preset pure-prompt -o out.toml'
      );
    });

    it('quotes tokens with spaces so recorded commands re-run verbatim', () => {
      expect(quoteArgv(['--state', 'my card.json'])).toBe("--state 'my card.json'");
    });

    it('escapes embedded single quotes', () => {
      expect(quoteArgv(["it's.toml"])).toBe("'it'\\''s.toml'");
    });

    it('quotes an empty token', () => {
      expect(quoteArgv([''])).toBe("''");
    });
  });

  describe('usage errors', () => {
    it('collects none for a clean command line', () => {
      expect(parseCliArgs(['generate', '--preset', 'pure']).subcommand).toBe('generate');
    });

    it('aborts on an unknown flag instead of starting the run', () => {
      expect(() => parseCliArgs(['generate', '--bogus'])).toThrow("Unknown flag '--bogus'");
      expect(() => parseCliArgs(['--bogus', 'generate'])).toThrow("Unknown flag '--bogus'");
    });

    it('aborts when a known value flag is left without a value', () => {
      expect(() => parseCliArgs(['--preset'])).toThrow(/Flag '--preset' needs a value/);
      expect(() => parseCliArgs(['--preset', '--dry-run'])).toThrow(
        /Flag '--preset' needs a value/
      );
    });

    it('aborts on an unknown short flag', () => {
      expect(() => parseCliArgs(['-z'])).toThrow("Unknown flag '-z'");
    });

    it('names an unknown flag without its inline value', () => {
      expect(() => parseCliArgs(['--bogus=1'])).toThrow("Unknown flag '--bogus'");
    });

    it('aborts on an unknown flag before reading the word after it', () => {
      expect(() => parseCliArgs(['--bogus', 'value'])).toThrow("Unknown flag '--bogus'");
    });

    it('aborts when -o ends the command line', () => {
      expect(() => parseCliArgs(['generate', '-o'])).toThrow(/Flag '--output' needs a value/);
    });
  });

  describe('flag placement', () => {
    it('reads flags placed before the subcommand', () => {
      const flags = parseCliArgs(['--dry-run', '--shells', 'zsh', 'apply']);
      expect(flags.subcommand).toBe('apply');
      expect(flags.dryRun).toBe(true);
      expect(flags.shells).toEqual(['zsh']);
    });

    it('keeps the last value of a repeated value flag', () => {
      expect(parseCliArgs(['--preset', 'pure-prompt', '--preset', 'jetpack']).preset).toBe(
        'jetpack'
      );
    });
  });
});
