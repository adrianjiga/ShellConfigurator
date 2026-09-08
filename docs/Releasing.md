# Releasing

## One-time setup (bootstrap)

OIDC trusted publishing cannot create a brand-new npm package — the package must
exist before a trusted publisher can be configured for it. The first publish is
therefore done manually with a classic token.

1. **Publish the first version manually**

   ```bash
   npm login
   npm publish --access public
   ```

   If your account has 2FA enabled, approve the OTP when prompted.

2. **Configure the trusted publisher**

   The `release.yml` workflow publishes with OIDC, so npm must accept
   publishes from it. Either:

   - **On npmjs.com:** open the package → *Settings → Publishing access →
     Add trusted publisher*, and enter:
     - GitHub user: `adrianjiga`
     - Repository: `ShellConfigurator`
     - Workflow filename: `release.yml`
     - Environment: *(leave blank)*
   - **Or from the CLI** (requires a Granular Access Token with package write
     access):

     ```bash
     npm trust github shell-configurator \
       --repo adrianjiga/ShellConfigurator \
       --file .github/workflows/release.yml --allow-publish -y
     ```

3. **(Optional) Lock out classic tokens**

   On npmjs.com, the package *Settings → Publishing access* page can be set to
   "Require two-factor authentication and disallow tokens". With a trusted
   publisher configured, npm still accepts OIDC publishes even when classic
   tokens are disabled.

Once the trusted publisher is configured, no `NPM_TOKEN` secret is needed in
the repository. The `id-token: write` permission in `release.yml` lets GitHub
mint a short-lived OIDC token per run, and `npm publish --provenance` attaches
Sigstore attestations linking the build back to this repository.

## Cutting a release

1. Bump the version in `package.json` and commit it:

   ```bash
   npm version patch -m "chore: release %s"   # or minor / major
   ```

   `npm version` creates a commit and a `v<version>` tag; push both:

   ```bash
   git push && git push --tags
   ```

2. Pushing a tag matching `v*` triggers `.github/workflows/release.yml`, which:
   - runs lint, typecheck, and the test suite
   - builds `dist/` and packs the npm tarball
   - publishes to npm with provenance via OIDC
   - creates a GitHub Release with automatic release notes and the tarball
     attached (this is what the curl installer downloads)

3. Verify the release:
   - `npm view shell-configurator` shows the new version
   - the package page on npmjs.com shows the provenance/Sigstore badge
   - the GitHub Releases page has a release for the tag with the `.tgz` asset

## How the curl installer resolves a release

`scripts/install.sh` queries the GitHub Releases API (`/releases/latest`) for
the `shell-configurator-<version>.tgz` asset attached by `release.yml` and
installs it into a per-user directory. No download happens until a tag
actually produces a release with that asset.

## Homebrew tap (planned)

A `homebrew-tap` repository will eventually host a formula that points at the
same GitHub Release tarball, with `depends_on "node@22"`. Not built yet;
documented here so the release workflow keeps attaching the tarball that both
distributions consume.