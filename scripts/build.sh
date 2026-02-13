#!/bin/bash
# Build script for Zephyr Desktop
#
# Runs PyInstaller with the zephyr.spec configuration to produce a
# standalone application bundle.
#
# Usage:
#   ./scripts/build.sh          # Standard build
#   ./scripts/build.sh --clean  # Clean build (removes previous artefacts)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

# Ensure PyInstaller is available
if ! command -v pyinstaller &>/dev/null; then
    echo "Error: pyinstaller not found. Install it with:"
    echo "  pip install pyinstaller"
    exit 1
fi

# Verify spec file exists
if [ ! -f "zephyr.spec" ]; then
    echo "Error: zephyr.spec not found in $PROJECT_ROOT"
    exit 1
fi

# Default to --clean build
EXTRA_ARGS="${@:---clean}"

echo "Building Zephyr Desktop..."
echo "  Project root: $PROJECT_ROOT"
echo "  Spec file:    zephyr.spec"
echo ""

pyinstaller zephyr.spec $EXTRA_ARGS

echo ""
echo "Build complete. Output in dist/Zephyr/"
