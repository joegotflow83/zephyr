"""Tests for CI workflow configuration (.github/workflows/ci.yml).

Validates that the CI workflow file exists, is valid YAML, and contains
the jobs, triggers, and steps specified in specs/cicd.md.
"""

import yaml
import pytest
from pathlib import Path

WORKFLOW_PATH = Path(__file__).parent.parent / ".github" / "workflows" / "ci.yml"


@pytest.fixture
def workflow():
    """Load and parse the CI workflow YAML."""
    assert WORKFLOW_PATH.exists(), f"CI workflow not found at {WORKFLOW_PATH}"
    with open(WORKFLOW_PATH) as f:
        return yaml.safe_load(f)


class TestCIWorkflowStructure:
    """Top-level workflow structure tests."""

    def test_workflow_file_exists(self):
        assert WORKFLOW_PATH.exists()

    def test_workflow_is_valid_yaml(self):
        with open(WORKFLOW_PATH) as f:
            data = yaml.safe_load(f)
        assert isinstance(data, dict)

    def test_workflow_has_name(self, workflow):
        assert "name" in workflow
        assert workflow["name"] == "CI"

    def test_workflow_has_on_triggers(self, workflow):
        assert "on" in workflow or True in workflow  # YAML parses 'on' as True

    def test_workflow_has_jobs(self, workflow):
        assert "jobs" in workflow
        assert isinstance(workflow["jobs"], dict)


class TestCITriggers:
    """Verify the workflow triggers match the spec."""

    def _get_triggers(self, workflow):
        """Get triggers, handling YAML 'on' → True key issue."""
        return workflow.get("on") or workflow.get(True, {})

    def test_triggers_on_push_to_master(self, workflow):
        triggers = self._get_triggers(workflow)
        assert "push" in triggers
        push = triggers["push"]
        assert "branches" in push
        assert "master" in push["branches"]

    def test_triggers_on_pull_request(self, workflow):
        triggers = self._get_triggers(workflow)
        assert "pull_request" in triggers


class TestTestJob:
    """Verify the 'test' job configuration."""

    @pytest.fixture
    def test_job(self, workflow):
        return workflow["jobs"]["test"]

    def test_test_job_exists(self, workflow):
        assert "test" in workflow["jobs"]

    def test_runs_on_ubuntu(self, test_job):
        assert "ubuntu" in test_job["runs-on"]

    def test_has_steps(self, test_job):
        assert "steps" in test_job
        assert len(test_job["steps"]) > 0

    def test_checks_out_repo(self, test_job):
        checkout_steps = [
            s for s in test_job["steps"]
            if isinstance(s.get("uses"), str) and "checkout" in s["uses"]
        ]
        assert len(checkout_steps) >= 1

    def test_sets_up_python_312(self, test_job):
        python_steps = [
            s for s in test_job["steps"]
            if isinstance(s.get("uses"), str) and "setup-python" in s["uses"]
        ]
        assert len(python_steps) >= 1
        python_step = python_steps[0]
        assert python_step["with"]["python-version"] == "3.12"

    def test_installs_system_qt_deps(self, test_job):
        """Spec requires: libgl1, libegl1, libxkbcommon0, libdbus-1-3, libfontconfig1."""
        apt_steps = [
            s for s in test_job["steps"]
            if isinstance(s.get("run"), str) and "apt-get" in s["run"]
        ]
        assert len(apt_steps) >= 1
        apt_run = apt_steps[0]["run"]
        for pkg in ["libgl1", "libegl1", "libxkbcommon0", "libdbus-1-3", "libfontconfig1"]:
            assert pkg in apt_run, f"Missing system package: {pkg}"

    def test_installs_pip_editable_with_dev(self, test_job):
        pip_steps = [
            s for s in test_job["steps"]
            if isinstance(s.get("run"), str) and "pip install" in s["run"]
        ]
        assert any('.[dev]' in s["run"] for s in pip_steps), \
            "Should install with [dev] extras"

    def test_pyinstaller_in_dev_dependencies(self):
        """Pyinstaller should be in dev dependencies so it's installed with .[dev]."""
        import tomllib
        with open("pyproject.toml", "rb") as f:
            config = tomllib.load(f)
        dev_deps = config["project"]["optional-dependencies"]["dev"]
        assert any("pyinstaller" in dep.lower() for dep in dev_deps), \
            "pyinstaller should be listed in [project.optional-dependencies] dev"

    def test_runs_pytest_with_offscreen(self, test_job):
        pytest_steps = [
            s for s in test_job["steps"]
            if isinstance(s.get("run"), str) and "pytest" in s["run"]
        ]
        assert len(pytest_steps) >= 1
        pytest_run = pytest_steps[0]["run"]
        assert "QT_QPA_PLATFORM=offscreen" in pytest_run

    def test_runs_pytest_with_junitxml(self, test_job):
        pytest_steps = [
            s for s in test_job["steps"]
            if isinstance(s.get("run"), str) and "pytest" in s["run"]
        ]
        pytest_run = pytest_steps[0]["run"]
        assert "--junitxml=test-results.xml" in pytest_run

    def test_uploads_test_results_artifact(self, test_job):
        upload_steps = [
            s for s in test_job["steps"]
            if isinstance(s.get("uses"), str) and "upload-artifact" in s["uses"]
        ]
        assert len(upload_steps) >= 1
        upload_step = upload_steps[0]
        assert upload_step.get("if") == "always()"
        assert "test-results" in upload_step["with"]["name"]


class TestLintJob:
    """Verify the 'lint' job configuration."""

    @pytest.fixture
    def lint_job(self, workflow):
        return workflow["jobs"]["lint"]

    def test_lint_job_exists(self, workflow):
        assert "lint" in workflow["jobs"]

    def test_runs_on_ubuntu(self, lint_job):
        assert "ubuntu" in lint_job["runs-on"]

    def test_has_steps(self, lint_job):
        assert "steps" in lint_job
        assert len(lint_job["steps"]) > 0

    def test_checks_out_repo(self, lint_job):
        checkout_steps = [
            s for s in lint_job["steps"]
            if isinstance(s.get("uses"), str) and "checkout" in s["uses"]
        ]
        assert len(checkout_steps) >= 1

    def test_sets_up_python_312(self, lint_job):
        python_steps = [
            s for s in lint_job["steps"]
            if isinstance(s.get("uses"), str) and "setup-python" in s["uses"]
        ]
        assert len(python_steps) >= 1

    def test_installs_black_and_pylint(self, lint_job):
        pip_steps = [
            s for s in lint_job["steps"]
            if isinstance(s.get("run"), str) and "pip install" in s["run"]
        ]
        assert len(pip_steps) >= 1
        pip_run = pip_steps[0]["run"]
        assert "black" in pip_run
        assert "pylint" in pip_run

    def test_runs_black_check(self, lint_job):
        black_steps = [
            s for s in lint_job["steps"]
            if isinstance(s.get("run"), str) and "black" in s["run"] and "--check" in s["run"]
        ]
        assert len(black_steps) >= 1
        black_run = black_steps[0]["run"]
        assert "src/" in black_run
        assert "tests/" in black_run

    def test_runs_pylint_with_fail_under(self, lint_job):
        pylint_steps = [
            s for s in lint_job["steps"]
            if isinstance(s.get("run"), str)
            and "pylint" in s["run"]
            and "--fail-under" in s["run"]
        ]
        assert len(pylint_steps) >= 1
        pylint_run = pylint_steps[0]["run"]
        assert "--fail-under=7.0" in pylint_run
        assert "src/" in pylint_run
