# ShellConfigurator

[![CI](https://github.com/adrianjiga/ShellConfigurator/actions/workflows/ci.yml/badge.svg)](https://github.com/adrianjiga/ShellConfigurator/actions/workflows/ci.yml)
[![Tests](https://github.com/adrianjiga/ShellConfigurator/actions/workflows/tests.yml/badge.svg)](https://github.com/adrianjiga/ShellConfigurator/actions/workflows/tests.yml)
[![npm](https://img.shields.io/npm/v/shell-configurator)](https://www.npmjs.com/package/shell-configurator)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A good-looking shell prompt in one command, and one command to take it back.

```bash
npx shell-configurator
```

## The problem

[Starship](https://starship.rs/) is a fast prompt that works in every shell, but
getting it set up is a chore:

- you install Starship, then find, download and install a Nerd Font, then point
  your terminal at it;
- you write a `starship.toml` by hand from the docs, guessing what it will look
  like;
- you add the right init lines to `~/.zshrc`, `~/.bashrc` and
  `config.fish`, without breaking what is already there;
- and when something goes wrong, you are left working out what changed.

ShellConfigurator does all of it in one terminal wizard, shows you the prompt
as you build it, and keeps every run undoable.

## What it does

1. **Checks your machine**: package manager, Starship, installed shells, your
   terminal, and whether you already have a Nerd Font.
2. **Lets you design the prompt**: start from one of 12 presets, pick and order
   modules, and choose colours and style, with a live preview drawn by
   Starship itself.
3. **Shows the plan before it runs**: the config it will write, the exact lines
   each rc file gets, and every install step.
4. **Applies it**: installs Starship, the font and any missing shell, sets the
   font in your terminal, writes one config per shell, wires each shell to it,
   then loads the result through Starship to catch a broken prompt before you
   restart.

Each shell gets its own config (`~/.config/starship/<shell>.toml`), so your
existing `~/.config/starship.toml` is never overwritten. If you would rather
keep it, `apply --adopt` wires your shells to it instead.

## Undo anything

Every run that changes files keeps a copy of them, so you can put them back:

```bash
shell-configurator rollback          # undo the last run, rc lines included
shell-configurator rollback --list   # see every run that can be undone
shell-configurator uninstall         # remove the setup (asks first)
```

On top of that, the first time ShellConfigurator changes one of your own files
(an rc file, your terminal config), it keeps the original beside it as
`<file>.pre-shell-configurator`, and never overwrites that copy. After a
run, `~/.config/starship/WHAT-CHANGED.md` lists every file it changed.

## Commands

| Command                                  | What it does                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| `shell-configurator`                     | Start the wizard (`--dry-run` to change nothing)                         |
| `shell-configurator generate`            | Print a `starship.toml` from flags; `--markdown` to share the prompt     |
| `shell-configurator apply`               | Install headlessly from flags or a saved card (`--dry-run` shows a diff) |
| `shell-configurator doctor`              | Check the setup; `--fix` repairs it, `--timings` finds slow modules      |
| `shell-configurator rollback`            | Undo the last run (or `--run <id>`)                                      |
| `shell-configurator uninstall`           | Remove the setup; `--starship` and `--font <id>` remove those too        |
| `shell-configurator list <kind>`         | List the `presets`, `modules` or `fonts` the flags accept (`--json`)     |
| `shell-configurator debug-info`          | Print a report to attach to a bug report, with your home shown as `~`    |
| `shell-configurator completions <shell>` | Print a completion script for bash, zsh or fish                          |

Run `shell-configurator --help` for every flag.

### Same prompt on another machine

The wizard's choices fit in a small state card. Save it once, apply it anywhere,
including in CI or a dotfiles script:

```bash
shell-configurator generate --preset tokyo-night --shells zsh,fish --export my-prompt.json
shell-configurator apply --state my-prompt.json
```

## Install

Needs Node.js 24 or newer.

```bash
npx shell-configurator               # run without installing
npm install -g shell-configurator    # or install it
```

Or with the install script, which needs no root and puts the command in
`~/.local/bin`:

```bash
curl -fsSL https://raw.githubusercontent.com/adrianjiga/ShellConfigurator/master/scripts/install.sh | sh
```

## Supported

- **Shells**: zsh, bash and fish are set up for you; Nushell and PowerShell get
  the exact lines to add.
- **Package managers**: Homebrew, pacman, apt, dnf and apk, with Starship's
  official install script as the fallback. pacman never upgrades your system.
- **Terminals** whose font it sets: Alacritty, kitty, Ghostty and foot (WezTerm
  gets the line to add).
- **Nerd Fonts**: JetBrains Mono, Fira Code, Hack, Cascadia Code, Meslo LG and
  Source Code Pro, checked against their published SHA-256.
- **macOS and Linux**, including containers, SSH sessions and WSL, where it
  skips the font steps because the terminal lives elsewhere.

## Learn more

- [Troubleshooting](docs/troubleshooting.md): fonts not rendering, `chsh`
  failures, PATH problems and more.
- [CLI reference](docs/API-Interface-Design.md): every flag, the state card and
  the run history.
- [Architecture](docs/Architecture.md) and [design decisions](docs/decisions/).
- [Releases](https://github.com/adrianjiga/ShellConfigurator/releases).

## Contributing

Bugs and ideas go on the [issue tracker](https://github.com/adrianjiga/ShellConfigurator/issues).
For the development setup and how changes get merged, see
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
