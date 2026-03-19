#!/bin/bash
# Validation script for running tests with different strategies

set -e

PYTHONPATH="/home/ralph/app/src/lib"
TEST_DIR="/home/ralph/app/src/lib/api/tests"
LOG_FILE="pytest.log"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

usage() {
    echo "Usage: $0 {full|targeted|lf|ff} [pytest-args]"
    echo ""
    echo "Commands:"
    echo "  full             Run full test suite"
    echo "  targeted <path>  Run specific test file or pattern"
    echo "  lf               Run last-failed tests only"
    echo "  ff               Run failed-first (failed tests, then all others)"
    echo ""
    echo "Examples:"
    echo "  $0 full"
    echo "  $0 targeted tests/test_galactichangar.py"
    echo "  $0 targeted -k 'test_post_build'"
    echo "  $0 lf"
    echo "  $0 ff"
    exit 1
}

if [ $# -eq 0 ]; then
    usage
fi

COMMAND=$1
shift

# Set PYTHONPATH
export PYTHONPATH

case "$COMMAND" in
    full)
        echo -e "${GREEN}Running full test suite...${NC}"
        python3 -m pytest "$TEST_DIR" -v --tb=short "$@" 2>&1 | tee "$LOG_FILE"
        ;;
    targeted)
        if [ $# -eq 0 ]; then
            echo -e "${RED}Error: targeted requires a path or pattern${NC}"
            usage
        fi
        echo -e "${GREEN}Running targeted tests: $@${NC}"
        python3 -m pytest "$@" -v --tb=short 2>&1 | tee "$LOG_FILE"
        ;;
    lf)
        echo -e "${YELLOW}Running last-failed tests...${NC}"
        python3 -m pytest --lf -v --tb=short "$TEST_DIR" "$@" 2>&1 | tee "$LOG_FILE"
        ;;
    ff)
        echo -e "${YELLOW}Running failed-first tests...${NC}"
        python3 -m pytest --ff -v --tb=short "$TEST_DIR" "$@" 2>&1 | tee "$LOG_FILE"
        ;;
    *)
        echo -e "${RED}Unknown command: $COMMAND${NC}"
        usage
        ;;
esac

EXIT_CODE=$?
echo ""
if [ $EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}✓ Tests passed${NC}"
else
    echo -e "${RED}✗ Tests failed (see $LOG_FILE for details)${NC}"
fi

exit $EXIT_CODE%  