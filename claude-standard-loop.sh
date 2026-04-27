#!/bin/bash
# Nova Monitoring Platform - Ralph Loop
# Usage: ./loop.sh [plan] [max_iterations]
# Examples:
#   ./loop.sh              # Build mode, unlimited iterations
#   ./loop.sh 20           # Build mode, max 20 iterations
#   ./loop.sh plan         # Plan mode, unlimited iterations
#   ./loop.sh plan 5       # Plan mode, max 5 iterations

# Parse arguments
# Supports: ./loop.sh              (build, unlimited)
#           ./loop.sh N            (build, max N)
#           ./loop.sh plan [N]     (plan mode, optional max N)
#           ./loop.sh <role> [N]   (named role, optional max N)
# MAX_ITERATIONS env var (set by Zephyr) takes priority over positional args.
if [[ "$1" =~ ^[0-9]+$ ]]; then
    # Legacy: first arg is a number → build mode with max iterations
    MODE="build"
    PROMPT_FILE="PROMPT_build.md"
    MAX_ITERATIONS=${MAX_ITERATIONS:-$1}
elif [ -n "$1" ]; then
    # Named role (e.g. plan, build, frontend …)
    MODE="$1"
    PROMPT_FILE="PROMPT_${MODE}.md"
    MAX_ITERATIONS=${MAX_ITERATIONS:-${2:-0}}
else
    # No arguments: build mode, unlimited
    MODE="build"
    PROMPT_FILE="PROMPT_build.md"
    MAX_ITERATIONS=${MAX_ITERATIONS:-0}
fi

ITERATION=0
CURRENT_BRANCH=$(git branch --show-current)

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Mode:   $MODE"
echo "Prompt: $PROMPT_FILE"
echo "Branch: $CURRENT_BRANCH"
[ $MAX_ITERATIONS -gt 0 ] && echo "Max:    $MAX_ITERATIONS iterations"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Verify prompt file exists
if [ ! -f "$PROMPT_FILE" ]; then
    echo "Error: $PROMPT_FILE not found"
    exit 1
fi

while true; do
    if [ $MAX_ITERATIONS -gt 0 ] && [ $ITERATION -ge $MAX_ITERATIONS ]; then
        echo "Reached max iterations: $MAX_ITERATIONS"
        break
    fi

    cat "$PROMPT_FILE" | claude -p --dangerously-skip-permissions --output-format=stream-json --model sonnet --verbose

    # Push changes after each iteration
    git push origin "$CURRENT_BRANCH" || {
        echo "Failed to push. Creating remote branch..."
        git push -u origin "$CURRENT_BRANCH"
    }

    ITERATION=$((ITERATION + 1))
    echo -e "\n\n======================== LOOP $ITERATION ========================\n"
done
