#!/usr/bin/env bash
#
# Is every /api route still behind the key?
#
# The control plane was once entirely unauthenticated. auth.test.ts proves the
# routes it knows about are guarded — but it iterates a hardcoded list, so a
# newly mounted router that nobody added to that list is invisible to it. This
# script closes that gap by reading app.ts and checking two things:
#
#   1. every /api mount either has requireOwner or is explicitly public
#   2. every guarded mount is present in auth.test.ts's GUARDED list
#
# So adding a route without a guard fails here, and adding a guarded route
# without covering it in the test also fails here.
#
# Public routes are listed in scripts/allowed-public-routes.txt, one prefix per
# line. Keep that file short and justify every entry.
#
# Usage:  bash scripts/check-auth-coverage.sh   (or: npm run check:auth)
# Exit:   0 = every route accounted for, 1 = something is exposed or untested

set -uo pipefail
cd "$(dirname "$0")/.."

APP=server/src/app.ts
TEST=server/src/__tests__/routes/auth.test.ts
ALLOW=scripts/allowed-public-routes.txt

fail=0
problem() { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=1; }
ok()      { printf '  \033[32m✓\033[0m %s\n' "$1"; }

for f in "$APP" "$TEST"; do
  [ -s "$f" ] || { problem "MISSING or empty: $f"; echo; echo "Cannot verify auth coverage."; exit 1; }
done

# `identify` populates req.isOwner; without it requireOwner rejects everyone
# and the dashboard is dead, so this is a wiring check, not a security one.
if grep -qF "app.use(identify)" "$APP"; then
  ok "caller identification is wired"
else
  problem "app.use(identify) missing from $APP"
fi

is_public() {
  [ -f "$ALLOW" ] || return 1
  local route="$1" line
  while IFS= read -r line; do
    line="${line%%#*}"; line="$(printf '%s' "$line" | tr -d '[:space:]')"
    [ -n "$line" ] && [ "$line" = "$route" ] && return 0
  done < "$ALLOW"
  return 1
}

echo "Every /api route is guarded or explicitly public"
guarded_routes=()
while IFS= read -r line; do
  route=$(printf '%s' "$line" | sed -E "s/.*\('(\/api[^']*)'.*/\1/")
  if printf '%s' "$line" | grep -qF "requireOwner"; then
    ok "$route — requireOwner"
    guarded_routes+=("$route")
  elif is_public "$route"; then
    ok "$route — intentionally public (in $(basename "$ALLOW"))"
  else
    problem "$route is mounted with NO guard and is not in $ALLOW"
  fi
done < <(grep -E "app\.(use|get|post|put|patch|delete)\('/api" "$APP")

# A guarded route nobody tests is a guard nobody notices losing.
echo
echo "Every guarded route is covered by auth.test.ts"
for route in "${guarded_routes[@]}"; do
  # The test may probe a sub-path (/api/settings/api-key for /api/settings).
  if grep -qF "'$route" "$TEST"; then
    ok "$route"
  else
    problem "$route is guarded but absent from GUARDED in $(basename "$TEST")"
  fi
done

echo
if [ "$fail" -ne 0 ]; then
  cat <<'MSG'
Auth coverage check FAILED.

If you added a route:
  • guard it        → app.use('/api/thing', requireOwner, thingRouter)
  • and test it     → add it to GUARDED in auth.test.ts
  • or, if it is genuinely public, add it to scripts/allowed-public-routes.txt
    with a comment saying why.
MSG
  exit 1
fi

echo "Every /api route is accounted for."
