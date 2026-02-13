#!/usr/bin/env bash
# validate.sh — Local validation wrapper matching CI checks.
# Usage:
#   ./validate.sh              Run the full test suite (default)
#   ./validate.sh full         Run the full test suite
#   ./validate.sh targeted … Run specific tests (args passed to pytest)
#   ./validate.sh lf           Re-run only last-failed tests
#   ./validate.sh ff           Run failed-first, then remaining tests
#   ./validate.sh lint         Run black --check and pylint (mirrors CI lint job)

set -euo pipefail

# Qt environment for headless PyQt6 testing
export LD_LIBRARY_PATH="${LD_LIBRARY_PATH:+$LD_LIBRARY_PATH:}/home/ralph/.local/lib/qt-deps"
export QT_QPA_PLATFORM=offscreen

MODE="${1:-full}"

case "$MODE" in
  full)
    python3 -m pytest tests/ -v --tb=short
    ;;
  targeted)
    shift
    python3 -m pytest "$@" -v --tb=short
    ;;
  lf)
    python3 -m pytest tests/ -v --tb=short --last-failed
    ;;
  ff)
    python3 -m pytest tests/ -v --tb=short --failed-first
    ;;
  lint)
    echo "=== Checking formatting with black ==="
    black --check src/ tests/
    echo ""
    echo "=== Running pylint ==="
    pylint src/ --fail-under=7.0
    ;;
  *)
    echo "Unknown mode: $MODE"
    echo "Usage: $0 {full|targeted|lf|ff|lint}"
    exit 1
    ;;
esac
