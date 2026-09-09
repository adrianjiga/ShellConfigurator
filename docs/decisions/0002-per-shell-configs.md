# 0002 — Write one `starship.toml` per selected shell

**Status**: Accepted

## Context

A user can select several shells in one run. The same generated `WizardState`
could be written to a single shared `~/.config/starship.toml`, which is what
Starship reads by default and what a user may already have.

Writing one shared file is simpler but has problems:

- Overwriting an existing `~/.config/starship.toml` destroys a config the wizard
  did not create, without the user's consultation.
- A shared file cannot diverge later — every shell inherits the same prompt with
  no way to tweak one shell.
- The rc files must be told where the config lives either way, so the indirection
  exists regardless.

## Decision

The wizard generates one file per selected shell under
`~/.config/starship/<shell>.toml` and adds the matching `export STARSHIP_CONFIG`
plus `starship init` line to that shell's rc file.

## Consequences

- A user's existing default config is never clobbered; the wizard's per-shell
  files sit alongside it and are activated by `STARSHIP_CONFIG` per shell.
- The rc edit must come with the `export` line, so `applyShellConfig` writes a
  deterministic two-line block (guarded by `Added by ShellConfigurator` markers)
  and `resetSharedShellConfig` can remove it.
- Before installation, the shared path is backed up best-effort so `--restore`
  can offer a way back for the config that previously stood as the default.
- The installer's config task list one per selected shell, and the review screen
  shows the per-shell TOML for each chosen shell.