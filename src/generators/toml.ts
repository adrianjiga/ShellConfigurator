/**
 * Escaping for values interpolated into the generated starship.toml.
 *
 * The config is written from readable, aligned templates rather than serialized
 * from an object, because the generated file is meant to be human-editable. The
 * cost of that choice is hand-escaping, so it is centralised here: every template
 * that interpolates a value routes it through one of these helpers, and the
 * quoting rules are defined once instead of being re-derived per call site.
 */

// biome-ignore lint/suspicious/noControlCharactersInRegex: TOML forbids these raw, so they are matched to be escaped.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

// biome-ignore lint/suspicious/noControlCharactersInRegex: a literal string can hold none of these.
const LITERAL_UNSAFE = /['\u0000-\u0008\u000a-\u001f\u007f]/;

/**
 * Escapes the contents of a TOML basic (double-quoted) string. Callers supply the
 * surrounding quotes, so this only handles what would break out of them.
 *
 * Deliberately does NOT escape `$`: several templates embed starship's own
 * `${count}`-style variables, which must reach the config verbatim.
 */
export function tomlBasic(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(CONTROL_CHARS, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/**
 * Escapes the contents of a TOML literal (single-quoted) string. Literal strings
 * have no escape sequences at all, so an embedded single quote or control
 * character cannot be encoded — such values fall back to a basic string, quotes
 * included.
 */
export function tomlLiteral(value: string): string {
  return LITERAL_UNSAFE.test(value) ? `"${tomlBasic(value)}"` : `'${value}'`;
}
