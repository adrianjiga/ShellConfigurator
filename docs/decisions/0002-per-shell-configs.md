# 0002 — Write one `starship.toml` per selected shell

**Status**: Accepted (amended by **0002A — adopt-existing-config**, below)

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

---

## 0002A — Adopt-existing-config mode

**Status**: Accepted

### Context

0002's "never clobber the shared file" rule is exactly what a brownfield user
wants the *opposite* of: they already have a `~/.config/starship.toml` and want
it kept as the one prompt, with the wizard only installing fonts, Starship,
missing shells, and the shell wiring. #7 (adopt) and #24 (`--import-url`) are a
migration on-ramp that avoids forcing such users through a regeneration of their
hand-tuned config.

### Decision

`keepExistingConfig` is carried on `WizardState`. When set, `buildTaskList`
takes the adopt branch:

- The Config task never runs `generateToml` or writes `starship/<shell>.toml`.
  If a config was fetched (`sharedConfigToml`, runtime-only), it is written to
  the shared path with `writeSharedConfig`, backing up anything already there;
  otherwise the existing file is left untouched and snapshotted via
  `backupSharedConfig`.
- The RC tasks run `applyShellConfig` with `pointAtSharedConfig: true`: they
  still add the `starship init` line, but no `STARSHIP_CONFIG` export, so every
  shell reads the shared file by Starship's default.
- Adopt blocks use a distinct marker (`Added by ShellConfigurator (shared
  config)`) so a later non-adopt run can recognise and drop them, and a
  non-adopt run's per-shell `export` is stripped when a shell flips to adopt.
  The two modes stay mutually exclusive in both directions.

The shared path is preferred over per-shell files because "point at the file the
user already owns" cannot be expressed as a generated TOML; we must consume the
existing file as-is.

### Consequences

- Per-shell divergence is traded away deliberately and only for adopt runs: the
  user chose it, and nothing is regenerated.
- `STARSHIP_CONFIG` is not exported for adopt-configured shells, so `--restore`
  and re-runs must recognise the adopt marker as a ShellConfigurator block.
- `--import-url` is folded into adopt mode rather than parsed back into
  `WizardState` (regenerating a shared file from a hand-written TOML would be a
  lossy round-trip).