#!/usr/bin/env bash
#
# Point git at the version-controlled hooks in .githooks/.
#
# Runs automatically via package.json postinstall, so a fresh clone is
# protected as soon as someone runs `npm install`. Safe to run by hand too.
#
# It exits quietly when there is nothing to do — no .git directory (Docker
# builds install dependencies before the source is copied in, and tarball
# installs have no repo at all), or no .githooks directory.
#
# Opt out with: git config --unset core.hooksPath

set -uo pipefail
cd "$(dirname "$0")/.."

# Not a git checkout (Docker layer, npm pack, vendored copy) — nothing to wire.
git rev-parse --git-dir >/dev/null 2>&1 || exit 0
[ -d .githooks ] || exit 0

chmod +x .githooks/* 2>/dev/null || true

# Don't fight an existing custom hooksPath someone set on purpose.
current=$(git config --get core.hooksPath || true)
if [ -n "$current" ] && [ "$current" != ".githooks" ]; then
  echo "hooks: core.hooksPath is already '$current' — leaving it alone."
  exit 0
fi

git config core.hooksPath .githooks

if [ -z "$current" ]; then
  echo "hooks: installed (core.hooksPath = .githooks) —$(for h in .githooks/*; do [ -f "$h" ] && printf ' %s' "$(basename "$h")"; done)"
  echo "hooks: disable with  git config --unset core.hooksPath"
fi
