<!-- title: I Built a Terminal Wizard for Starship (No More Hand-Writing TOML, for me) -->
<!-- tags: linux, cli, productivity, tutorial -->
<!-- est. reading time: ~6-7 min -->

# I Built a Terminal Wizard for Starship (No More Hand-Writing TOML, for me)

I've been a Linux user for a while now. Not the “rice my desktop for eight hours and post it on Reddit” kind, more the “I know what I want and I just want it done” kind.

And for a long time, one thing I kept doing the hard way was my shell prompt.

Like anyone who spends enough time in a terminal, I eventually found [Starship](https://starship.rs/). If you haven't tried it, it's a cross-shell prompt, written in Rust, that works in zsh, bash, fish, nushell, PowerShell, and just about anything else you can type into. It shows you your git branch, which Node or Python version you're currently running, how long the last command took, whether you have uncommitted changes: all the context you don't realize you're missing until it's gone.

Starship is genuinely good. The prompt was never the problem. The problem was the setup.

## The TOML problem

Starship is configured with a TOML file: `~/.config/starship.toml`. That file can do a lot, which is exactly the problem: a config file that can do a lot is also a config file that starts from “what do I even put in here?”

You can read the [documentation](https://starship.rs/config/), which is solid and has an example for every option. You can copy-paste a config from a dotfiles repo or from a tutorial. I've done both. Or you can trudge through line by line, tweaking format strings and hoping the colours look decent.

The TOML is only half the story. If you don't have a Nerd Font, every symbol in your prompt renders as a box, and somehow you can go six months without noticing. Starship can be installed and then simply never enabled in your shell's RC file, so nothing changes and you assume the whole thing doesn't work. The shell you picked might not even exist on your machine yet. And once you do get one prompt looking right, it quietly leaks into shells you never asked to touch.

Every one of these is fixable. None of them is fun. And none of them is why I wanted a nice prompt in the first place. So I built a wizard that fixes all of them in one run.

## What shell-configurator does

[shell-configurator](https://github.com/adrianjiga/ShellConfigurator) is an interactive terminal application (a TUI) that walks you through every choice and then applies it all for you. You run a single command:

```bash
npx shell-configurator
```

and instead of editing TOML, you answer questions. No web page, no “paste this into your `.zshrc`” blog-post instructions (I've written those tutorials; this is me making them unnecessary). Everything happens in the terminal you're already living in.

If you've ever run `p10k configure` from [Powerlevel10k](https://github.com/romkatv/powerlevel10k), you know the feeling I'm chasing: a wizard so pleasant you almost enjoy setting things up. That was my gold standard, and everything else follows a single rule: show, don't tell.

## Walking through the wizard

The wizard has one screen per decision, in a fixed order, so you can't get lost. It starts with a font check: if you already have a Nerd Font, the font-picker step is skipped; if you don't, you get to pick one from JetBrains Mono, Fira Code, Hack, Cascadia Code, Meslo LG, or Source Code Pro. Next a preset, from 12 starting points, everything from minimal plain text to Tokyo Night, Gruvbox Rainbow, and Catppuccin. Then you choose which modules appear on each side of the prompt, in two separate steps so the order reads the way you'd build it: left side first, then right. After that the style, the colour palette (any of the 14 works with any preset) plus the character symbol. Then the shell selection, zsh through PowerShell, with each row showing whether that shell is already installed. And finally a review screen showing the generated config and the full install plan, the gate before anything touches your system.

Here's the part I enjoy the most: the prompt preview updates in real time. Change the palette and the preview changes colour. Toggle a module and it appears on the chosen side of the prompt.

One small detail that turned out to matter: right-side modules use an inline fill segment rather than Starship's built-in `right_format`, which pins to the cursor line and misaligns two-line prompts. Exactly the kind of thing you only learn by watching it go wrong.

## What it installs for you

Generating a config file, honestly, was the easy half. The hard part is that a good prompt needs more than a TOML file, so the wizard runs the whole job instead of stopping halfway and handing you a to-do list.

Starship itself gets installed through your package manager, or with the official install script when no usable package manager is found. The Nerd Font comes from the official nerd-fonts release, its SHA-256 digest checked against the one published for that release, unpacked in an isolated worker, and dropped into your user fonts folder. Any shell you selected that isn't there yet gets installed by calling the right package manager on macOS, Arch, and Debian alike.

Then the config. Every selected shell gets its own `~/.config/starship/<shell>.toml` plus the correct init line in its RC file. It's all idempotent: run it twice and it repairs instead of duplicating, and your shared `starship.toml` never gets overwritten.

That last point matters more than it sounds. I've broken plenty of prompts by letting one shell “inherit” another's config, which is how you end up with segments stacked on top of each other for no reason. Per-shell configs, plus an `unset` guard written into the shells you didn't select, mean a configured parent's prompt never leaks into a child session. There's even special handling for nushell, which has no RC file.

## How it figures out what you're running

Automatic installs are only useful if they target the right tools, so package manager detection follows a fixed order, and it's the part of the codebase I've tested most carefully: Homebrew if it's around (macOS and some Linux setups), then pacman on Arch-driven systems, then the distro id from `/etc/os-release`, which silently handles most of the rest, then apt-get, dnf, or apk by presence of the binary, and finally the official Starship install script as a fallback.

The fun part was making this work on machines so minimal they don't even ship `which`. The release-time smoke tests run the detector inside Docker containers with Alpine, Fedora, and Debian-family images.

## Why the installs are deliberately boring

I should be upfront here: installing things on someone else's machine is the fastest way to earn their distrust. So the install part of the wizard is deliberately, aggressively boring.

Font downloads fail closed: if the SHA-256 doesn't match the published digest, nothing gets installed. The zip is unpacked in an isolated worker thread, treated like the untrusted input it is, and only font files (`.ttf`, `.otf`, `.woff`, `.woff2`) are extracted. Every network call and extraction has a timeout, and an abort signal can stop the whole chain at a safe point instead of half-applying an install. The UI suspends while `sudo` or a package manager is running, so you actually see password prompts instead of them being painted over. And if any install step fails, the wizard exits non-zero, so you can wire it into a script and trust the result.

Two safety nets made it comfortable to ship. Every run keeps a backup and `--restore` puts your previous config back. And `--dry-run` shows you the entire plan without touching a single file.

```bash
npx shell-configurator --dry-run
```

## How it's built

I don't get to write about tech choices often, so I'm going to enjoy this section a little.

The app is a [React](https://react.dev/) app rendered in a terminal with [Ink](https://github.com/vadimdemedes/ink). If you've ever wanted React's component model outside the browser, an Ink TUI is one of the most pleasant ways to get it. Components, hooks, state, re-rendering on a terminal screen. The live preview basically updates itself.

And for what it's worth, I loved working on this one. Somewhere around week two, a tool you use every day stops being a chore. What's left is fixing the things you keep bumping into, and that's one of the most satisfying ways to spend an evening.

The rest is deliberate and boring in the good way. TypeScript, ESM, Node 24+, one language and no build-framework ceremony. Navigation between steps is a pair of pure functions, so “what comes next” is a unit-testable fact instead of something tangled up in the UI, and the conditionally-skipped font-picker step lives in a single predicate. Config generation, shell RC editing, detection, and installation are separate modules, with the UI kept thin on top of them. Every install goes through a single runner, so the test suite never has to point real sudo at a real machine.

## The testing I'm actually proud of

I wrote a while back about [six months of AI writing my tests](https://dev.to/adrianjiga/six-months-of-ai-writing-my-tests-what-got-better-what-got-worse-32li), what got better and what got worse. This project is where I got pickier. The repo currently has **857 tests** across 46 test files, with coverage gates enforced in CI, and the full wizard flow is exercised end to end, including a complete font install and a missing-shell install, with system-side effects mocked so they stay deterministic.

There's a simpler reason the testing didn't stop at “good enough”: I use this thing. Every release, the machine I'm standing in front of is one I actually need to work afterwards. A configurator that breaks your shell feels very different when it's _your_ shell. Working on a tool you genuinely need sharpens your attention. When you'll be living with the output yourself, you test it like your afternoon depends on it. Because yours does.

That level of paranoia is what lets the “dangerous” parts of the app exist at all. If you can't test an installer, you shouldn't ship one. And if you can't let a test hit a real machine, put a container in the way.

## Try it

I wrote before about [installing terminal software the hard way](https://dev.to/adrianjiga/youve-been-installing-software-the-hard-way-1ck4), and once I tried CachyOS I [couldn't stop booting into it](https://dev.to/adrianjiga/i-tried-cachyos-and-now-i-cant-stop-booting-into-it-33c7). The lesson from both: the stuff at the edge of your OS is where all the friction lives. Your prompt is the first thing you see when you open a terminal, and for most people it's also the most boring thing to fix.

Not everyone needs a fancy prompt, and I'm not going to evangelize. But if you've ever wanted one and bounced off the TOML, or if every setup tutorial you follow ends with “this didn't work on my machine”, there's now a wizard for that.

```bash
npx shell-configurator
```

The project is open source (MIT), on [GitHub](https://github.com/adrianjiga/ShellConfigurator), and stars are welcome. It installs Starship, installs a verified Nerd Font, installs any missing shells, writes per-shell configs, and leaves your shared `starship.toml` alone. A few minutes of questions, and your terminal finally looks how you've been pretending it does in your head.
