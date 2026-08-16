import { describe, it, expect } from 'vitest';
import { parse } from '@iarna/toml';
import { tomlBasic, tomlLiteral } from '../../generators/toml.ts';

describe('tomlBasic', () => {
  it('leaves ordinary values untouched', () => {
    expect(tomlBasic('bold blue')).toBe('bold blue');
  });

  it('escapes a quote so it cannot terminate the string early', () => {
    const out = `style = "${tomlBasic('bold "blue"')}"`;
    expect(parse(out)).toEqual({ style: 'bold "blue"' });
  });

  it('escapes backslashes before quotes', () => {
    const out = `style = "${tomlBasic('a\\b')}"`;
    expect(parse(out)).toEqual({ style: 'a\\b' });
  });

  it('escapes newlines and tabs', () => {
    const out = `style = "${tomlBasic('a\nb\tc')}"`;
    expect(parse(out)).toEqual({ style: 'a\nb\tc' });
  });

  it('preserves starship variable syntax verbatim', () => {
    // git_status templates rely on ${count} reaching the config unmangled.
    const out = `ahead = "${tomlBasic('⇡${count}')}"`;
    expect(parse(out)).toEqual({ ahead: '⇡${count}' });
  });
});

describe('tomlLiteral', () => {
  it('wraps a plain value in single quotes', () => {
    expect(tomlLiteral('❯')).toBe("'❯'");
    expect(parse(`s = ${tomlLiteral('❯')}`)).toEqual({ s: '❯' });
  });

  it('keeps markup with brackets and parentheses intact', () => {
    const out = `s = ${tomlLiteral('[❯](green)')}`;
    expect(parse(out)).toEqual({ s: '[❯](green)' });
  });

  it('falls back to a basic string when the value contains a single quote', () => {
    // Literal strings have no escapes, so a quote would otherwise break the file.
    const out = `s = ${tomlLiteral("it's")}`;
    expect(parse(out)).toEqual({ s: "it's" });
  });
});
