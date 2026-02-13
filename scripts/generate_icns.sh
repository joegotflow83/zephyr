#!/bin/bash
# Convert a source PNG to macOS .icns icon file.
#
# Uses macOS-native 'sips' and 'iconutil' to produce the final .icns.
# Requires the source PNG to be at least 512x512 (1024x1024 recommended
# for Retina support).
#
# Usage:
#   ./scripts/generate_icns.sh                                 # defaults
#   ./scripts/generate_icns.sh resources/icon.png resources/icon.icns

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

INPUT_PNG="${1:-$PROJECT_ROOT/resources/icon.png}"
OUTPUT_ICNS="${2:-$PROJECT_ROOT/resources/icon.icns}"

if [ ! -f "$INPUT_PNG" ]; then
    echo "Error: source PNG not found at $INPUT_PNG"
    echo "Run 'python3 scripts/generate_icon.py' first to generate it."
    exit 1
fi

# macOS iconutil requires an .iconset directory with specific sizes.
# Each size needs a standard (1x) and Retina (2x) variant.
ICONSET_DIR="$(mktemp -d)/Zephyr.iconset"
mkdir -p "$ICONSET_DIR"

# Required icon sizes (pixels) and their corresponding filenames.
# Format: "filename dimension"
SIZES=(
    "icon_16x16.png 16"
    "icon_16x16@2x.png 32"
    "icon_32x32.png 32"
    "icon_32x32@2x.png 64"
    "icon_128x128.png 128"
    "icon_128x128@2x.png 256"
    "icon_256x256.png 256"
    "icon_256x256@2x.png 512"
    "icon_512x512.png 512"
    "icon_512x512@2x.png 1024"
)

echo "Generating iconset from $INPUT_PNG ..."

for entry in "${SIZES[@]}"; do
    FILENAME="${entry%% *}"
    DIM="${entry##* }"
    sips -z "$DIM" "$DIM" "$INPUT_PNG" --out "$ICONSET_DIR/$FILENAME" >/dev/null 2>&1
done

echo "Converting iconset to .icns ..."
iconutil -c icns "$ICONSET_DIR" -o "$OUTPUT_ICNS"

# Clean up temp iconset directory
rm -rf "$(dirname "$ICONSET_DIR")"

echo "Done: $OUTPUT_ICNS"
