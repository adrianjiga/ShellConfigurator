#!/usr/bin/env bash
#
# Install shell-configurator for the current user.
#
# Prefers the shell-configurator `<version>.tgz` asset from the latest GitHub
# release. Downloads it into a per-user data directory and symlinks the
# `shell-configurator` binary into the user's `~/.local/bin`, so no root is
# needed. Safe to re-run: a previous install is replaced in place.
#
# Usage: curl -fsSL https://raw.githubusercontent.com/adrianjiga/ShellConfigurator/master/scripts/install.sh | sh
set -euo pipefail

REPO="adrianjiga/ShellConfigurator"
API_LATEST="https://api.github.com/repos/${REPO}/releases/latest"

if command -v node >/dev/null 2>&1; then
  node_major="$(node --version | cut -d. -f1 | tr -d v)"
else
  node_major=0
fi

if [ "$node_major" -lt 22 ]; then
  cat >&2 <<'EOF'
shell-configurator requires Node.js 22 or newer, which was not found.

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

# Resolve the tarball asset attached to the latest GitHub release. The release
# workflow uploads shell-configurator-<version>.tgz via `npm pack`.
echo "Resolving latest release..."
asset_url="$(
  curl -fsSL "$API_LATEST" \
    | grep -Eo '"browser_download_url": *"[^"]+\.tgz"' \
    | head -n1 \
    | sed -E 's/^"browser_download_url": *"([^"]+)"/\1/'
)"

if [ -z "$asset_url" ]; then
  echo "No tarball asset found in the latest release." >&2
  exit 1
fi

mkdir -p "$data_dir" "$bin_dir"
tmp_dir="$(mktemp -d)"

echo "Downloading $asset_url"
curl -fsSL "$asset_url" -o "$tmp_dir/package.tgz"
tar -xzf "$tmp_dir/package.tgz" -C "$tmp_dir"

# Clear any previous install so a stale extract never shadows a new one.
rm -rf "${data_dir:?}"/*
cp -rf "$tmp_dir/package/." "$data_dir/"
rm -rf "$tmp_dir"

chmod +x "$data_dir/dist/index.js"
ln -sf "$data_dir/dist/index.js" "$bin_dir/shell-configurator"

# Boot the freshly installed binary so a broken release never "installs" silently.
if "$bin_dir/shell-configurator" --version >/dev/null 2>&1; then
  echo "Verified the install by launching \`shell-configurator --version\`."
else
  echo "The installed binary failed to start. See '$data_dir' for details." >&2
  exit 1
fi

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