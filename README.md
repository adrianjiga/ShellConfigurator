# ShellConfigurator

[![CI](https://github.com/adrianjiga/ShellConfigurator/actions/workflows/ci.yml/badge.svg)](https://github.com/adrianjiga/ShellConfigurator/actions/workflows/ci.yml)
[![Tests](https://github.com/adrianjiga/ShellConfigurator/actions/workflows/tests.yml/badge.svg)](https://github.com/adrianjiga/ShellConfigurator/actions/workflows/tests.yml)
[![npm](https://img.shields.io/npm/v/shell-configurator)](https://www.npmjs.com/package/shell-configurator)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

An interactive terminal wizard for configuring [Starship](https://starship.rs/), a cross-shell prompt. Inspired by `p10k configure`, it walks you through every choice and applies everything automatically.

## Features

- **Live preview**: see your prompt update in real time, rendered by your installed starship binary when available
- **Cross-shell**: configure zsh, bash, fish, nushell, and PowerShell in one run
- **Automated installation**: installs Starship, Nerd Fonts (downloads verified against their published SHA-256 digest, extraction sandboxed in a worker), and any missing shells for you
- **12 presets**: from minimal plain-text to Tokyo Night, Gruvbox Rainbow, and Catppuccin
- **14 colour palettes**: one behind every preset, plus high-contrast and colour-blind-safe options; any of them usable with any preset
- **Powerline prompts**: interlocking coloured blocks with Nerd Font separators
- **Segment picker**: search, multi-select, and reorder 31 modules across the left and right sides of your prompt
- **Style tuning**: palette, segment style, character symbol, wrapped-line marker, blank-line and vim-mode toggles, plus directory depth and substitutions
- **Headless mode**: the same logic is driven from a state card or flags via the `generate` and `apply` subcommands, for scripting and CI
- **Adopt-existing-config**: keep your current `~/.config/starship.toml` (or import one from a URL) and only install fonts, Starship, missing shells, and the shell wiring
- **Terminal font wiring**: detect your terminal (Alacritty, kitty, WezTerm, Ghostty, foot) and select the installed Nerd Font in its config automatically
- **Post-install verification**: after everything is applied, the written configs are loaded through the real `starship print-config` to catch a broken prompt before you restart
- **Doctor / repair**: a read-only day-2 health check (Starship, locale, shell wiring, config validity, font installed + selected, version drift, the shell you are running) and a mode that applies fixes and re-checks
- **Uninstall**: remove the rc lines and per-shell configs the wizard wrote (backed up first), and optionally the Nerd Font and Starship itself
- **Rollback**: every install, apply and uninstall keeps a copy of the files it changes, so `rollback` can put a whole run back, one run at a time
- **Debug info**: `debug-info` prints a Markdown report of the setup (detection, Starship, shells, PATH, doctor) to paste into a bug report, with your home directory shown as `~`

## Requirements

- Node.js 24+
- A package manager: `pacman`, `apt`, `dnf`, `apk`, or `brew` (falls back to the official Starship install script)

## Usage

Run it without installing:

```bash
npx shell-configurator
```

Or install it globally:

```bash
npm install -g shell-configurator
shell-configurator
```

### Command line options

```text
shell-configurator                            start the wizard
shell-configurator generate                   render a starship.toml from flags or a --state card (-o/--output <file>, --export <card>)
shell-configurator apply                      run a full install headlessly from flags (--shells required) or a --state card
shell-configurator apply --adopt --shells …   keep the existing shared config and wire shells to it
shell-configurator apply --import-url <url>   fetch a shared config (https gist/URL) and adopt it (implies --adopt; bounded: 10s timeout, 1 MB max)
shell-configurator doctor [--state <file>]    run the read-only day-2 health check (--json for machine-readable)
shell-configurator doctor --fix / repair      apply the fixes for failing checks, then re-run the checks (--dry-run to only list them)
shell-configurator repair --include-warnings  also apply the fixes warnings suggest (e.g. the terminal font)
shell-configurator uninstall                  remove the rc lines and per-shell configs it set up, after asking (--yes to skip the prompt)
shell-configurator uninstall --starship --font <id>  also remove Starship and that Nerd Font (--shells to limit, --dry-run to only list)
shell-configurator rollback                   put back the files the newest run changed, after asking (--yes, --dry-run, --json)
shell-configurator rollback --list            list the runs that changed files; --run <id> rolls back a specific one
shell-configurator debug-info > issue.md      write a report of the setup for a bug report (--json for the raw data)
shell-configurator --help                     show usage and exit
shell-configurator --version                  print the version and exit
shell-configurator --dry-run                  preview the config without installing (also -d, --no-install)
shell-configurator --restore                  restore the shared and per-shell configs from their newest backup (also --undo)
```

`--state` also accepts the alias `--import`. Without `--state`, `doctor` and
`repair` check every installed shell and read each one's wiring (per-shell or
adopt mode) from its rc file.

`uninstall` removes every `# Added by ShellConfigurator` block from the bash,
zsh and fish rc files and moves the per-shell configs aside to `.bak-*`
backups, backing up each rc first; `rollback` puts those files back (when the
run could not be recorded, it prints the `cp` commands that do so instead), but
not a Starship or font it removed: reinstall those with `apply` or `repair`. Your own `starship init` line (or fish's `conf.d` init) stays,
with the PATH line it needs. Nushell and PowerShell were set up by hand, so it
names the file to clean instead. Starship is removed only with `--starship`,
and only once no shell would still start it: the script install's binary, or
the pacman, apk or Homebrew package when that package manager owns the binary.
A font goes only with `--font <id>`, its files listed from its cached archive;
the plan names any terminal still set to it. On a terminal it shows the plan
and asks first; elsewhere it needs `--yes`.

Flags may appear before or after the subcommand (e.g. `--dry-run apply --state card.json`);
when a flag is repeated, the last one wins.

### Adopt-existing config

Brownfield users already have a `~/.config/starship.toml` they want to keep.
Instead of generating per-shell configs that shadow it, run:

```bash
shell-configurator apply --adopt --shells zsh,bash,fish
```

The wizard's normal work is skipped in adopt mode: your `starship.toml` stays in
place and untouched, and every selected shell is wired straight to it (the rc
blocks get the `starship init` line with no `STARSHIP_CONFIG` export). Fonts,
Starship, and missing shells are still installed. `--shells` (or a `--state`
card that selects shells) is required.

To adopt a config shared elsewhere, such as a gist:

```bash
shell-configurator apply --import-url https://gist.github.com/user/abc123/raw/starship.toml --shells zsh
```

The fetched TOML is written to `~/.config/starship.toml` (backing up anything
already there) and the shells are wired to it. `--import-url` implies `--adopt`.
The URL must be https (a redirect to plain http is refused too), and an HTML page
is rejected, so point it at the raw file. Fetches are bounded: a hung connection
is aborted after 10 seconds, and a config over 1 MB is rejected rather than
downloaded.

Both flags only make sense with the `apply` subcommand: `generate` and the
interactive wizard reject them with a usage error, and `doctor`/`repair` warn
that they are ignored without `--state`.

### Via curl (requires Node.js 24+)

```bash
curl -fsSL https://raw.githubusercontent.com/adrianjiga/ShellConfigurator/master/scripts/install.sh | sh
```

This downloads the latest release to a per-user directory and symlinks the
binary into `~/.local/bin`; no root required. Safe to re-run for updates.

### From a clone

```bash
npm install
npm run dev
```

The wizard exits non-zero if any install step fails, so it can be used in a script.

Exit codes: `0` on success; `1` when an install step failed, `doctor` found a
failing check, `repair` left one failing, an `uninstall` step failed, a `rollback` could not put a file back, `-o`/`--export` could not be written,
an `--import-url` fetch failed, or a fatal error occurred; `2` for a usage error
(an unknown command or flag, a missing or invalid flag value, `--adopt`/`--import-url`
outside `apply`, `apply` with no shells selected, `uninstall` off a terminal without `--yes`, or a state card that cannot be
read, is not valid JSON, or has an unsupported version or invalid field). A typo
never starts the installer: anything the parser does not recognise aborts the
run.

### Headless mode, state cards and run data

`generate` and `apply` run the same pure logic as the wizard. `generate` prints
the TOML to stdout (`-o <file>` writes it to a file instead); `--export <file>`
writes the versioned state card, and without `-o` nothing is printed. A card
captures only your choices, so `apply --state /path/to/card.json` reproduces
the same prompt on any machine. Include `--shells` when generating, or `apply`
has no shells to configure:

```bash
shell-configurator generate --preset tokyo-night --palette gruvbox --shells zsh,fish -o starship.toml --export my-card.json
shell-configurator apply --state my-card.json
```

Every wizard install and real (non-dry-run) `apply` appends one record to
`history.jsonl` (under the XDG state dir) and snapshots the card it applied; a
real `uninstall` or `rollback` appends one too, without a card;
`generate`, `doctor`, `repair` and dry runs record nothing. Each of those runs
also copies the rc files, per-shell configs, shared config and terminal configs
it is about to change into `runs/<id>/` under the state dir, keeping only the
ones it changed; the newest 50 runs are kept. `rollback` puts a run's files back to that copy (or deletes the
ones the run created) and leaves alone any file that changed again since, so a
later edit is never overwritten; files come back byte for byte with their
permissions. Run it again to undo the run before (a run whose changes were only
partly undone stays next in line), or roll back a rollback to redo it. Fonts, the Starship binary and the login shell are
not part of a rollback. `--restore` copies
the newest `.bak-*` backups back over the shared config and the per-shell
configs, limited to the shells the last recorded run configured; it does not
touch rc files. Nerd Font archives are cached under the XDG cache dir, verified
against their pinned SHA-256 before offline reuse. The state-card schema, the
run ledger, the font cache, `--restore`, and the full headless flag surface are
documented in [docs/API-Interface-Design.md](docs/API-Interface-Design.md).

All releases, including changelogs and install tarballs, are published on
[GitHub Releases](https://github.com/adrianjiga/ShellConfigurator/releases).

### Wizard steps

| Step           | Description                                                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Welcome        | Detects your package manager, Starship install status, terminal, and whether it is in a container                      |
| Font check     | Checks whether you have a Nerd Font already                                                                            |
| Font pick      | Choose a Nerd Font to install (skipped if not needed)                                                                  |
| Preset         | Pick a starting preset                                                                                                 |
| Left segments  | Choose modules for the left side of your prompt                                                                        |
| Right segments | Choose modules for the right side                                                                                      |
| Style          | Palette, segment style, character symbol, wrapped-line marker, blank line, vim mode, directory depth and substitutions |
| Shell select   | Pick which shells to configure (shows install status per shell)                                                        |
| Review         | Preview the config to write, each shell's rc wiring, and the install plan                                              |
| Installing     | Runs all installs and writes config                                                                                    |
| Done           | Summary of everything that was applied                                                                                 |

## What gets installed / configured

- **Starship**: via `brew`, `pacman` or `apk`; on `apt` and `dnf` systems (which carry no starship package) or with no package manager, via the official install script into `~/.local/bin`
- **Nerd Font**: downloaded from the official nerd-fonts GitHub release, its SHA-256 checked against the digest published for that release, and extracted in an isolated worker before being installed to `~/Library/Fonts/` (macOS) or `~/.local/share/fonts/` (Linux)
- **Terminal font**: when a supported terminal is detected (Alacritty, kitty, WezTerm, Ghostty, foot), its config is edited to select the installed Nerd Font (WezTerm prints the exact line instead — its config is Lua)
- **Shells**: installed via your package manager if not already present
- **Per-shell Starship configs**: `~/.config/starship/<shell>.toml` for every selected shell, so each shell keeps its own prompt; normal per-shell setup leaves the shared `~/.config/starship.toml` untouched
- **Adopt mode**: `apply --adopt` (or `--import-url`) keeps the shared `~/.config/starship.toml` as the one prompt every shell reads; no per-shell files are written, and the rc blocks carry no `STARSHIP_CONFIG` export
- **Shell RC files**: each selected shell gets a `STARSHIP_CONFIG` export pointing at its own config plus the `starship init` line (appended idempotently); shells left unselected get an `unset` guard so a configured parent's prompt doesn't leak in
- **Nushell**: `nu` has no rc file, so its setup command pins `STARSHIP_CONFIG` at startup via a `vendor/autoload` `export-env` file instead
- **Verification**: after the rc steps, every config written this run is loaded through the real `starship print-config`, so a broken prompt is caught before you restart. Font and `chsh` tasks are skipped in a container, and also when `CODESPACES`, `REMOTE_CONTAINERS`, `DEVCONTAINER`, `CI` or `KUBERNETES_SERVICE_HOST` is set.

## Supported Nerd Fonts

JetBrains Mono, Fira Code, Hack, Cascadia Code, Meslo LG, Source Code Pro

## Supported Shells

| Shell      | RC file                                                                    |
| ---------- | -------------------------------------------------------------------------- |
| zsh        | `$ZDOTDIR/.zshrc` (default `~/.zshrc`)                                     |
| bash       | `~/.bashrc`                                                                |
| fish       | `$XDG_CONFIG_HOME/fish/config.fish` (default `~/.config/fish/config.fish`) |
| nushell    | manual (see note after install)                                            |
| PowerShell | manual (see note after install)                                            |

## Project structure

```
src/
  config/        # Module, preset, palette, colour, directory, prompt-symbol, status and shell definitions
  generators/    # TOML config builder and shell RC updater
  screens/       # One file per wizard step
  services/      # CLI (args.ts, headless.ts, state.ts), detection (detector.ts), installation (installer.ts, fontExtractor.ts, terminalFont.ts), orchestration (installTasks.ts), health (doctor.ts, repair.ts), run data (history.ts, cache.ts), preview, exec/tty, paths and errors
  components/    # WizardLayout, PromptPreview, NavHints, PickerRow, PlanSections, AppSelectInput, ErrorBoundary
  stepMachine.ts # Pure step navigation (getNextStep / getPrevStep)
  types.ts       # Shared types, STEP_ORDER, default state
  app.tsx        # State owner + step router
  index.tsx      # Entry point
```

## Development

```bash
npm run dev           # Run with tsx (no build step)
npm run build         # Compile to dist/
npm start             # Run compiled output
npm run typecheck     # Type-check including tests
npm test              # Run unit tests (vitest)
npm run test:coverage # Unit tests + coverage report (v8)
npm run lint          # Biome (lint)
npm run format:check  # Biome format check
npm run format        # Biome format write
```

## Troubleshooting

See [docs/troubleshooting.md](docs/troubleshooting.md) for common issues and
fixes (font not rendering, `chsh` failures, missing PATH entries, prompt
leaks, and more).

## Contributing

Bugs and feature requests go on the [Issues
tab](https://github.com/adrianjiga/ShellConfigurator/issues). For development
setup, conventions, and how to get changes merged, see
[CONTRIBUTING.md](CONTRIBUTING.md).
