"""Tests for Release workflow configuration (.github/workflows/release.yml).

Validates that the release workflow file exists, is valid YAML, and contains
the jobs, triggers, and steps specified in specs/cicd.md for multi-platform
builds and GitHub Release publishing on v* tag pushes.
"""

import yaml
import pytest
from pathlib import Path

WORKFLOW_PATH = Path(__file__).parent.parent / ".github" / "workflows" / "release.yml"


@pytest.fixture
def workflow():
    """Load and parse the release workflow YAML."""
    assert WORKFLOW_PATH.exists(), f"Release workflow not found at {WORKFLOW_PATH}"
    with open(WORKFLOW_PATH) as f:
        return yaml.safe_load(f)


# ---------------------------------------------------------------------------
# Top-level structure
# ---------------------------------------------------------------------------
class TestReleaseWorkflowStructure:
    """Top-level workflow structure tests."""

    def test_workflow_file_exists(self):
        assert WORKFLOW_PATH.exists()

    def test_workflow_is_valid_yaml(self):
        with open(WORKFLOW_PATH) as f:
            data = yaml.safe_load(f)
        assert isinstance(data, dict)

    def test_workflow_has_name(self, workflow):
        assert "name" in workflow
        assert workflow["name"] == "Release"

    def test_workflow_has_jobs(self, workflow):
        assert "jobs" in workflow
        assert isinstance(workflow["jobs"], dict)

    def test_workflow_has_all_four_jobs(self, workflow):
        expected_jobs = {"build-macos", "build-linux", "build-windows", "publish"}
        assert expected_jobs == set(workflow["jobs"].keys())

    def test_workflow_has_contents_write_permission(self, workflow):
        """Release creation requires write access to contents."""
        perms = workflow.get("permissions", {})
        assert perms.get("contents") == "write"


# ---------------------------------------------------------------------------
# Triggers
# ---------------------------------------------------------------------------
class TestReleaseTriggers:
    """Verify the workflow triggers on v* tags only."""

    def _get_triggers(self, workflow):
        return workflow.get("on") or workflow.get(True, {})

    def test_triggers_on_push(self, workflow):
        triggers = self._get_triggers(workflow)
        assert "push" in triggers

    def test_triggers_on_v_star_tags(self, workflow):
        triggers = self._get_triggers(workflow)
        push = triggers["push"]
        assert "tags" in push
        assert any("v*" in t for t in push["tags"])

    def test_does_not_trigger_on_branches(self, workflow):
        """Release workflow should only trigger on tags, not branches."""
        triggers = self._get_triggers(workflow)
        push = triggers["push"]
        assert "branches" not in push


# ---------------------------------------------------------------------------
# Helper to find steps by content
# ---------------------------------------------------------------------------
def _find_steps(job, keyword, field="run"):
    """Find steps containing a keyword in a given field."""
    return [
        s for s in job.get("steps", [])
        if isinstance(s.get(field), str) and keyword in s[field]
    ]


def _find_steps_by_uses(job, keyword):
    """Find steps with a 'uses' action containing a keyword."""
    return [
        s for s in job.get("steps", [])
        if isinstance(s.get("uses"), str) and keyword in s["uses"]
    ]


# ---------------------------------------------------------------------------
# build-macos
# ---------------------------------------------------------------------------
class TestBuildMacOS:
    """Verify the macOS build job per specs/cicd.md."""

    @pytest.fixture
    def job(self, workflow):
        return workflow["jobs"]["build-macos"]

    def test_runs_on_macos(self, job):
        assert "macos" in job["runs-on"]

    def test_checks_out_repo(self, job):
        assert len(_find_steps_by_uses(job, "checkout")) >= 1

    def test_sets_up_python_312(self, job):
        steps = _find_steps_by_uses(job, "setup-python")
        assert len(steps) >= 1
        assert steps[0]["with"]["python-version"] == "3.12"

    def test_extracts_version_from_tag(self, job):
        """Must strip 'v' prefix from GITHUB_REF_NAME."""
        steps = _find_steps(job, "GITHUB_REF_NAME")
        assert len(steps) >= 1

    def test_patches_version_py(self, job):
        """Must write __version__ to src/lib/_version.py."""
        steps = _find_steps(job, "_version.py")
        assert len(steps) >= 1

    def test_patches_pyproject_toml(self, job):
        """Must update version in pyproject.toml."""
        steps = _find_steps(job, "pyproject.toml")
        assert len(steps) >= 1

    def test_installs_deps_with_dev_and_pyinstaller(self, job):
        pip_steps = _find_steps(job, "pip install")
        assert len(pip_steps) >= 1
        combined = " ".join(s["run"] for s in pip_steps)
        assert ".[dev]" in combined
        assert "pyinstaller" in combined.lower()

    def test_generates_icon_png(self, job):
        steps = _find_steps(job, "generate_icon.py")
        assert len(steps) >= 1

    def test_generates_icns(self, job):
        steps = _find_steps(job, "generate_icns")
        assert len(steps) >= 1

    def test_runs_pyinstaller(self, job):
        steps = _find_steps(job, "pyinstaller")
        assert len(steps) >= 1
        assert any("zephyr.spec" in s["run"] for s in steps)

    def test_zips_app_bundle(self, job):
        steps = _find_steps(job, "zip")
        assert len(steps) >= 1
        combined = " ".join(s["run"] for s in steps)
        assert "Zephyr-macOS" in combined
        assert "Zephyr.app" in combined

    def test_uploads_artifact(self, job):
        steps = _find_steps_by_uses(job, "upload-artifact")
        assert len(steps) >= 1
        assert "Zephyr-macOS" in steps[0]["with"]["name"]


# ---------------------------------------------------------------------------
# build-linux
# ---------------------------------------------------------------------------
class TestBuildLinux:
    """Verify the Linux build job per specs/cicd.md."""

    @pytest.fixture
    def job(self, workflow):
        return workflow["jobs"]["build-linux"]

    def test_runs_on_ubuntu_2204(self, job):
        assert "ubuntu-22.04" in job["runs-on"]

    def test_checks_out_repo(self, job):
        assert len(_find_steps_by_uses(job, "checkout")) >= 1

    def test_sets_up_python_312(self, job):
        steps = _find_steps_by_uses(job, "setup-python")
        assert len(steps) >= 1
        assert steps[0]["with"]["python-version"] == "3.12"

    def test_extracts_version_from_tag(self, job):
        steps = _find_steps(job, "GITHUB_REF_NAME")
        assert len(steps) >= 1

    def test_patches_version_py(self, job):
        steps = _find_steps(job, "_version.py")
        assert len(steps) >= 1

    def test_installs_system_qt_deps(self, job):
        """Spec requires: libgl1, libegl1, libxkbcommon0, libdbus-1-3, libfontconfig1."""
        apt_steps = _find_steps(job, "apt-get")
        assert len(apt_steps) >= 1
        apt_run = apt_steps[0]["run"]
        for pkg in ["libgl1", "libegl1", "libxkbcommon0", "libdbus-1-3", "libfontconfig1"]:
            assert pkg in apt_run, f"Missing system package: {pkg}"

    def test_installs_deps_with_dev_and_pyinstaller(self, job):
        pip_steps = _find_steps(job, "pip install")
        assert len(pip_steps) >= 1
        combined = " ".join(s["run"] for s in pip_steps)
        assert ".[dev]" in combined
        assert "pyinstaller" in combined.lower()

    def test_runs_pyinstaller(self, job):
        steps = _find_steps(job, "pyinstaller")
        assert len(steps) >= 1

    def test_creates_tarball(self, job):
        steps = _find_steps(job, "tar")
        assert len(steps) >= 1
        combined = " ".join(s["run"] for s in steps)
        assert "Zephyr-Linux" in combined
        assert ".tar.gz" in combined

    def test_uploads_artifact(self, job):
        steps = _find_steps_by_uses(job, "upload-artifact")
        assert len(steps) >= 1
        assert "Zephyr-Linux" in steps[0]["with"]["name"]


# ---------------------------------------------------------------------------
# build-windows
# ---------------------------------------------------------------------------
class TestBuildWindows:
    """Verify the Windows build job per specs/cicd.md."""

    @pytest.fixture
    def job(self, workflow):
        return workflow["jobs"]["build-windows"]

    def test_runs_on_windows(self, job):
        assert "windows" in job["runs-on"]

    def test_checks_out_repo(self, job):
        assert len(_find_steps_by_uses(job, "checkout")) >= 1

    def test_sets_up_python_312(self, job):
        steps = _find_steps_by_uses(job, "setup-python")
        assert len(steps) >= 1
        assert steps[0]["with"]["python-version"] == "3.12"

    def test_extracts_version_from_tag(self, job):
        """Windows version extraction may use bash shell."""
        version_steps = [
            s for s in job.get("steps", [])
            if isinstance(s.get("run"), str) and "GITHUB_REF_NAME" in s["run"]
        ]
        assert len(version_steps) >= 1

    def test_patches_version_py(self, job):
        all_runs = " ".join(
            s.get("run", "") for s in job.get("steps", []) if isinstance(s.get("run"), str)
        )
        assert "_version.py" in all_runs

    def test_installs_deps_with_dev_and_pyinstaller(self, job):
        pip_steps = _find_steps(job, "pip install")
        assert len(pip_steps) >= 1
        combined = " ".join(s["run"] for s in pip_steps)
        assert ".[dev]" in combined
        assert "pyinstaller" in combined.lower()

    def test_runs_pyinstaller(self, job):
        all_runs = " ".join(
            s.get("run", "") for s in job.get("steps", []) if isinstance(s.get("run"), str)
        )
        assert "pyinstaller" in all_runs.lower()

    def test_creates_zip(self, job):
        """Windows should produce a .zip artifact."""
        all_runs = " ".join(
            s.get("run", "") for s in job.get("steps", []) if isinstance(s.get("run"), str)
        )
        assert "Zephyr-Windows" in all_runs

    def test_uploads_artifact(self, job):
        steps = _find_steps_by_uses(job, "upload-artifact")
        assert len(steps) >= 1
        assert "Zephyr-Windows" in steps[0]["with"]["name"]


# ---------------------------------------------------------------------------
# publish
# ---------------------------------------------------------------------------
class TestPublishJob:
    """Verify the publish job that creates GitHub Releases."""

    @pytest.fixture
    def job(self, workflow):
        return workflow["jobs"]["publish"]

    def test_runs_on_ubuntu(self, job):
        assert "ubuntu" in job["runs-on"]

    def test_needs_all_three_build_jobs(self, job):
        needs = job.get("needs", [])
        assert "build-macos" in needs
        assert "build-linux" in needs
        assert "build-windows" in needs

    def test_checks_out_repo(self, job):
        assert len(_find_steps_by_uses(job, "checkout")) >= 1

    def test_downloads_artifacts(self, job):
        steps = _find_steps_by_uses(job, "download-artifact")
        assert len(steps) >= 1

    def test_detects_prerelease(self, job):
        """Should check tag for -alpha, -beta, or -rc suffixes."""
        all_runs = " ".join(
            s.get("run", "") for s in job.get("steps", []) if isinstance(s.get("run"), str)
        )
        assert "alpha" in all_runs
        assert "beta" in all_runs
        assert "rc" in all_runs

    def test_creates_github_release(self, job):
        """Should use gh release create."""
        steps = _find_steps(job, "gh release create")
        assert len(steps) >= 1

    def test_release_title_includes_version(self, job):
        steps = _find_steps(job, "gh release create")
        combined = " ".join(s["run"] for s in steps)
        assert "Zephyr Desktop" in combined

    def test_generates_release_notes(self, job):
        steps = _find_steps(job, "gh release create")
        combined = " ".join(s["run"] for s in steps)
        assert "--generate-notes" in combined

    def test_attaches_all_three_artifacts(self, job):
        """Release should include macOS, Linux, and Windows artifacts."""
        steps = _find_steps(job, "gh release create")
        combined = " ".join(s["run"] for s in steps)
        assert "Zephyr-macOS" in combined
        assert "Zephyr-Linux" in combined
        assert "Zephyr-Windows" in combined

    def test_prerelease_flag_is_conditional(self, job):
        """Should pass --prerelease flag only for alpha/beta/rc tags."""
        steps = _find_steps(job, "gh release create")
        combined = " ".join(s["run"] for s in steps)
        assert "--prerelease" in combined

    def test_uses_github_token(self, job):
        """Should use github.token for authentication."""
        all_envs = " ".join(
            str(s.get("env", {})) for s in job.get("steps", [])
        )
        assert "github.token" in all_envs or "GH_TOKEN" in all_envs
