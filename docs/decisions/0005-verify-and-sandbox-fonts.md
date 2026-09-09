# 0005 — Verify and sandbox font downloads

**Status**: Accepted

## Context

`installNerdFont` downloads a zip from the nerd-fonts GitHub release and
extracts the font files into the user's fonts directory.

That put two unproductive trust assumptions into the install path:

1. **Transport trust** — whatever bytes came back from the download URL were
   treated as the genuine archive. There was no way to detect a swapped or
   corrupted download.
2. **Parser trust** — zip parsing ran in the wizard's main process. A malformed
   or hostile archive could throw anywhere in `unzipSync`, and an uncaught
   throw inside it had the TUI as collateral damage.

"Don't parse untrusted-before-write input in your TUI process" and "verify what
you're about to execute/extract" are both standard supply-chain hygiene, but
each has real trade-offs to reconcile with the project's shape.

## Decision

Two defensive layers, in order, inside `installNerdFont`:

1. **Checksum verification (fail closed)** — after the size guards, the
   downloaded buffer's SHA-256 is compared with the `sha256:` digest GitHub
   publishes in the release asset metadata (`releases/latest`, matched by the
   asset's `zipName`). Any of three conditions — digest mismatch, no digest for
   the asset, or a failed/aborted lookup — refuses to install with its own
   error.
2. **Sandboxed extraction** — decompression moves to an `eval`-script `Worker`
   (`src/services/fontExtractor.ts`) that returns `{ name, bytes }` entries for
   the *main thread* to write. A hostile archive can only crash the throwaway
   worker.

### Why these specifics

- **Digest from the same channel as the download**: the digest is fetched over
  HTTPS from GitHub's API, the archive over HTTPS from GitHub's CDN endpoints.
  A MITM that swapped the archive would have to rewrite the API metadata too —
  the fail-closed case then reports a checksum mismatch instead of silently
  setting a backdoored font. This is "trust the publisher's metadata over the
  blob", a deliberately small threat model, not a peer-to-peer hash-drop.
- **Worker, not a new process or pure sandbox**: a forked helper would need IPC
  project setup and lifecycle management; the worker keeps everything in
  `dist/`. And there is no untrusted *code execution* worth sandboxing beyond
  the parser — the main-thread writes keep `path.join(fontsDir, basename)` and
  `fs.writeFileSync` in one auditable place, and the worker's basename
  flattening means its output can never escape `fontsDir` even if an entry is
  full of `../` segments.
- **Timeout**: a stuck decompression can't wedge the install chain; the worker
  gets killed after a fixed window.
- **Existing tests survive**: because writes stay on the main thread, the
  installer's `fs.writeFileSync` assertions keep working unchanged — the worker
  is testable in isolation (`fontExtractor.test.ts`).

## Consequences

- Downloads are verified before anything extracted touches the filesystem; a
  tampered or truncated archive is rejected with an actionable message.
- Font parsers can no longer take down the wizard; worst case is a dead worker
  and a clear error, while the TUI keeps rendering.
- The release.json metadata call adds a second network round-trip (with its own
  timeout) after every font download.
- A Nerd Font release without published asset digests becomes uninstallable by
  design — correct, because fail-closed is the point; the error message tells
  the user exactly why.