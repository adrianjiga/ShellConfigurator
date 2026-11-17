# 0006 — One way back, fewer commands

**Status**: Accepted (amends the `--restore` notes in **0002** and **0002A**)

## Context

The tool grew two ways to undo a change and several subcommands that each did
one small job:

- Every config, rc and terminal-config write left a `<file>.bak-<stamp>` copy
  next to the file, `uninstall` renamed per-shell configs to `.bak-*`, and
  `--restore` (plus `r` on the Done screen) copied the newest ones back. Since
  `rollback` arrived, every install, `apply`, repair, `uninstall` and `rollback`
  captures the files it changes and can put a whole run back, rc files
  included. The `.bak-*` files duplicated that, piled up beside the user's own
  files, and `--restore` only half-undid a run (it left the rc files alone).
- `repair` was the same command as `doctor --fix`.
- `share` rendered the generated prompt as Markdown, which is another output of
  `generate`.
- `timings` measured the prompt's speed, which is a health question `doctor`
  answers.
- `--list-presets`, `--list-modules` and `--list-fonts` were three flags for
  one listing.

Each one had its own help text, completions, flag checks, tests and docs, and
the README spent most of its length explaining them rather than the problem the
tool solves.

## Decision

Keep the surface small, for simplicity and focus:

- `rollback` is the only undo command. `--restore` and the Done screen's
  restore key are retired, with a message that points at `rollback`.
- No `.bak-*` files are written, and `uninstall` deletes a per-shell config
  instead of renaming it. In their place each user file (rc files, the Bash
  login file, the shared `starship.toml`, terminal configs) gets one
  `<file>.pre-shell-configurator` copy the first time the tool changes it,
  never overwritten. A file that already holds a ShellConfigurator block is
  not an original and gets no copy; generated per-shell configs never get one.
- `repair` is retired in favour of `doctor --fix`.
- `share` becomes `generate --markdown`.
- `timings` becomes `doctor --timings` (with `--config` to time another file).
- The `--list-*` flags become `list <presets|modules|fonts>`.

A retired command or flag stays a usage error that names its replacement, so a
script written for an older version fails clearly instead of doing something
else.

## Consequences

- Capture stays best-effort: a run whose capture fails still runs, but it
  cannot be rolled back. The report says so and names the
  `.pre-shell-configurator` copies, which also outlive a pruned run (only the
  newest 50 are kept) or a deleted state folder.
- Users' config folders no longer collect a `.bak-*` file per run. Old ones
  left by earlier versions are not touched.
- Six top-level commands remain (`generate`, `apply`, `doctor`, `uninstall`,
  `rollback`, `list`), plus `debug-info` and `completions`.
