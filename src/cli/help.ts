import { VERSION } from './version.ts';

export function printHelp(): void {
  process.stdout.write(`shell-configurator ${VERSION}
Interactive terminal wizard for configuring Starship.

Usage:
  shell-configurator              start the wizard
  shell-configurator generate     render a starship.toml from flags (--markdown to share it)
  shell-configurator apply        run a full install headlessly
  shell-configurator doctor       check the setup; --fix repairs it, --timings times the prompt
  shell-configurator uninstall    remove what the wizard set up
  shell-configurator rollback     put back the files the last run changed
  shell-configurator debug-info   print a report of the setup to attach to a bug report
  shell-configurator list <presets|modules|fonts>  list the ids the flags accept (--json for data)
  shell-configurator completions <bash|zsh|fish>   print a shell completion script
  shell-configurator --help       show this help
  shell-configurator --version    print the version
  shell-configurator --dry-run    preview changes without installing

Options:
  -h, --help          Show this help and exit
  -v, --version       Print the version and exit
  -d, --dry-run       Install nothing; print what would happen (generate still
                     writes -o/--export files)
  --no-install        Alias for --dry-run

  Flags may appear before or after the subcommand (e.g. "--dry-run generate"
  works like "generate --dry-run"); when a flag is repeated the last one wins.

generate options (the config — a versioned state card with --export):
  --preset <id>        Seed modules, palette and powerline from a preset
  --palette <id>       Override the colour palette
  --powerline, --no-powerline   Draw segments as interlocking coloured blocks
  --shells <id,...>    Shells to configure: zsh,bash,fish,nushell,powershell
  --font <none|font>   Nerd Font to install, or 'none' to skip fonts
  --has-nerd-font, --no-nerd-font   Already render Nerd Font glyphs (auto toggles with --font)
  --character <arrow|lambda|dollar> The prompt character symbol
  --set-default <shell>  Make a shell the login default
  --skip-starship      Do not install or require Starship
  -o, --output <file>  Write the TOML here instead of stdout
  --export <file>      Write the state card here (add -o to keep the TOML too)
  --import, --state <file>  Start from a saved state card instead of flags
  --markdown           Print the prompt as Markdown to share, with the card that
                       rebuilds it (-o writes it to a file). The card has no shells
                       or font install of this machine; whoever uses it adds
                       --shells (and --font) to apply.

apply options (a headless install from a state card):
  --state <file>       The state card describing the install (also: --import)
  --dry-run            Print the plan, the generated config and a diff of each
                       file it would change; change nothing
  --adopt              Keep the existing shared starship.toml instead of
                       regenerating it (per-shell files are never written)
  --import-url <url>   Fetch a starship.toml over the web and adopt it (implies --adopt)
  --json               With --dry-run, print the plan, config and diffs as JSON
  Without --state, apply also takes the generate options above except -o and
  --export; --shells is then required.

doctor options (checks the setup; exits non-zero when a check fails):
  --state <file>       Check the setup described by a saved state card
  --json               Print the report as JSON instead of the text summary
  --fix                Apply the fixes for failing checks after asking, then re-check;
                       exits non-zero when one still fails
  --include-warnings   With --fix, also apply the fixes warnings suggest (e.g. the
                       terminal font); a warning may describe a choice you made on purpose
  -y, --yes            With --fix, go ahead without asking (required off a terminal)
  --dry-run            With --fix, print the fixes it would apply; change nothing
  --timings            Also time each prompt module in the current folder and suggest
                       fixes for slow ones: the config Starship loads here
                       ($STARSHIP_CONFIG, else ~/.config/starship.toml, else its
                       built-in default). Modules run in parallel, so the prompt is
                       about as slow as its slowest one.
  --config <file>      With --timings, time this starship.toml instead
  Without --state it checks the shells that were set up, not every installed one.
  rollback puts back the files --fix changed (not a reinstalled Starship or font).

uninstall options (removes the Starship setup; asks before changing anything):
  --shells <id,...>    Only these shells (default: every shell it set up)
  --starship           Also remove Starship itself
  --font <font>        Also remove this Nerd Font
  -y, --yes            Go ahead without asking (required off a terminal)
  --dry-run            Print what it would remove; change nothing
  --json               Print the report as JSON instead of the text summary
  rollback puts the files back (not a removed Starship or font). Starship stays
  while any shell would still start it.

rollback options (undoes the newest run that changed files; asks first):
  --list               Show the runs that changed files, newest first
  --run <id>           Undo this run instead (an id from --list)
  -y, --yes            Go ahead without asking (required off a terminal)
  --dry-run            Print what it would put back; change nothing
  --json               Print the report (or the --list runs) as JSON
  A file changed again since that run is left alone. Rolling back again undoes
  the run before; rolling back a rollback redoes the run.

debug-info options (reads only; e.g. shell-configurator debug-info > issue.md):
  --json               Print the report data as JSON instead of Markdown
  Your home directory is shown as ~ so the report does not name you.

completions (install the script where your shell loads completions from):
  bash   shell-configurator completions bash > ~/.local/share/bash-completion/completions/shell-configurator
  zsh    shell-configurator completions zsh > "\${fpath[1]}/_shell-configurator"
  fish   shell-configurator completions fish > ~/.config/fish/completions/shell-configurator.fish
`);
}
