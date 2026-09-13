# ShellConfigurator

[![CI](https://github.com/adrianjiga/ShellConfigurator/actions/workflows/ci.yml/badge.svg)](https://github.com/adrianjiga/ShellConfigurator/actions/workflows/ci.yml)
[![Tests](https://github.com/adrianjiga/ShellConfigurator/actions/workflows/tests.yml/badge.svg)](https://github.com/adrianjiga/ShellConfigurator/actions/workflows/tests.yml)
[![npm](https://img.shields.io/npm/v/shell-configurator)](https://www.npmjs.com/package/shell-configurator)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

An interactive terminal wizard for configuring [Starship](https://starship.rs/), a cross-shell prompt. Inspired by `p10k configure`, it walks you through every choice and applies everything automatically.

## Features

- **Live preview**: see your prompt update in real time as you make choices
- **Cross-shell**: configure zsh, bash, fish, nushell, and PowerShell in one run
- **Automated installation**: installs Starship, Nerd Fonts (downloads verified against their published SHA-256 digest, extraction sandboxed in a worker), and any missing shells for you
- **12 presets**: from minimal plain-text to Tokyo Night, Gruvbox Rainbow, and Catppuccin
- **12 colour palettes**: one behind every preset, and any of them usable with any preset
- **Powerline prompts**: interlocking coloured blocks with Nerd Font separators
- **Segment picker**: choose exactly which modules appear on the left and right of your prompt
- **Style tuning**: palette, segment style, and character symbol selection
- **Headless mode**: the same logic is driven from a state card or flags via the `generate` and `apply` subcommands, for scripting and CI
- **Adopt-existing-config**: keep your current `~/.config/starship.toml` (or import one from a URL) and only install fonts, Starship, missing shells, and the shell wiring

## Requirements

- Node.js 22+
- A package manager: `pacman`, `apt`, `dnf`, or `brew` (falls back to the official Starship install script)

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
shell-configurator                start the wizard
shell-configurator generate       render a starship.toml from flags
shell-configurator apply          run a full install headlessly from a state card
shell-configurator apply --adopt  keep the existing shared config and wire shells to it
shell-configurator apply --import-url <url>   fetch a shared config (gist/URL) and adopt it (implies --adopt; bounded: 10s timeout, 1 MB max)
shell-configurator --help         show usage and exit
shell-configurator --version      print the version and exit
shell-configurator --dry-run      preview the config without installing (also -d, --no-install)
shell-configurator --restore      restore the shared and per-shell configs from their newest backup
```

Flags may appear before or after the subcommand (e.g. `--dry-run apply --state card.json`);
when a flag is repeated, the last one wins.

### Adopt-existing config

Brownfield users already have a `~/.config/starship.toml` they want to keep.
Instead of generating per-shell configs that shadow it, run:

```bash
shell-configurator apply --adopt [--shells zsh,bash,fish]
```

The wizard's normal work is skipped in adopt mode: your `starship.toml` stays in
place and untouched, and every selected shell is wired straight to it (the rc
blocks get the `starship init` line with no `STARSHIP_CONFIG` export). Fonts,
Starship, and missing shells are still installed.

To adopt a config shared elsewhere, such as a gist:

```bash
shell-configurator apply --import-url https://gist.github.com/user/abc123/raw/starship.toml
```

The fetched TOML is written to `~/.config/starship.toml` (backing up anything
already there) and the shells are wired to it. `--import-url` implies `--adopt`.
Fetches are bounded: a hung connection is aborted after 10 seconds, and a config
over 1 MB is rejected rather than downloaded.

Both flags only make sense with the `apply` subcommand, so they are rejected
elsewhere with a usage error.

### Via curl (requires Node.js 22+)

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

Exit codes: `0` on success, `1` when an install step failed or a fatal error
occurred, `2` for a usage error (an invalid flag value, `--adopt`/`--import-url`
outside `apply`, or an unreadable state card). An unknown or malformed flag (a
bogus `--name` or a value on a boolean flag) is dropped with a `warning:` on
stderr and does not abort the run.

### Headless mode, state cards and run data

`generate` and `apply` run the same pure logic as the wizard. `generate` prints
the TOML to stdout (`-o <file>` to capture it); add `--export <file>` to also
write the versioned state card. A card captures only your choices, so
`apply --state /path/to/card.json` reproduces the same prompt on any machine:

```bash
shell-configurator generate --preset tokyo-night --palette gruvbox -o starship.toml --export my-card.json
shell-configurator apply --state my-card.json
```

Every run appends one record to `history.jsonl` (under the XDG state dir) and
snapshots the card it applied, so `--restore` and rollback have something to
work from. Nerd Font archives are cached under the XDG cache dir, verified
against their pinned SHA-256 before offline reuse. The state-card schema, the
run ledger, the font cache, `--restore`, and the full headless flag surface are
documented in [docs/API-Interface-Design.md](docs/API-Interface-Design.md).

All releases, including changelogs and install tarballs, are published on
[GitHub Releases](https://github.com/adrianjiga/ShellConfigurator/releases).

### Wizard steps

| Step           | Description                                                     |
| -------------- | --------------------------------------------------------------- |
| Welcome        | Detects your package manager and Starship install status        |
| Font check     | Checks whether you have a Nerd Font already                     |
| Font pick      | Choose a Nerd Font to install (skipped if not needed)           |
| Preset         | Pick a starting preset                                          |
| Left segments  | Choose modules for the left side of your prompt                 |
| Right segments | Choose modules for the right side                               |
| Style          | Color scheme and character symbol                               |
| Shell select   | Pick which shells to configure (shows install status per shell) |
| Review         | Preview the config to write (or the shared config to keep in adopt mode) and the install plan |
| Installing     | Runs all installs and writes config                             |
| Done           | Summary of everything that was applied                          |

## What gets installed / configured

- **Starship**: via your package manager, or `curl` if none is detected
- **Nerd Font**: downloaded from the official nerd-fonts GitHub release, its SHA-256 checked against the digest published for that release, and extracted in an isolated worker before being installed to `~/Library/Fonts/` (macOS) or `~/.local/share/fonts/` (Linux)
- **Shells**: installed via your package manager if not already present
- **Per-shell Starship configs**: `~/.config/starship/<shell>.toml` for every selected shell, so each shell keeps its own prompt; the shared `~/.config/starship.toml` is never overwritten
- **Adopt mode**: `apply --adopt` (or `--import-url`) keeps the shared `~/.config/starship.toml` as the one prompt every shell reads; no per-shell files are written, and the rc blocks carry no `STARSHIP_CONFIG` export
- **Shell RC files**: each selected shell gets a `STARSHIP_CONFIG` export pointing at its own config plus the `starship init` line (appended idempotently); shells left unselected get an `unset` guard so a configured parent's prompt doesn't leak in
- **Nushell**: `nu` has no rc file, so its setup command pins `STARSHIP_CONFIG` at startup via a `vendor/autoload` `export-env` file instead

## Supported Nerd Fonts

JetBrains Mono, Fira Code, Hack, Cascadia Code, Meslo LG, Source Code Pro

## Supported Shells

| Shell      | RC file                         |
| ---------- | ------------------------------- |
| zsh        | `~/.zshrc`                      |
| bash       | `~/.bashrc`                     |
| fish       | `~/.config/fish/config.fish`    |
| nushell    | manual (see note after install) |
| PowerShell | manual (see note after install) |

## Project structure

```
src/
  config/        # Module, preset, and shell definitions
  generators/    # TOML config builder and shell RC updater
  screens/       # One file per wizard step
  services/      # Detection (detector.ts), installation (installer.ts, fontExtractor.ts), task orchestration (installTasks.ts)
  components/    # WizardLayout, PromptPreview, NavHints
  stepMachine.ts # Pure step navigation (getNextStep / getPrevStep)
  types.ts       # Shared types, STEP_ORDER, default state
  app.tsx        # State owner + step router
  index.tsx      # Entry point
```

## Development

```bash
npm run dev       # Run with tsx (no build step)
npm run build     # Compile to dist/
npm start         # Run compiled output
npm run typecheck   # Type-check including tests
npm test          # Run unit tests (vitest)
npm run test:coverage  # Unit tests + coverage report (v8)
npm run lint      # Biome (lint)
npm run format:check   # Biome format check
npm run format    # Biome format write
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
