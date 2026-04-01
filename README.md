# ShellConfigurator

An interactive terminal wizard for configuring [Starship](https://starship.rs/) — a cross-shell prompt. Inspired by `p10k configure`, it walks you through every choice and applies everything automatically.

## Features

- **Live preview** — see your prompt update in real time as you make choices
- **Cross-shell** — configure zsh, bash, fish, nushell, and PowerShell in one run
- **Automated installation** — installs Starship, Nerd Fonts, and any missing shells for you
- **12 presets** — from minimal plain-text to Powerline and Tokyo Night themes
- **Segment picker** — choose exactly which modules appear on the left and right of your prompt
- **Style tuning** — color scheme and character symbol selection

## Requirements

- Node.js 18+
- A package manager: `pacman`, `apt`, `dnf`, or `brew` (falls back to the official Starship install script)

## Usage

```bash
npm install
npm run dev
```

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
| Installing     | Runs all installs and writes config                             |
| Done           | Summary of everything that was applied                          |

## What gets installed / configured

- **Starship** — via your package manager, or `curl` if none is detected
- **Nerd Font** — downloaded from the official nerd-fonts GitHub release, installed to `~/Library/Fonts/` (macOS) or `~/.local/share/fonts/` (Linux)
- **Shells** — installed via your package manager if not already present
- **`~/.config/starship.toml`** — generated from your wizard choices
- **Shell RC files** — `starship init` line appended idempotently to each selected shell's config

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
  services/      # System detection (detector.ts) and installation (installer.ts)
  components/    # WizardLayout, PromptPreview, NavHints
  types.ts       # Shared types and default state
  app.tsx        # Router / step machine
  index.tsx      # Entry point
```

## Development

```bash
npm run dev       # Run with tsx (no build step)
npm run build     # Compile to dist/
npm start         # Run compiled output
npx tsc --noEmit  # Type-check without building
```
