"""Log parsing and commit detection for Zephyr Desktop.

Classifies container log lines into types (commit, plan, error, info),
extracts commit hashes, and detects iteration boundaries from Ralph
loop output (e.g. bedrock_loop.sh).
"""

import re

# -- Commit patterns ----------------------------------------------------------
# Match `git commit` short output: [branch hash] message
_RE_COMMIT_SHORT = re.compile(r"\[[\w/.-]+\s+([0-9a-f]{7,40})\]")
# Match lines containing a bare 40-char or 7+ char hex hash after "commit"
_RE_COMMIT_LONG = re.compile(r"(?:^|\s)commit\s+([0-9a-f]{7,40})\b", re.IGNORECASE)
# Match "Creating commit <hash>" or similar Claude output
_RE_COMMIT_CREATING = re.compile(r"creating\s+commit\s+([0-9a-f]{7,40})", re.IGNORECASE)

_COMMIT_PATTERNS = [_RE_COMMIT_SHORT, _RE_COMMIT_LONG, _RE_COMMIT_CREATING]

# -- Plan patterns ------------------------------------------------------------
_RE_PLAN_PREFIX = re.compile(r"^\s*(?:PLAN|Plan)\s*:\s*(.*)", re.DOTALL)

# -- Error patterns -----------------------------------------------------------
_RE_TRACEBACK = re.compile(r"^\s*Traceback\s+\(most recent call last\)", re.IGNORECASE)
_RE_EXCEPTION = re.compile(
    r"^\s*(?:\w+\.)*\w*(?:Error|Exception|Failure|Fatal|Interrupt|Warning|NotFound|Refused|Timeout)\b.*:\s*",
    re.IGNORECASE,
)
_RE_ERROR_PREFIX = re.compile(r"^\s*(?:ERROR|Error|error)\s*[:\[]", re.IGNORECASE)
_RE_PYTEST_FAIL = re.compile(r"^\s*(?:FAILED|ERRORS?)\s+", re.IGNORECASE)

_ERROR_PATTERNS = [_RE_TRACEBACK, _RE_EXCEPTION, _RE_ERROR_PREFIX, _RE_PYTEST_FAIL]

# -- Iteration boundary patterns ----------------------------------------------
# bedrock_loop.sh: "======================== LOOP 3 ========================"
_RE_LOOP_BOUNDARY = re.compile(r"^=+\s*LOOP\s+(\d+)\s*=+$", re.IGNORECASE)
# Alternative: "iteration 3" or "Iteration: 3"
_RE_ITERATION_BOUNDARY = re.compile(r"^\s*iteration\s*[:\s]+(\d+)", re.IGNORECASE)
# "Running iteration 3..." (from bedrock_loop.sh line 51)
_RE_RUNNING_ITERATION = re.compile(r"^\s*Running\s+iteration\s+(\d+)", re.IGNORECASE)

# -- Timestamp extraction -----------------------------------------------------
_RE_ISO_TIMESTAMP = re.compile(r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}")


class LogParser:
    """Parses individual log lines from Ralph loop container output.

    Classifies each line by type and extracts structured data such as
    commit hashes, plan content, and iteration numbers.
    """

    def parse_line(self, line: str) -> dict:
        """Classify a single log line and extract structured data.

        Returns:
            A dict with keys:
                type:  "commit" | "plan" | "error" | "info"
                content: The meaningful content extracted from the line.
                timestamp: ISO timestamp found in the line, or None.
        """
        stripped = line.strip()
        timestamp = self._extract_timestamp(line)

        # 1. Check for commit patterns
        for pattern in _COMMIT_PATTERNS:
            match = pattern.search(stripped)
            if match:
                return {
                    "type": "commit",
                    "content": stripped,
                    "timestamp": timestamp,
                    "commit_hash": match.group(1),
                }

        # 2. Check for plan lines
        plan_match = _RE_PLAN_PREFIX.match(stripped)
        if plan_match:
            return {
                "type": "plan",
                "content": plan_match.group(1).strip() or stripped,
                "timestamp": timestamp,
            }

        # 3. Check for error patterns
        for pattern in _ERROR_PATTERNS:
            if pattern.search(stripped):
                return {
                    "type": "error",
                    "content": stripped,
                    "timestamp": timestamp,
                }

        # 4. Default to info
        return {
            "type": "info",
            "content": stripped,
            "timestamp": timestamp,
        }

    def parse_iteration_boundary(self, line: str) -> int | None:
        """Detect loop iteration boundary markers.

        Recognises formats emitted by bedrock_loop.sh:
            - ``======================== LOOP 3 ========================``
            - ``Running iteration 3...``
            - ``iteration 3`` / ``Iteration: 3``

        Returns:
            The iteration number if the line is a boundary, else None.
        """
        stripped = line.strip()

        for pattern in (
            _RE_LOOP_BOUNDARY,
            _RE_RUNNING_ITERATION,
            _RE_ITERATION_BOUNDARY,
        ):
            match = pattern.match(stripped)
            if match:
                return int(match.group(1))

        return None

    # -- Helpers --------------------------------------------------------------

    @staticmethod
    def _extract_timestamp(line: str) -> str | None:
        """Extract the first ISO-8601-ish timestamp from a log line."""
        match = _RE_ISO_TIMESTAMP.search(line)
        return match.group(0) if match else None
