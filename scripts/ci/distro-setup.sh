#!/usr/bin/env bash
set -euo pipefail

if command -v apt-get >/dev/null 2>&1; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs npm
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y -q nodejs npm
elif command -v pacman >/dev/null 2>&1; then
  # --disable-sandbox keeps pacman working under qemu emulation (local dev
  # on arm64); harmless on native runners.
  pacman -Syu --noconfirm --disable-sandbox nodejs npm
else
  echo "No supported package manager found" >&2
  exit 1
fi

node --version
npm --version