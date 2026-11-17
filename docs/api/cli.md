# Headless CLI and run data

The public flag surface in `src/cli/`/`src/services/args.ts`, in eleven groups.

## Interactive

```
shell-configurator              start the wizard
shell-configurator --dry-run    preview changes without installing (alias --no-install, -d)
```

## lifecycle

```
--version / -v        Print the version
--help / -h           Print usage
```

## generate (a config from flags)

```
shell-configurator generate --preset <id> [flags]
  --palette <id>           override the colour palette
  --powerline/--no-powerline
  --shells <id,...>        zsh,bash,fish,nushell,powershell
  --font <none|id>         Nerd Font to install, or 'none'
  --has-nerd-font/--no-nerd-font
  --character <arrow|lambda|dollar>
  --set-default <shell>    chsh target
  --skip-starship          config-only run
  -o, --output <file>      write the TOML instead of stdout
  --export <file>          write the state card (add -o to keep the TOML too)
  --import, --state <file> start from a state card instead of flags
  --markdown               print the prompt as Markdown to share (see below)
```

## apply (an install from a state card)

```
shell-configurator apply [--state <file>] [generate flags] [--dry-run [--json]] [--adopt] [--import-url <url>]
  --state       the state card to install (also: --import); without it, apply
                takes the generate flags above except -o and --export, and --shells is required
  --adopt       keep the shared ~/.config/starship.toml (never writes per-shell files)
  --import-url  fetch a starship.toml and adopt it (implies --adopt; the fetch is
                bounded — a 10s timeout and a 1 MB cap reject a hung or oversized
                response. Every redirect hop must be https too, and may not carry a user name or password. Every line that may set a command
                Starship runs on every prompt (`command`, `when` or `shell` in any form,
                and `custom` tables) is printed to stderr before anything happens. A non-https URL, or one with a user name or password, is a usage error; an HTTP error, an
                empty or HTML body is a run error)
  --json        with --dry-run, print { dryRun, shells, installStarship, tasks,
                config, changes } instead of text; config is { kind: 'per-shell', toml,
                tomlIfFontFails? } (the glyph-free config written when a planned font
                install fails),
                { kind: 'imported', path, toml } or { kind: 'kept', path, exists }.
                installStarship is false when Starship is already installed.
                A real apply with --json is a usage error, and a dry run with
                no shells is one too, as the real run is
```

When the run installs a Nerd Font and the config would differ without it, the
text dry run and the Review screen add `If the Nerd Font install fails, the config
is written without Nerd Font glyphs instead.` (`configIfFontFails` in
`installTasks.ts`).

A dry run also diffs the config and rc files the run would write against what is
on disk (`plannedFileChanges` in `services/fileDiff.ts`), using the same planners
as the real writers. The text output ends with `Changes to config and rc files on
disk:` and a `git diff`-style unified diff per file (a last line without a newline
is marked `\ No newline at end of file`, as git does); a config the run creates is
not repeated there, only pointed at (`create <path>: the config shown above`).
Then a line notes that a real run also keeps each file's content from before
ShellConfigurator first changed it as `<file>.pre-shell-configurator`, and
writes WHAT-CHANGED.md. With nothing to change it says `No config or rc file on
disk would change.` In `--json`, `changes` is a list of `{ path, status: 'create'
| 'modify', added, removed, diff }`, or `{ path, status: 'unreadable', error }`
for a file it cannot read; files that would stay as they are are left out.
`.pre-shell-configurator` copies, WHAT-CHANGED.md, fonts, the Starship binary
and terminal configs are not part of it.

A real apply writes `~/.config/starship/WHAT-CHANGED.md` and ends with
`What changed, and how to undo it: <path>`; the wizard's Done screen shows the
same line.

## list

```
shell-configurator list <presets|modules|fonts> [--json]
```

Prints the ids `--preset`, the module lists and `--font` accept, as aligned
`id  label — description` lines, or as JSON. Like `completions`, it takes a
positional argument; a missing or unknown kind, or any flag but `--json`, is a
usage error.

## doctor (day-2 health)

```
shell-configurator doctor [--state <file>] [--json] [--fix [--include-warnings] [--yes] [--dry-run]]
shell-configurator doctor [--state <file>] [--json] --timings [--config <file>]
```

`doctor` is read-only and never installs. It checks Starship on `PATH`, a
UTF-8 locale, the `starship init` line and `STARSHIP_CONFIG` export in each
shell rc (or the shared config in adopt mode), that the configs load under the
real `starship print-config`, that a Nerd Font is installed, and that it is
selected in the detected terminal (`src/services/doctor.ts`, checks in
`src/services/doctor/`). With `--state`
it checks the card's shells and wiring mode (`keepExistingConfig`); without
one it checks the installed shells that were set up — the last recorded run
chose them, or they start Starship or carry a ShellConfigurator block — and
reads each one's mode (per-shell or shared) from its rc. With none set up it
warns instead. On macOS, Bash fails when its login file does not load
`~/.bashrc`. The locale, terminal-font and (without a card)
font-installed checks only ever warn; a font the card asked for that is missing
fails. Two further checks are also `warn`-only and read the runtime: **version drift** — the installed
starship binary no longer matches the version the last install/apply recorded,
which means a package-manager upgrade happened outside the tool — and the
**current shell** — the shell this terminal is _running_ is not one of the
configured ones, so the new prompt won't show until the user starts it. Each
finding is `pass`/`warn`/`fail`; any `fail` sets exit code `1`. `--json` prints
the report object.

`doctor --fix` applies the fix each failing finding carries —
re-add the init line, reinstall Starship via the detected package manager,
rewrite a missing per-shell config from the `--state` card, reinstall the font
the card names (from the verified cache, else downloaded) — then re-runs the
doctor and reports the _result_. Warnings are left alone unless
`--include-warnings` is passed; that also applies the fixes warnings carry, such
as rewiring the terminal font or adding a missing `STARSHIP_CONFIG` export. The
font fixes exist only when a `--state` card names a font. `--dry-run` lists the
planned fixes without applying them. Otherwise, with fixes to apply, it shows
them and asks on a terminal, like `uninstall`; off a terminal, or with
`--json`, it needs `--yes`. The fixes run inside `captureRun`, so `rollback`
puts back the files they changed, and the run is recorded in history as
`repair`. A check that still fails keeps the exit code non-zero.

`doctor --timings` runs the same check, then times each module of a config in
the current folder with `starship timings` and appends them, slowest first,
with how long the prompt waits for its slowest module and suggestions with the
TOML to add (`timePrompt` in `src/services/starshipProbe.ts`). It times the
config the current Starship loads here, by Starship's own rule
(`activeStarshipConfig`: `$STARSHIP_CONFIG` when set, else the shared
`starship.toml`; Starship's built-in default prompt, labelled with the reason,
when that file is missing), or the file `--config` names (an unreadable one is a
usage error). With `--json` the doctor report gains a `timings` field: `{ config,
path, slowestMs, slow, modules: [{ module, ms, output }], suggestions: [{ module?,
text, toml? }] }`. It changes no config (Starship still writes its own cache and
logs as it does for every prompt). Without Starship, or when Starship takes
longer than 30s (a very slow module, usually git_status), the report says
`Could not time the prompt: …` (in `--json`, `timings: { error }`) and the exit
code is `1`. `--timings` with `--fix` is a usage error, as is `--config` without
`--timings`, and `--state` or a look flag (`--preset`, …) with `--timings`, since
it times the config on disk rather than the one they describe.

Flags may appear before or after the subcommand; when a flag is repeated, the
last one wins. Unknown or malformed flags (a bogus `--name`, an unparseable
value on a boolean flag, a missing value, a stray positional) throw a
`CliUsageError`, so a typo can never start the real installer. So does a known
flag the subcommand would ignore (its flags are those `SUBCOMMAND_INFO` lists),
such as `apply -o`, `generate --json` or `doctor --dry-run` without `--fix`.
Config flags passed to `doctor` without `--state` are ignored with a stderr
warning. Retired commands and flags (`repair`, `share`, `timings`, `--restore`,
`--undo`, `--list-presets`/`--list-modules`/`--list-fonts`) are usage errors
that name the replacement (`RETIRED_SUBCOMMANDS`/`RETIRED_FLAGS` in
`src/services/args.ts`). The flags each command accepts come from
`SUBCOMMAND_INFO`.

## uninstall

```
shell-configurator uninstall [--shells <id,...>] [--starship] [--font <id>] [--yes] [--dry-run] [--json]
```

Removes what the wizard set up, in reverse install order (`src/services/uninstall.ts`).
For each shell (by default every shell with a ShellConfigurator rc block or a
per-shell config) it strips every `# Added by ShellConfigurator` block from the
rc and deletes `~/.config/starship/<shell>.toml`. Nushell and PowerShell were set up by hand, so their step only names
the file to clean. `--font <id>` deletes that Nerd Font's files, listed from its
cached archive, and names any terminal still set to it. `--starship` deletes
the binary its own script install put in `~/.local/bin` (recorded by its SHA-256, so another one there is left alone), or removes the pacman/apk/Homebrew package when
that package manager owns the binary, and forgets the recorded version; it is
held back while any shell would still start Starship. A shell's config stays
when its rc could not be cleaned. A real run is captured like any other, so
the text report ends with `Undo it with: shell-configurator rollback` (or, when
the capture could not be written, that rollback cannot undo it, that the
per-shell configs were left in place for that reason, and where
`<file>.pre-shell-configurator` copies hold a file's content from before
ShellConfigurator first changed it). Rollback only puts files back, so when
Starship or a font was removed the report adds that they need reinstalling with
`apply` or `doctor --fix`. The Starship
step re-checks just before it deletes anything that no shell still starts it.
Without
`--yes` it prints the plan and asks on a terminal; off a terminal, or with
`--json`, a run that would change something is a `CliUsageError`. `--dry-run`
only prints the plan. A failed step does not stop the rest and sets exit code
`1`. Config flags other than `--shells` and `--font`, and `--state`, are usage
errors, as are `--starship` outside `uninstall` and `--yes` outside
`doctor --fix`, `uninstall` and `rollback`.

## rollback

```
shell-configurator rollback [--run <id>] [--yes] [--dry-run] [--json]
shell-configurator rollback --list [--json]
```

Puts back the files a captured run changed (`src/services/rollback.ts`): by
default the newest install, apply or uninstall that still stands, otherwise the
run `--run` names (an id from `--list`). Each file goes back to its copy from
before that run, or is deleted when that run created it. A file that changed
again since is skipped (checked again right before it is changed, so an edit
made at the prompt survives), so a rollback never overwrites a later edit: roll
back the later run first. Restores keep the exact bytes and the file's mode. A
rollback that left some changes in place is recorded `partial: true`, and that
run stays next to roll back; files already restored then report "already as it
was before that run". The rollback is captured and recorded (`kind: 'rollback'`,
`rollbackOf`), so a second `rollback` undoes the run before, and
`rollback --run <rollback id>` redoes the run it undid. It asks like
`uninstall` (`--yes` off a terminal or with `--json`). A file it could not put
back sets exit code `1`. Config flags, `--state` and `--fix` are usage errors,
as are `--list` and `--run` outside `rollback`.

## debug-info

```
shell-configurator debug-info [--json]
```

Prints a Markdown report of the setup for a bug report
(`src/services/debugInfo.ts`): versions, detection, Starship, a table of the
shells, the PATH entries and the full doctor report, plus the last recorded run.
`--json` prints the same data as JSON. The home directory is shown as `~` in
both, and URL credentials, queries and fragments are dropped from the recorded
command. It reads only, so a failing doctor check does not change its exit
code. Config flags, `--state`, `--fix` and `--dry-run` are usage errors.

## completions

```
shell-configurator completions <bash|zsh|fish>
```

Prints a completion script for the shell (`src/services/completions.ts`). It
and `list` are the only subcommands that take a positional argument
(`CliFlags.argument`). A missing or unknown
shell, or any other flag, is a usage error. `--help` shows where each shell
loads the script from: `~/.local/share/bash-completion/completions/`, the
first `$fpath` directory as `_shell-configurator`, and
`~/.config/fish/completions/`.

## generate --markdown

```
shell-configurator generate --markdown [generate flags] [-o <file>]
```

Prints the prompt the generate flags (or `--state`) build as Markdown: its
`starship.toml` and the state card that rebuilds it (`renderShare` in
`src/services/share.ts`). `-o` writes it to a file instead. The card leaves out
this machine's shells, font install and default shell, and the home folder is
shown as `~`. An adopt-mode card is a usage error (there is no generated prompt
to share); `--shells`, `--set-default`, `--skip-starship`, `--export` and
`--dry-run` are usage errors with it, since it shares the look only.

## Exit Codes

| Code | Meaning                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `0`  | Success.                                                                                                                                                                                                                                                                                                                                                                                                     |
| `1`  | A wizard install finished with at least one failed task, a headless run failed (`CliRunError`, e.g. a failed `--import-url` fetch or an unwritable `-o`/`--export`), a `doctor` check still fails (or `--timings` could not time the prompt), an `uninstall` step failed, a `rollback` could not put a file back, or any fatal crash.                                                                        |
| `2`  | `CliUsageError` — an unknown or malformed flag, a retired command or flag (the message names its replacement), an invalid flag value, `--adopt`/`--import-url` with `generate` or no subcommand, config flags without a subcommand, `uninstall` or `rollback` without `--yes` off a terminal or with `--json`, an unknown `rollback --run` id, or an unreadable state card; reads clean with no stack trace. |

## Persisted Run Data

All of it lives under XDG dirs resolved by `src/services/paths.ts`, so the
tarball stays self-contained and nothing is written next to the binary:

| Path                                                                                | Contents                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `$XDG_STATE_HOME` or `~/.local/state`/`shell-configurator/history.jsonl`            | Append-only ledger; one JSON `HistoryRecord` per run (`install`/`apply`/`repair`/`uninstall`/`rollback`; `runId` names its captured files, `rollbackOf` the run a rollback undid), in file order = chronological order.                                 |
| `…/runs/<runId>/manifest.json` + `files/<n>`                                        | The files a run changed: a copy of each from before the run (`0600`, in a `0700` folder) and its hash after. Only the newest 50 runs are kept. `rollback` reads it.                                                                                     |
| `…/snapshots/<iso-timestamp>.json`                                                  | The versioned state card each wizard install or headless `apply` applied; the id is the ISO timestamp with `:` replaced by `-`. The ledger's `snapshotId` points at it, and the doctor reads the newest one to learn which shells the last run touched. |
| `$XDG_CACHE_HOME` or `~/.cache`/`shell-configurator/fonts/<id>.zip` + `<id>.sha256` | Font cache: the verified archive plus its pinned SHA-256 pin file. A cached archive is reused offline only while its bytes still match the pin.                                                                                                         |
| `$XDG_CACHE_HOME` or `~/.cache`/`shell-configurator/starship.version`               | The starship version recorded by the last run that freshly installed Starship (`recordStarshipVersion`). Feeds the doctor's `version-drift` check.                                                                                                      |

## State Card (`serializeState` / `parseState` in `src/services/state.ts`)

`STATE_VERSION = 1`. A card captures only what the user decided — never wizard
runtime (step, detection results, task state) — so the same card produces the
same prompt on any machine. It is what `--export`, `--import`/`--state`, and
every snapshot use.

```typescript
{
  version: 1,
  wizard: {
    preset: string | null;
    leftModules: ModuleId[];
    rightModules: ModuleId[];
    characterSymbol: CharacterSymbol;
    palette: PaletteId;
    powerline: boolean;
    continuationPrompt: ContinuationPrompt;
    addNewline: boolean;
    vimMode: boolean;
    directoryTruncationLength: number;
    directorySubstitutions: DirectorySubstitution[];
    selectedShells: ShellId[];
    nerdFontToInstall: NerdFontChoice;
    setDefaultShell: ShellId | null;
    skipStarshipInstall: boolean;
    keepExistingConfig: boolean;
    hasNerdFont: boolean;
  }
}
```

`parseState` starts a parsed card from runtime defaults (`step: 'welcome'`,
detection-based fields cleared) and re-detects per run. A key the card format does not
have, at the top level or in `wizard`, is a `CliUsageError` that names it, so a
misspelled `"pallete"` is never silently dropped.

## Original copies

`keepOriginal()` copies a user file to `<file>.pre-shell-configurator` the first
time the tool is about to change it, and never again: not when the copy already
exists, and not when the file already holds a `# Added by ShellConfigurator`
block (it is no longer the original). For the per-shell configs only this tool
writes, a file with the `# Generated by ShellConfigurator` header is skipped
too; a shared config made with `generate -o` and tuned by hand still gets its
copy. It runs before rc writes (`applyShellConfig`,
`resetSharedShellConfig`), the Bash login file, per-shell and shared config
writes that change the content, terminal configs (`wireTerminalFont`), and a
per-shell config `uninstall` deletes, so a hand-written config is kept once
while a generated one is not. It is best-effort: a copy that cannot be made
(a read-only file, a full disk) becomes a note on the step, never a failure. No
`.bak-*` files are written; `rollback` is the way back (ADR 0006). The copies
are captured like the files they belong to, so rolling back the run that made a
copy deletes it once its file is back as it was (while that file is left as it
is, the copy stays), and undoing your first apply leaves nothing behind. Copies from
runs that stand outlive a pruned run or a deleted state folder, which is why an
uninstall whose capture failed names them; such an uninstall also leaves the
per-shell configs in place, since nothing could bring them back.

---
