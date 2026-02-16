#!/usr/bin/env bash
# Download xterm.js 5.3.0 and fit addon 0.8.0 from unpkg CDN.
# Run once before building to populate resources/xterm/.
# Output: resources/xterm/xterm.js, xterm.css, xterm-addon-fit.js

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
XTERM_DIR="$REPO_ROOT/resources/xterm"

XTERM_VERSION="5.3.0"
FIT_ADDON_VERSION="0.8.0"
CDN="https://unpkg.com"

mkdir -p "$XTERM_DIR"

echo "Downloading xterm.js ${XTERM_VERSION}..."
curl -sSL "${CDN}/xterm@${XTERM_VERSION}/lib/xterm.js" -o "$XTERM_DIR/xterm.js"
curl -sSL "${CDN}/xterm@${XTERM_VERSION}/css/xterm.css" -o "$XTERM_DIR/xterm.css"

echo "Downloading xterm-addon-fit ${FIT_ADDON_VERSION}..."
curl -sSL "${CDN}/xterm-addon-fit@${FIT_ADDON_VERSION}/lib/xterm-addon-fit.js" -o "$XTERM_DIR/xterm-addon-fit.js"

echo "Done. Files saved to resources/xterm/:"
ls -lh "$XTERM_DIR"
