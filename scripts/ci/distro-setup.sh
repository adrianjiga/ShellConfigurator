#!/usr/bin/env bash
set -euo pipefail

if command -v apt-get >/dev/null 2>&1; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs npm curl tar
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y -q nodejs npm curl tar
elif command -v pacman >/dev/null 2>&1; then
  # --disable-sandbox keeps pacman working under qemu emulation (local dev
  # on arm64); harmless on native runners.
  pacman -Syu --noconfirm --disable-sandbox nodejs npm curl tar
elif command -v apk >/dev/null 2>&1; then
  # bash is not preinstalled on Alpine but the smoke harness drives the
  # container with bash -euxo pipefail, so install it alongside the toolchain.
  apk add --no-cache nodejs npm curl tar bash
else
  echo "No supported package manager found" >&2
  exit 1
fi

# Distro Node is often older than the engines floor (18 on debian/ubuntu), which
# makes npm print EBADENGINE noise for every install. Replace it with the pinned
# Node 22 LTS when the distro package is too old, so distros that already ship a
# supported version are still exercised as shipped.
node_major="$(node --version | cut -d. -f1 | tr -d v)"
if [ "$node_major" -lt 22 ]; then
  arch="$(uname -m)"
  case "$arch" in
    x86_64) node_arch=x64 ;;
    aarch64 | arm64) node_arch=arm64 ;;
    *)
      echo "Unsupported arch: $arch" >&2
      exit 1
      ;;
  esac
  node_version=v22.23.2
  curl -fsSL "https://nodejs.org/dist/${node_version}/node-${node_version}-linux-${node_arch}.tar.gz" -o /tmp/node.tar.gz
  tar -xzf /tmp/node.tar.gz -C /usr/local --strip-components=1
  rm /tmp/node.tar.gz
  hash -r
fi

node --version
npm --version