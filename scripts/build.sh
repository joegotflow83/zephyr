#!/bin/bash
set -e

# Zephyr Desktop Build Script
# Runs linting, tests, and creates distributable packages

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Zephyr Desktop Build Script ===${NC}"
echo ""

# Detect platform
PLATFORM="$(uname -s)"
case "${PLATFORM}" in
    Linux*)     PLATFORM_NAME="Linux";;
    Darwin*)    PLATFORM_NAME="macOS";;
    MINGW*|MSYS*|CYGWIN*)  PLATFORM_NAME="Windows";;
    *)          PLATFORM_NAME="UNKNOWN:${PLATFORM}"
esac

echo -e "${YELLOW}Platform detected: ${PLATFORM_NAME}${NC}"
echo ""

# Source NVM if available (for CI environments)
if [ -f "$HOME/.nvm/nvm.sh" ]; then
    echo "Sourcing NVM..."
    source "$HOME/.nvm/nvm.sh"
fi

# Verify Node.js is available
if ! command -v node &> /dev/null; then
    echo -e "${RED}Error: Node.js not found. Please install Node.js first.${NC}"
    exit 1
fi

echo "Node.js version: $(node --version)"
echo "npm version: $(npm --version)"
echo ""

# Step 1: Install dependencies
echo -e "${GREEN}Step 1: Installing dependencies${NC}"
npm ci
echo ""

# Step 2: Lint
echo -e "${GREEN}Step 2: Running linter${NC}"
npm run lint
if [ $? -ne 0 ]; then
    echo -e "${RED}Linting failed!${NC}"
    exit 1
fi
echo ""

# Step 3: Run tests
echo -e "${GREEN}Step 3: Running tests${NC}"
npm run test:unit
if [ $? -ne 0 ]; then
    echo -e "${RED}Tests failed!${NC}"
    exit 1
fi
echo ""

# Step 4: Build/Package
echo -e "${GREEN}Step 4: Creating distributable package${NC}"
npm run make
if [ $? -ne 0 ]; then
    echo -e "${RED}Build failed!${NC}"
    exit 1
fi
echo ""

# Display output
echo -e "${GREEN}=== Build Complete ===${NC}"
echo ""
echo "Artifacts created in: out/"
echo ""
ls -lh out/make/ 2>/dev/null || ls -lh out/ 2>/dev/null || echo "No artifacts found"
echo ""

# Platform-specific notes
case "${PLATFORM_NAME}" in
    "macOS")
        echo -e "${YELLOW}Note: For distribution, macOS builds must be notarized.${NC}"
        echo "Use: npm run publish (for automatic notarization via Forge)"
        ;;
    "Windows")
        echo -e "${YELLOW}Note: Windows builds include auto-update support via Squirrel.${NC}"
        ;;
    "Linux")
        echo -e "${YELLOW}Note: DEB and RPM packages created for Linux distribution.${NC}"
        ;;
esac
echo ""

echo -e "${GREEN}Build script completed successfully!${NC}"
