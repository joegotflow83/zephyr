#!/usr/bin/env bash
# validate.sh — Electron CI validation script.
# Runs lint and unit tests. Exits non-zero on any failure.
#
# Usage:
#   bash validate.sh        Run lint + unit tests (default)
#   ./validate.sh           Same as above

set -euo pipefail

# Source NVM so npm/node are available
export NVM_DIR="/home/ralph/.nvm"
# shellcheck source=/dev/null
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"

PASS=0
FAIL=0

run_step() {
  local name="$1"
  shift
  echo ""
  echo "=== $name ==="
  if "$@"; then
    echo "✓ $name passed"
    PASS=$((PASS + 1))
  else
    echo "✗ $name FAILED"
    FAIL=$((FAIL + 1))
  fi
}

run_step "Install dependencies" npm ci
run_step "Lint" npm run lint
run_step "Unit tests" npm run test:unit

echo ""
echo "Results: $PASS passed, $FAIL failed"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
