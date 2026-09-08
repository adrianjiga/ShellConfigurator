# Contributing to ShellConfigurator

ShellConfigurator is an interactive terminal wizard that configures
[Starship](https://starship.rs/). It is built with [Ink](https://github.com/vadimdemedes/ink)
(React for CLIs) and targeted at Node.js 22+.

Thanks for your interest. This file describes how to get set up and how to get
changes merged.

## Getting started

Prerequisites:

- Node.js 22+ (the package does not support older versions)
- npm

```bash
npm install   # runs npm run build via the prepare hook
```

The project is pure ESM. Relative imports name the real source file
(`from './types.ts'`) and are rewritten to `.js` on emit.

## Useful commands

| Command                 | What it does                                        |
| ----------------------- | --------------------------------------------------- |
| `npm test`              | Run unit tests (vitest)                             |
| `npm run test:coverage` | Tests + v8 coverage report (CI enforces thresholds) |
| `npm run lint`          | ESLint (`no-explicit-any` is an error)              |
| `npm run format:check`  | Prettier check                                      |
| `npm run format`        | Prettier write                                      |
| `npm run typecheck`     | Full type-check including tests                     |
| `npm run build`         | Emit `dist/` with `tsc`                             |
| `npm run dev`           | Run the wizard via tsx — **read the warning below** |

### Never run `npm run dev` to "test" changes

The wizard performs real system mutations: it runs `sudo apt/dnf/pacman`,
installs Nerd Fonts, writes `~/.config/starship.toml`, and modifies shell RC
files (`~/.zshrc`, `~/.bashrc`, `~/.config/fish/config.fish`). Verify logic with
unit tests against fake deps instead of running it on a machine you care about.

## Development workflow

Every change goes through a feature branch and a pull request for
[`master`](https://github.com/adrianjiga/ShellConfigurator/tree/master).
Nothing is ever committed or pushed directly to `master` — it is protected.

1. Create a branch:

   ```bash
   git checkout -b <type>/<short-description>   # e.g. fix/font-detect
   ```

2. Make your changes with conventional commit messages:

   ```text
   feat:  add a new preset
   fix:   detect fonts on fedora
   docs:  clarify the wizard steps
   chore: bump actions in CI
   ```

3. Before pushing, make sure the gates pass:

   ```bash
   npm run lint && npm run format:check && npm run typecheck && npm run test:coverage
   ```

4. Push and open a pull request. The PR description must contain the sections
   **Summary**, **Why**, and **What Changed**.

5. CI runs on the PR: lint, format, typecheck, build, the distro-smoke Docker
   matrix, coverage on the supported Node versions, and code scanning. The
   branch must be up to date with `master` and all checks green before merge.

## Testing and area conventions

- Unit tests live in `src/__tests__/`, mirroring the tree under `src/`.
- Screens' key handling is tested with `ink-testing-library` in
  `src/__tests__/screens/`.
- Install orchestration (`services/installTasks.ts`) takes injected
  dependencies; tests pass fakes, never the real system installers.
- `services/detector.ts` exposes only `*Async` functions that never block the
  render loop. Detection tests mock `execFile` with the pattern shown in
  `detector.test.ts` (`vi.hoisted` mocks plus a promisify stub).
- Docs live in `docs/` — update them when behaviour or architecture changes.

## Code style

- ESLint and Prettier are enforced; `no-explicit-any` fails the build.
- No emojis in code, docs, or commit messages unless there is a concrete reason.
- Comments explain _why_, not _what_; avoid restating the code.

## Releasing

Releases are triggered by pushing a `v*` tag, which runs `release.yml`: the
workflow builds, stages the package to npm via OIDC, and attaches the `npm
pack` tarball to a GitHub release. The staged package is then approved manually
with 2FA (`npm stage approve` or the npmjs Staged Packages tab). Releases are
maintainers-only and not part of the normal contribution flow.
