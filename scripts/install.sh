#!/bin/sh
#
# Install shell-configurator for the current user.
#
# Prefers the shell-configurator `<version>.tgz` asset from the latest GitHub
# release. Downloads it into a per-user data directory and symlinks the
# `shell-configurator` binary into the user's `~/.local/bin`, so no root is
# needed. Safe to re-run: a previous install is replaced in place.
#
# Usage: curl -fsSL https://raw.githubusercontent.com/adrianjiga/ShellConfigurator/master/scripts/install.sh | sh
set -eu

REPO="adrianjiga/ShellConfigurator"
API_LATEST="https://api.github.com/repos/${REPO}/releases/latest"

if command -v node >/dev/null 2>&1; then
  node_major="$(node --version | cut -d. -f1 | tr -d v)"
else
  node_major=0
fi

if [ "$node_major" -lt 24 ]; then
  cat >&2 <<'EOF'
shell-configurator requires Node.js 24 or newer, which was not found.

Install one of these Node version managers, then re-run this installer:
  nvm:  https://github.com/nvm-sh/nvm
  fnm:  https://github.com/Schniz/fnm
  volta: https://volta.sh
EOF
  exit 1
fi

case "$(uname -s)" in
  Darwin)
    data_dir="${XDG_DATA_HOME:-$HOME/Library/Application Support}/shell-configurator"
    ;;
  Linux)
    data_dir="${XDG_DATA_HOME:-$HOME/.local/share}/shell-configurator"
    ;;
  *)
    echo "Unsupported platform: $(uname -s)" >&2
    exit 1
    ;;
esac
bin_dir="$HOME/.local/bin"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

# Resolve the tarball asset attached to the latest GitHub release, with the
# SHA-256 digest GitHub publishes for it. The release workflow uploads
# shell-configurator-<version>.tgz via `npm pack`.
echo "Resolving latest release..."
if ! curl -fsSL ${GITHUB_TOKEN:+-H "Authorization: Bearer $GITHUB_TOKEN"} \
  "$API_LATEST" -o "$tmp_dir/release.json"; then
  echo "Could not read the latest release from GitHub (rate-limited? set GITHUB_TOKEN)." >&2
  exit 1
fi
asset="$(node -e '
  const release = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const asset = (release.assets || []).find((a) => a.name.endsWith(".tgz"));
  if (asset) console.log(`${asset.browser_download_url} ${asset.digest || ""}`);
' "$tmp_dir/release.json")"
asset_url="${asset%% *}"
digest="${asset#* }"

if [ -z "$asset" ]; then
  echo "No tarball asset found in the latest release." >&2
  exit 1
fi
case "$digest" in
  sha256:*) ;;
  *)
    echo "The release publishes no sha256 digest for its tarball; refusing to install it." >&2
    exit 1
    ;;
esac

mkdir -p "$(dirname "$data_dir")" "$bin_dir"

echo "Downloading $asset_url"
curl -fsSL "$asset_url" -o "$tmp_dir/package.tgz"
actual="$(node -e '
  const hash = require("crypto").createHash("sha256");
  hash.update(require("fs").readFileSync(process.argv[1]));
  console.log(hash.digest("hex"));
' "$tmp_dir/package.tgz")"
if [ "sha256:$actual" != "$digest" ]; then
  echo "Checksum mismatch: expected $digest, got sha256:$actual. Refusing to install." >&2
  exit 1
fi
tar -xzf "$tmp_dir/package.tgz" -C "$tmp_dir"

staged="$tmp_dir/package"
chmod +x "$staged/dist/index.js"

# Boot the new release before touching the current install, so a broken one
# never replaces a working one.
if ! boot_error="$(node "$staged/dist/index.js" --version 2>&1 >/dev/null)"; then
  echo "The downloaded release failed to start; your current install is unchanged:" >&2
  printf '%s\n' "$boot_error" >&2
  exit 1
fi
echo "Verified the release by launching \`shell-configurator --version\`."

rm -rf "$data_dir.old"
if [ -e "$data_dir" ]; then mv "$data_dir" "$data_dir.old"; fi
mv "$staged" "$data_dir"
rm -rf "$data_dir.old"
ln -sf "$data_dir/dist/index.js" "$bin_dir/shell-configurator"

cat <<EOF

Installed $(basename "$asset_url" .tgz) to $data_dir.
Binary symlinked as $bin_dir/shell-configurator.
EOF

if ! printf '%s' "$PATH" | tr ':' '\n' | grep -qFx "$bin_dir"; then
  cat <<EOF
NOTE: $bin_dir is not on your PATH. Add it to your shell profile:

  export PATH="\$HOME/.local/bin:\$PATH"
EOF
fi

echo
echo "Run 'shell-configurator' to configure your Starship prompt."
