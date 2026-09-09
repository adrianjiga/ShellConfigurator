# Architecture Decision Records

Decisions here capture *why* the codebase looks the way it does, so a future
change can weigh the original trade-off before unpicking it.

- [0001-fill-over-right-format](0001-fill-over-right-format.md) — right-align the
  prompt with `$fill` instead of `right_format`.
- [0002-per-shell-configs](0002-per-shell-configs.md) — write one `starship.toml`
  per selected shell instead of a single shared file.
- [0003-bundled-dependencies](0003-bundled-dependencies.md) — keep `node_modules`
  inside the packed tarball.
- [0004-discriminated-unions](0004-discriminated-unions.md) — model optional
  choices as discriminated unions, never sentinel strings.
- [0005-verify-and-sandbox-fonts](0005-verify-and-sandbox-fonts.md) — check the
  SHA-256 of font downloads against the release metadata and decompress in an
  isolated worker.