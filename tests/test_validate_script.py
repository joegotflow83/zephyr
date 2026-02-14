"""Tests for validate.sh — local validation wrapper matching CI checks.

Why these tests exist:
  validate.sh is the primary developer-facing entry point for running tests and
  linting locally. These tests ensure the script stays in sync with the CI
  workflow (ci.yml) and that all documented modes are implemented correctly.
"""

import os
import stat
import subprocess

import pytest

SCRIPT_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "validate.sh"
)


class TestValidateScriptExists:
    """Verify the script exists and is executable."""

    def test_script_file_exists(self):
        assert os.path.isfile(SCRIPT_PATH)

    def test_script_is_executable(self):
        mode = os.stat(SCRIPT_PATH).st_mode
        assert mode & stat.S_IXUSR, "validate.sh should be executable by owner"


class TestValidateScriptContent:
    """Verify the script contains all required modes and settings."""

    @pytest.fixture(autouse=True)
    def _load_script(self):
        with open(SCRIPT_PATH) as f:
            self.content = f.read()

    def test_has_shebang(self):
        assert self.content.startswith("#!/usr/bin/env bash")

    def test_sets_qt_qpa_platform(self):
        assert "QT_QPA_PLATFORM=offscreen" in self.content

    def test_sets_ld_library_path(self):
        assert "LD_LIBRARY_PATH" in self.content

    def test_has_full_mode(self):
        assert "full)" in self.content

    def test_has_targeted_mode(self):
        assert "targeted)" in self.content

    def test_has_lf_mode(self):
        assert "lf)" in self.content

    def test_has_ff_mode(self):
        assert "ff)" in self.content

    def test_has_lint_mode(self):
        assert "lint)" in self.content

    def test_lint_runs_black_check(self):
        assert "black --check src/ tests/" in self.content

    def test_lint_runs_pylint(self):
        assert "pylint src/ --fail-under=7.0" in self.content

    def test_full_mode_runs_pytest(self):
        assert "pytest tests/" in self.content

    def test_lf_mode_uses_last_failed(self):
        assert "--last-failed" in self.content

    def test_ff_mode_uses_failed_first(self):
        assert "--failed-first" in self.content

    def test_default_mode_is_full(self):
        """Default mode (no args) should be 'full'."""
        assert "${1:-full}" in self.content or ":-full" in self.content

    def test_unknown_mode_exits_nonzero(self):
        """An unknown mode should print usage and exit 1."""
        assert "exit 1" in self.content

    def test_uses_set_euo_pipefail(self):
        """Script should use strict mode for safety."""
        assert "set -euo pipefail" in self.content


class TestValidateScriptExecution:
    """Verify the script actually runs correctly for key modes."""

    def test_unknown_mode_returns_nonzero(self):
        result = subprocess.run(
            [SCRIPT_PATH, "nonexistent_mode"],
            capture_output=True,
            text=True,
        )
        assert result.returncode != 0
        assert "Unknown mode" in result.stderr or "Unknown mode" in result.stdout

    def test_help_text_on_unknown_mode(self):
        result = subprocess.run(
            [SCRIPT_PATH, "badmode"],
            capture_output=True,
            text=True,
        )
        combined = result.stdout + result.stderr
        assert "full" in combined
        assert "lint" in combined

    def test_targeted_mode_runs_single_test(self):
        """targeted mode should run a specific test file successfully."""
        result = subprocess.run(
            [
                SCRIPT_PATH,
                "targeted",
                "tests/test_validate_script.py::TestValidateScriptExists::test_script_file_exists",
            ],
            capture_output=True,
            text=True,
            timeout=60,
        )
        assert result.returncode == 0
        assert "1 passed" in result.stdout
