# Troubleshooting

Common issues and how to fix them.

---

## Run the doctor first

Before guessing, run the read-only health check. It inspects the actual
machine — Starship on `PATH`, a UTF-8 locale, the `starship init` line and
`STARSHIP_CONFIG` export in each shell rc, that the configs load under the real
`starship print-config`, that a Nerd Font is installed and selected in your
detected terminal, whether the installed starship drifted from what your last
install recorded, and whether the shell you are currently running is one of the
configured ones:

```bash
shell-configurator doctor
```

`doctor --fix` (or `repair`) applies the fix each failing check carries and
re-runs the checks: it re-adds the init line, rewrites a per-shell config,
reinstalls Starship via the detected package manager, or reinstalls the font
(from cache when a verified copy is there, otherwise by downloading it). It
never touches anything that passed, and warnings are left alone unless you add
`--include-warnings`. Without `--state` it checks every installed shell, so the
fixes can reach all of them. `--json` prints the full report.

---

## Nerd Font characters show as boxes or question marks

ShellConfigurator installs Nerd Font files to your system, but **your terminal
also needs to be configured to use the font**. The font files alone don't change
anything — the terminal must select them.

When the wizard (or `apply`) detects a supported terminal — Alacritty, kitty,
WezTerm, Ghostty, or foot — it edits the terminal's config to select the
installed font automatically (`Set <terminal> font` task). WezTerm's Lua config
is never edited; the exact `config.font = wezterm.font(...)` line is printed for
you instead. This only runs on a real machine: it is skipped inside a
container and whenever a CI or dev-container variable such as `CI` or
`CODESPACES` is set.

If the boxes persist, `shell-configurator repair --state <card> --include-warnings`
(re)wires the terminal font. The terminal-font check is a warning, so plain
`doctor --fix` leaves it alone, and the fix only exists when the state card
names a font.

**macOS (iTerm2, Alacritty, Kitty, Ghostty, WezTerm, Terminal.app):**

Open your terminal's preferences and set the font to one of the installed Nerd
Fonts (e.g. "JetBrainsMono Nerd Font"). In iTerm2 this is under Preferences →
Profiles → Text → Font.

**Linux (most terminal emulators):**

Open your terminal's profile preferences and change the font to a Nerd Font
variant. The name in the font picker is usually the font name followed by
"Nerd Font" (e.g. "JetBrainsMono Nerd Font").

**If you're unsure which font was installed**, check `~/.local/share/fonts/`
(Linux) or `~/Library/Fonts/` (macOS) for files containing "Nerd".

---

## `chsh` fails with "not listed in /etc/shells" (Homebrew)

Homebrew installs shells to `/opt/homebrew/bin/` or `/usr/local/bin/`, but does
not register them in `/etc/shells`. The `chsh` command only accepts shells
listed there.

Fix it by appending the shell path:

```bash
echo "/opt/homebrew/bin/fish" | sudo tee -a /etc/shells
chsh -s /opt/homebrew/bin/fish
```

Replace `fish` with whichever shell you're switching to. After that,
ShellConfigurator can configure the shell's RC file normally.

---

## "starship: command not found" after curl install

The curl installer puts the `starship` binary in `~/.local/bin/`. If your
shell doesn't have that directory on `$PATH`, Starship won't be found.

**Quick fix — add to your shell's RC file:**

| Shell | RC file                      | Line to add                            |
| ----- | ---------------------------- | -------------------------------------- |
| bash  | `~/.bashrc`                  | `export PATH="$HOME/.local/bin:$PATH"` |
| zsh   | `~/.zshrc`                   | `export PATH="$HOME/.local/bin:$PATH"` |
| fish  | `~/.config/fish/config.fish` | `fish_add_path ~/.local/bin`           |

Open a new terminal window or run `source ~/.zshrc` (or the equivalent for
your shell) for the change to take effect.

ShellConfigurator handles this automatically when it detects a missing
`starship` binary, but if you installed Starship separately you may need to
add the path manually.

---

## Prompt leaks into unconfigured shells

If you configured Starship for one shell (e.g. zsh) but then opened a
different shell (e.g. bash), you may see the Starship prompt in the
unconfigured shell. This happens because the configured parent shell exports
`STARSHIP_CONFIG` to child processes.

ShellConfigurator normally adds an `unset STARSHIP_CONFIG` guard to detected
Starship-running shells you chose **not** to configure, so the parent's per-shell
config doesn't leak in. It preserves the shell's Starship init line so it can
continue using the shared config. Re-run the wizard to apply or repair this wiring.

If the problem persists after a clean run, open the shell's RC file and check
for a `STARSHIP_CONFIG` export that shouldn't be there. Remove only that export
(or `set -gx STARSHIP_CONFIG ...` for fish), keep the `starship init` line, and
add `unset STARSHIP_CONFIG` (or `set -e STARSHIP_CONFIG` for fish) manually.

---

## Nushell / PowerShell setup is "manual"

Nushell and PowerShell don't have traditional RC files that `eval` can
inject into. After the wizard completes, ShellConfigurator prints the exact
commands you need to run in those shells. Follow the instructions on the
**Done** screen.

For Nushell, the wizard prints a Bash-compatible command that invokes `nu` and
creates the two files Nushell auto-sources at startup
(`starship-config.nu` pinning `$env.STARSHIP_CONFIG`, and `starship.nu` with the
`starship init` output) in `$nu.data-dir/vendor/autoload` — by default
`~/.local/share/nushell/vendor/autoload/` on Linux and
`~/Library/Application Support/nushell/vendor/autoload/` on macOS. Run it from
Bash as shown, then verify the files exist:

```bash
ls ~/.local/share/nushell/vendor/autoload/
ls ~/Library/Application\ Support/nushell/vendor/autoload/   # macOS
```

---

## A shell install fails

When the wizard tries to install a shell (e.g. fish) and cannot, the
`Install <shell>` task fails and the run carries on; that shell's `Configure`
task (and `chsh`, if it was the default shell) fails with it. The task shows
one of:

- `Cannot auto-install <shell>: no package manager detected` or
  `No package for <shell> on <manager>` — install the shell yourself, then re-run
- `Command failed with exit code <n>: ...` — the package install itself failed
- `<binary> not found in PATH` — from `chsh`, when the shell is still missing

For a failed package install, check that:

1. Your system has internet access
2. You have `sudo` privileges (required for `apt`, `dnf`, `pacman`, and `apk`
   unless you run as root)
3. Your package manager is working — try running the install command manually

If you're on a minimal image (Alpine, Arch, Fedora Docker), the shell package
may not exist under that name. Run `apt-cache search <shell>` or equivalent
to find the correct package.

---

## Removing ShellConfigurator's changes

`shell-configurator uninstall --dry-run` lists what would go;
`shell-configurator uninstall` shows the same plan and asks before removing it.
It strips every `# Added by ShellConfigurator` block from the bash, zsh and fish
rc files (each rc is backed up to `<rc>.bak-<timestamp>` first) and moves the
per-shell configs in `~/.config/starship/` to `.bak-*` backups. Add `--starship`
to remove Starship too, and `--font <id>` to remove a Nerd Font it installed.

- **The prompt still shows after uninstall**: your rc has its own
  `starship init` line, which uninstall leaves alone. Remove it yourself.
- **Nushell or PowerShell still loads Starship**: they were set up by hand, so
  uninstall only names the file to clean (the Nushell autoload folder, or
  `$PROFILE`).
- **"pass --yes to go ahead"**: uninstall runs without a terminal to ask on
  (a script or CI). Add `--yes` once the `--dry-run` plan looks right.
- **"no cached … archive"**: the font was installed before the font cache
  existed, so its files cannot be told apart from your other fonts. Delete them
  from `~/.local/share/fonts` (`~/Library/Fonts` on macOS) yourself.
- **Starship "is not from a package manager here"**: the detected package
  manager does not own the binary on your PATH (e.g. a `cargo install`, or
  `/usr/local/bin` from a root script install). Remove it with whatever
  installed it.
- **Starship "kept: … would still start it"**: a shell still has a
  `starship init` line uninstall leaves alone (your own line, a shell outside
  `--shells`, fish's `conf.d/starship.fish`, or a Nushell/PowerShell setup).
  Remove those lines, or add the shells to `--shells`, and run it again.
- **A terminal "still selects" the font**: its config still names the Nerd
  Font uninstall removed. Pick another font in that terminal's settings.
- **A config was "left in place"**: its rc could not be cleaned (read-only, or
  a broken symlink), so the config it points at was kept. Fix the rc and run
  uninstall again.
- **Changed your mind**: the report ends with the `cp` commands that copy each
  backup back; run them to undo the uninstall.
