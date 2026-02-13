"""Tests for log parsing and commit detection (src/lib/log_parser.py).

Feeds real-world log lines — including bedrock_loop.sh output, git commit
output, Python tracebacks, and plan markers — to verify correct type
classification and data extraction.
"""

import pytest

from src.lib.log_parser import LogParser


@pytest.fixture
def parser():
    return LogParser()


# ============================================================================
# parse_line — commit detection
# ============================================================================


class TestParseLineCommit:
    """Commit detection from various git output formats."""

    def test_git_commit_short_format(self, parser):
        """Standard `git commit` output: [branch hash] message."""
        line = "[master abc1234] Add feature X"
        result = parser.parse_line(line)
        assert result["type"] == "commit"
        assert result["commit_hash"] == "abc1234"

    def test_git_commit_full_hash(self, parser):
        """Full 40-char commit hash in `git log`-style output."""
        line = "commit a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"
        result = parser.parse_line(line)
        assert result["type"] == "commit"
        assert result["commit_hash"] == "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"

    def test_git_commit_with_branch_slash(self, parser):
        """Branch name with slash: [feature/foo hash] message."""
        line = "[feature/new-ui 9f8e7d6] Implement settings tab"
        result = parser.parse_line(line)
        assert result["type"] == "commit"
        assert result["commit_hash"] == "9f8e7d6"

    def test_creating_commit_pattern(self, parser):
        """Claude-style output: creating commit <hash>."""
        line = "Creating commit deadbeef in branch main"
        result = parser.parse_line(line)
        assert result["type"] == "commit"
        assert result["commit_hash"] == "deadbeef"

    def test_commit_preserves_full_line_as_content(self, parser):
        """Content field should contain the full stripped line."""
        line = "  [main abcdef0] Fix the bug  "
        result = parser.parse_line(line)
        assert result["content"] == "[main abcdef0] Fix the bug"

    def test_commit_with_timestamp(self, parser):
        """Timestamp in commit line should be extracted."""
        line = "2025-03-15T10:30:00 commit abcdef1234567"
        result = parser.parse_line(line)
        assert result["type"] == "commit"
        assert result["timestamp"] == "2025-03-15T10:30:00"

    def test_commit_without_timestamp(self, parser):
        """No timestamp returns None."""
        line = "[main abcdef0] Fix the bug"
        result = parser.parse_line(line)
        assert result["timestamp"] is None

    def test_seven_char_minimum_hash(self, parser):
        """7 chars is the minimum hash length we detect."""
        line = "[main 1234567] Short hash"
        result = parser.parse_line(line)
        assert result["type"] == "commit"
        assert result["commit_hash"] == "1234567"


# ============================================================================
# parse_line — plan detection
# ============================================================================


class TestParseLinePlan:
    """Plan-prefixed lines."""

    def test_plan_uppercase(self, parser):
        line = "PLAN: Refactor the config module"
        result = parser.parse_line(line)
        assert result["type"] == "plan"
        assert result["content"] == "Refactor the config module"

    def test_plan_titlecase(self, parser):
        line = "Plan: Add validation step"
        result = parser.parse_line(line)
        assert result["type"] == "plan"
        assert result["content"] == "Add validation step"

    def test_plan_with_leading_whitespace(self, parser):
        line = "  PLAN: indented plan line"
        result = parser.parse_line(line)
        assert result["type"] == "plan"
        assert result["content"] == "indented plan line"

    def test_plan_empty_content(self, parser):
        """PLAN: with no trailing content still classified as plan."""
        line = "PLAN:"
        result = parser.parse_line(line)
        assert result["type"] == "plan"

    def test_plan_with_colon_no_space(self, parser):
        line = "PLAN:do something"
        result = parser.parse_line(line)
        assert result["type"] == "plan"
        assert result["content"] == "do something"

    def test_plan_with_timestamp(self, parser):
        line = "2025-01-01 12:00:00 PLAN: scheduled task"
        # Timestamp is in the line but PLAN: prefix won't match because of prefix
        # This line has timestamp before PLAN, so it's info with timestamp
        result = parser.parse_line(line)
        assert result["timestamp"] == "2025-01-01 12:00:00"


# ============================================================================
# parse_line — error detection
# ============================================================================


class TestParseLineError:
    """Error and exception patterns."""

    def test_python_traceback(self, parser):
        line = "Traceback (most recent call last):"
        result = parser.parse_line(line)
        assert result["type"] == "error"

    def test_named_exception(self, parser):
        line = "ValueError: invalid literal for int()"
        result = parser.parse_line(line)
        assert result["type"] == "error"

    def test_module_qualified_exception(self, parser):
        line = "docker.errors.NotFound: 404 Client Error"
        result = parser.parse_line(line)
        assert result["type"] == "error"

    def test_error_prefix_colon(self, parser):
        line = "ERROR: container failed to start"
        result = parser.parse_line(line)
        assert result["type"] == "error"

    def test_error_prefix_bracket(self, parser):
        line = "ERROR[2025-01-01] something went wrong"
        result = parser.parse_line(line)
        assert result["type"] == "error"

    def test_pytest_failed(self, parser):
        line = "FAILED tests/test_foo.py::test_bar - AssertionError"
        result = parser.parse_line(line)
        assert result["type"] == "error"

    def test_runtime_error(self, parser):
        line = "RuntimeError: event loop is closed"
        result = parser.parse_line(line)
        assert result["type"] == "error"

    def test_os_error(self, parser):
        line = "OSError: [Errno 28] No space left on device"
        result = parser.parse_line(line)
        assert result["type"] == "error"

    def test_fatal_error(self, parser):
        line = "Fatal: repository not found"
        result = parser.parse_line(line)
        assert result["type"] == "error"

    def test_indented_traceback(self, parser):
        line = "  Traceback (most recent call last):"
        result = parser.parse_line(line)
        assert result["type"] == "error"


# ============================================================================
# parse_line — info (default)
# ============================================================================


class TestParseLineInfo:
    """Lines that don't match any specific pattern fall through to info."""

    def test_plain_text(self, parser):
        line = "Installing dependencies..."
        result = parser.parse_line(line)
        assert result["type"] == "info"

    def test_empty_line(self, parser):
        result = parser.parse_line("")
        assert result["type"] == "info"
        assert result["content"] == ""

    def test_whitespace_only(self, parser):
        result = parser.parse_line("   ")
        assert result["type"] == "info"
        assert result["content"] == ""

    def test_docker_output(self, parser):
        line = "Step 1/5 : FROM ubuntu:24.04"
        result = parser.parse_line(line)
        assert result["type"] == "info"

    def test_progress_bar(self, parser):
        line = "Downloading: [===========>       ] 60%"
        result = parser.parse_line(line)
        assert result["type"] == "info"

    def test_separator_line(self, parser):
        line = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        result = parser.parse_line(line)
        assert result["type"] == "info"


# ============================================================================
# parse_line — timestamp extraction
# ============================================================================


class TestTimestampExtraction:
    def test_iso_with_t_separator(self, parser):
        line = "2025-03-15T14:30:45 something happened"
        result = parser.parse_line(line)
        assert result["timestamp"] == "2025-03-15T14:30:45"

    def test_iso_with_space_separator(self, parser):
        line = "2025-03-15 14:30:45 something happened"
        result = parser.parse_line(line)
        assert result["timestamp"] == "2025-03-15 14:30:45"

    def test_no_timestamp(self, parser):
        line = "just a regular line"
        result = parser.parse_line(line)
        assert result["timestamp"] is None

    def test_timestamp_embedded_in_middle(self, parser):
        line = "prefix 2025-06-01T08:00:00 suffix"
        result = parser.parse_line(line)
        assert result["timestamp"] == "2025-06-01T08:00:00"


# ============================================================================
# parse_iteration_boundary
# ============================================================================


class TestParseIterationBoundary:
    """Iteration boundary detection from bedrock_loop.sh output."""

    def test_bedrock_loop_format(self, parser):
        """Exact format from bedrock_loop.sh line 118."""
        line = "======================== LOOP 3 ========================"
        result = parser.parse_iteration_boundary(line)
        assert result == 3

    def test_loop_1(self, parser):
        line = "======================== LOOP 1 ========================"
        assert parser.parse_iteration_boundary(line) == 1

    def test_loop_large_number(self, parser):
        line = "======================== LOOP 999 ========================"
        assert parser.parse_iteration_boundary(line) == 999

    def test_loop_with_extra_equals(self, parser):
        """More/fewer equals signs should still match."""
        line = "==== LOOP 5 ===="
        assert parser.parse_iteration_boundary(line) == 5

    def test_running_iteration(self, parser):
        """bedrock_loop.sh line 51: 'Running iteration N...'."""
        line = "Running iteration 7..."
        assert parser.parse_iteration_boundary(line) == 7

    def test_iteration_colon_format(self, parser):
        line = "iteration: 12"
        assert parser.parse_iteration_boundary(line) == 12

    def test_iteration_space_format(self, parser):
        line = "Iteration 4"
        assert parser.parse_iteration_boundary(line) == 4

    def test_not_a_boundary(self, parser):
        """Regular log lines should return None."""
        assert parser.parse_iteration_boundary("Installing deps...") is None

    def test_empty_line(self, parser):
        assert parser.parse_iteration_boundary("") is None

    def test_partial_match_not_boundary(self, parser):
        """'LOOP' embedded in a word should not match."""
        assert parser.parse_iteration_boundary("LOOPING forever") is None

    def test_case_insensitive_loop(self, parser):
        line = "======================== loop 2 ========================"
        assert parser.parse_iteration_boundary(line) == 2

    def test_with_leading_whitespace(self, parser):
        line = "  Running iteration 3..."
        assert parser.parse_iteration_boundary(line) == 3

    def test_with_trailing_newline(self, parser):
        line = "======================== LOOP 10 ========================\n"
        assert parser.parse_iteration_boundary(line) == 10


# ============================================================================
# Edge cases and integration-style tests
# ============================================================================


class TestEdgeCases:
    """Boundary conditions and real-world log sequences."""

    def test_commit_takes_priority_over_info(self, parser):
        """A line with both a commit hash and normal text is 'commit'."""
        line = "[main 1a2b3c4] Update README with install instructions"
        assert parser.parse_line(line)["type"] == "commit"

    def test_error_in_commit_line(self, parser):
        """Commit output always wins over error patterns."""
        line = "[main abc1234] Fix ValueError in parser"
        result = parser.parse_line(line)
        assert result["type"] == "commit"

    def test_plan_takes_priority_over_error(self, parser):
        """PLAN: prefix wins even if the content has error keywords."""
        line = "PLAN: Fix the RuntimeError in loop_runner"
        result = parser.parse_line(line)
        assert result["type"] == "plan"

    def test_multiline_simulation(self, parser):
        """Parsing a sequence of lines from a real session."""
        lines = [
            "======================== LOOP 1 ========================",
            "Running iteration 1...",
            "Installing dependencies...",
            "PLAN: Implement the config manager",
            "Traceback (most recent call last):",
            '  File "test.py", line 10, in test_foo',
            "AssertionError: expected 5 got 4",
            "[main abc1234] Implement config manager",
            "======================== LOOP 2 ========================",
        ]
        types = [parser.parse_line(l)["type"] for l in lines]
        assert types == [
            "info",     # boundary line is info when parsed with parse_line
            "info",     # "Running iteration..." is info
            "info",     # installing
            "plan",     # PLAN: prefix
            "error",    # traceback header
            "info",     # traceback body line (not itself an error marker)
            "error",    # AssertionError
            "commit",   # git commit output
            "info",     # boundary
        ]

        boundaries = [parser.parse_iteration_boundary(l) for l in lines]
        assert boundaries == [1, 1, None, None, None, None, None, None, 2]

    def test_hex_word_not_commit(self, parser):
        """A hex string that isn't in commit context shouldn't match."""
        line = "Downloaded package abcdef1234567890abcdef1234567890abcdef12"
        result = parser.parse_line(line)
        # No commit keyword prefix, so this is info
        assert result["type"] == "info"

    def test_assertion_error_detected(self, parser):
        line = "AssertionError: values don't match"
        result = parser.parse_line(line)
        assert result["type"] == "error"

    def test_keyboard_interrupt_detected(self, parser):
        line = "KeyboardInterrupt: "
        result = parser.parse_line(line)
        assert result["type"] == "error"

    def test_newline_preserved_in_content(self, parser):
        """Content is stripped but functional."""
        line = "  some log output  \n"
        result = parser.parse_line(line)
        assert result["content"] == "some log output"
        assert result["type"] == "info"

    def test_very_long_line(self, parser):
        """Long lines don't cause issues."""
        line = "x" * 10_000
        result = parser.parse_line(line)
        assert result["type"] == "info"
        assert len(result["content"]) == 10_000

    def test_commit_hash_field_only_on_commits(self, parser):
        """Only commit-type results have the commit_hash key."""
        info_result = parser.parse_line("hello world")
        assert "commit_hash" not in info_result

        commit_result = parser.parse_line("[main abc1234] test")
        assert "commit_hash" in commit_result

    def test_parse_line_returns_dict(self, parser):
        """Return value is always a dict with required keys."""
        result = parser.parse_line("anything")
        assert isinstance(result, dict)
        assert "type" in result
        assert "content" in result
        assert "timestamp" in result
