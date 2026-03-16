#!/bin/bash
# Usage: ./factory-loop.sh [PROMPT_FILE] [max_iterations]
# Examples:
# ./factory-loop.sh PROMPT_coder.md          # unlimited
# ./factory-loop.sh PROMPT_pm.md 30
# ./factory-loop.sh                          # defaults to PROMPT_build.md (back compat)

PROMPT_FILE="${1:-PROMPT_build.md}"
MAX_ITERATIONS="${2:-0}"

if [ ! -f "$PROMPT_FILE" ]; then
    echo "Error: Prompt file $PROMPT_FILE not found"
    exit 1
fi

ITERATION=0
CURRENT_BRANCH=$(git branch --show-current)
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Prompt: $PROMPT_FILE"
echo "Branch: $CURRENT_BRANCH"
[ $MAX_ITERATIONS -gt 0 ] && echo "Max: $MAX_ITERATIONS iterations"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Role-specific wake conditions (add/edit based on your roles)
function check_wake_condition() {
    git pull --quiet  # Always freshen repo first
    case "$PROMPT_FILE" in
        PROMPT_pm.md)
            # PM wakes on: @feature_requests.md exists AND changed since last check
            if [ -f "@feature_requests.md" ]; then
                LAST_TS_FILE=".last_checked_pm"
                CURRENT_TS=$(stat -c %Y "@feature_requests.md" 2>/dev/null || echo 0)
                LAST_TS=$(cat "$LAST_TS_FILE" 2>/dev/null || echo 0)
                if [ "$CURRENT_TS" -gt "$LAST_TS" ]; then
                    echo "$CURRENT_TS" > "$LAST_TS_FILE"
                    return 0  # Wake
                fi
            fi
            # OR if QA feedback exists with "FAILED"
            if grep -q "QA_FAILED" "team/handovers/qa_feedback.md" 2>/dev/null; then
                return 0
            fi
            return 1  # Sleep
            ;;

        PROMPT_coder.md)
            # Coder wakes on: Any files in tasks/pending/ starting with "coder_"
            if ls "tasks/pending/coder_"* 1> /dev/null 2>&1; then
                return 0
            fi
            return 1
            ;;

        PROMPT_security.md)
            # Security wakes on: handover file exists AND contains "SECURITY_REVIEW_NEEDED"
            if [ -f "team/handovers/coder_to_security.md" ] && grep -q "SECURITY_REVIEW_NEEDED" "team/handovers/coder_to_security.md"; then
                return 0
            fi
            return 1
            ;;

        PROMPT_qa.md)
            # QA wakes on: handover file exists AND contains "SECURITY_APPROVED" AND changed recently
            if [ -f "team/handovers/security_to_qa.md" ] && grep -q "SECURITY_APPROVED" "team/handovers/security_to_qa.md"; then
                LAST_TS_FILE=".last_checked_qa"
                CURRENT_TS=$(stat -c %Y "team/handovers/security_to_qa.md" 2>/dev/null || echo 0)
                LAST_TS=$(cat "$LAST_TS_FILE" 2>/dev/null || echo 0)
                if [ "$CURRENT_TS" -gt "$LAST_TS" ]; then
                    echo "$CURRENT_TS" > "$LAST_TS_FILE"
                    return 0
                fi
            fi
            return 1
            ;;

        *)  # Default/fallback for other prompts
            return 0  # Always wake (like your original)
            ;;
    esac
}

function check_shutdown_condition() {
    if [ -f "team/complete.flag" ] && grep -q "ALL_COMPLETE" "team/complete.flag"; then
        echo "Detected ALL_COMPLETE flag → shutting down this Ralph."
        exit 0  # Graceful exit
    fi
    return 0  # Continue if not
}

while true; do
    if [ $MAX_ITERATIONS -gt 0 ] && [ $ITERATION -ge $MAX_ITERATIONS ]; then
        echo "Reached max iterations"
        break
    fi

    git pull --quiet

    check_shutdown_condition

    if check_wake_condition; then
        echo "Wake condition met → running Claude iteration $ITERATION"

        cat "$PROMPT_FILE" | claude -p \
            --dangerously-skip-permissions \
            --output-format=stream-json \
            --model sonnet \
            --verbose

        git push origin "$CURRENT_BRANCH" || {
            echo "Push failed → creating remote branch..."
            git push -u origin "$CURRENT_BRANCH"
        }

        ITERATION=$((ITERATION + 1))
    else
        echo "No work needed → idling (sleep 30s)"
        sleep 60  # Adjust sleep time: 10s for fast response, 60s for more savings
    fi

    echo -e "\n\n======================== LOOP $ITERATION ========================\n"
done
