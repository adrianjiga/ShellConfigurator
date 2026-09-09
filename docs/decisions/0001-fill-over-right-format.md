# 0001 — Right-align the prompt with `$fill` instead of `right_format`

**Status**: Accepted

## Context

The wizard builds a two-line prompt: one line of modules, then `\n$character` on
a second line. Right-side modules (`cmd_duration`, `time`, ...) need to be pushed
to the right edge of that first line.

Starship offers `right_format`, which renders a separate prompt right-aligned on
the cursor line. With a two-line prompt that means the right-side modules sit on
their own line, pinned to wherever the cursor is — so they drift vertically as
the terminal scrolls and misalign with the left-hand prompt.

Alternatively, `$fill` is a single module that consumes the space between the
left and right module runs on the *same* line, keeping the whole prompt on one
row.

## Decision

Use `$fill` in the format string and never emit `right_format`:

```
$directory$git_branch$git_status$fill$time\n$character
```

The `[fill]` block is only emitted when at least one right-side module is
configured.

## Consequences

- The two-line prompt stays in one visual row; right modules cannot drift.
- `$fill` needs a symbol (a space) and cannot carry arbitrary styling.
- **This is a guarded decision**: `starship.test.ts` asserts the format uses
  `$fill` and does not contain `right_format`. Do not "fix" it without updating
  that test and revisiting this ADR.