# 0004 — Model optional choices as discriminated unions

**Status**: Accepted

## Context

The wizard asks the user about a Nerd Font. There are three genuinely different
outcomes:

1. no font is wanted — the font step is skipped entirely;
2. a font is wanted but not chosen yet — the wizard routes to the font picker;
3. a specific font was picked — that id is passed to the installer.

Earlier drafts modelled "no font" as `null`, or as a sentinel string
(`'none'`), and the step logic was sprinkled with `if (choice && choice !==
'none' && choice !== 'skip')` checks. A sentinel invites callers to invent
guesses about the value and lets two "empty" states collide.

## Decision

`NerdFontChoice` is a discriminated union:

```ts
type NerdFontChoice =
  | { kind: 'none' }
  | { kind: 'select' }
  | { kind: 'install'; id: string };
```

Two tiny predicates own the interpretation — `shouldVisitFontSelect()` (does the
wizard show the font step?) and `fontIdToInstall()` (what, if anything, does the
installer install?). There is deliberately no sentinel string.

## Consequences

- Total-function ownership: the step machine and the installer never re-derive
  the meaning of a stored value; they ask the predicates.
- Discriminated fields (`kind`) are checked exhaustively by the compiler, so a
  new variant cannot silently fall through a switch.
- The `font_select` step is skipped purely via `shouldVisitFontSelect()`, which
  keeps the decision in one place and is asserted in tests.