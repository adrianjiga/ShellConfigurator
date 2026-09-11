#!/usr/bin/env bash
# Host-side driver for the distro-smoke CI matrix. Injects a matrix cell (image,
# package manager, setup/finalize/wizard-check hooks) into the container as env
# vars; scripts/ci/distroRunner.sh performs the hooks inside the image.
set -euo pipefail

image="$1"
package_manager="$2"
distro_setup="${3:-}"
finalize="${4:-}"
wizard_check="${5:-}"
node_version="${NODE_VERSION:-v22.23.2}"

mkdir -p /tmp/node-tarball-cache

docker run --rm \
  -v "$PWD":/app:ro \
  -v /tmp/node-tarball-cache:/node-cache \
  -w /app \
  -e EXPECTED_PM="$package_manager" \
  -e NODE_TARBALL_DIR=/node-cache \
  -e NODE_VERSION="$node_version" \
  -e SHELL=/bin/bash \
  -e DISTRO_SETUP="$distro_setup" \
  -e FINALIZE="$finalize" \
  -e WIZARD_CHECK="$wizard_check" \
  "$image" \
  sh scripts/ci/distroRunner.sh