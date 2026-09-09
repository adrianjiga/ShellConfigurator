# Troubleshooting

Common issues and how to fix them.

---

## Nerd Font characters show as boxes or question marks

ShellConfigurator installs Nerd Font files to your system, but **your terminal
also needs to be configured to use the font**. The font files alone don't change
anything — the terminal must select them.

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

| Shell  | RC file                        | Line to add                              |
| ------ | ------------------------------ | ---------------------------------------- |
| bash   | `~/.bashrc`                    | `export PATH="$HOME/.local/bin:$PATH"`   |
| zsh    | `~/.zshrc`                     | `export PATH="$HOME/.local/bin:$PATH"`   |
| fish   | `~/.config/fish/config.fish`   | `fish_add_path ~/.local/bin`             |

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

ShellConfigurator normally adds an `unset STARSHIP_CONFIG` guard to shells
you chose **not** to configure, so the parent's prompt doesn't leak in. If
you skipped a shell during the wizard, re-run it and select that shell to
apply the guard.

If the problem persists after a clean run, open the shell's RC file and check
for a `STARSHIP_CONFIG` export that shouldn't be there. Remove any
`# Added by ShellConfigurator` block and add `unset STARSHIP_CONFIG` (or
`set -e STARSHIP_CONFIG` for fish) manually.

---

## Nushell / PowerShell setup is "manual"

Nushell and PowerShell don't have traditional RC files that `eval` can
inject into. After the wizard completes, ShellConfigurator prints the exact
commands you need to run in those shells. Follow the instructions on the
**Done** screen.

For Nushell, the wizard creates an `export-env` file in
`~/.local/share/nushell/vendor/autoload.d/`. Verify it exists:

```nu
ls ~/.local/share/nushell/vendor/autoload.d/
```

---

## Wizard exits with "shell not found"

This means the wizard tried to install a shell (e.g. fish) and the package
install failed. Check that:

1. Your system has internet access
2. You have `sudo` privileges (required for `apt`, `dnf`, and `pacman`)
3. Your package manager is working — try running the install command manually

If you're on a minimal image (Alpine, Arch, Fedora Docker), the shell package
may not exist under that name. Run `apt-cache search <shell>` or equivalent
to find the correct package.
