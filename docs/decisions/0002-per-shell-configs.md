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
  deterministic block under an `Added by ShellConfigurator` marker: the `export`
  and `starship init` lines, plus a `PATH` line first when a script install put
  `starship` somewhere the shell does not look. Shells that run Starship but were
  not selected get a `STARSHIP_CONFIG` unset guard from `resetSharedShellConfig`
  instead, which also removes a per-shell block an earlier run wrote, unless the
  user's own rc line sets `STARSHIP_CONFIG`.
- The shared path is backed up best-effort inside the single Config task, which
  runs after the Starship, font and shell installs and before the per-shell rc
  tasks, so `--restore` can offer a way back for the config that previously stood
  as the default.
- The installer has one Config task that writes every selected shell's file and
  one rc task per selected shell. The review screen shows the generated TOML
  once, under each chosen shell's config path, followed by each shell's rc
  block. (The adopt-mode "Config to keep" section — 0002A — is never reached
  from the wizard, which does not enter adopt mode.)

---

## 0002A — Adopt-existing-config mode

**Status**: Accepted

### Context

0002's "never clobber the shared file" rule is exactly what a brownfield user
wants the _opposite_ of: they already have a `~/.config/starship.toml` and want
it kept as the one prompt, with the wizard only installing fonts, Starship,
missing shells, and the shell wiring. #7 (adopt) and #24 (`--import-url`) are a
migration on-ramp that avoids forcing such users through a regeneration of their
hand-tuned config.

### Decision

`keepExistingConfig` is carried on `WizardState`. When set, `buildTaskList`
labels the Config task "Keep existing Starship config" and `runInstallTasks`
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
- `STARSHIP_CONFIG` is not exported for adopt-configured shells, so re-runs must
  recognise the adopt marker as a ShellConfigurator block. `--restore` only
  copies config backups back and never touches rc files.
- `--import-url` is folded into adopt mode rather than parsed back into
  `WizardState` (regenerating a shared file from a hand-written TOML would be a
  lossy round-trip).
