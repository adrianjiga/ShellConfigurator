#!/bin/sh
# Runs inside the smoke container. Bash — which the harness needs — is not
# guaranteed to exist at container start (Alpine ships none), so the per-distro
# setup hook runs first and installs it; then the real harness takes over under
# `bash -euxo pipefail`. The hooks come from the CI matrix via env vars and are
# evaluated here rather than glued into a giant chained command string.
set -eu

if [ -n "${DISTRO_SETUP:-}" ] && [ "$DISTRO_SETUP" != "true" ]; then
  eval "$DISTRO_SETUP"
fi

exec bash -euxo pipefail -c '
  bash scripts/ci/distroSetup.sh
  if [ -n "${FINALIZE:-}" ] && [ "$FINALIZE" != "true" ]; then eval "$FINALIZE"; fi
  cp -a /app /tmp/src
  cd /tmp/src
  export HOME=/tmp/smoke-home
  npm ci
  npm run build
  node scripts/dockerSmoke.mjs
  if [ -n "${WIZARD_CHECK:-}" ] && [ "$WIZARD_CHECK" != "true" ]; then eval "$WIZARD_CHECK"; fi
'