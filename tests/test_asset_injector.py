"""Tests for the shared asset injector (src/lib/asset_injector.py).

Verifies that:
- Injection directory is populated with the correct files.
- Project custom prompts override defaults (AGENTS.md, PROMPT_build.md).
- The app-level AGENTS.md is used when no project override exists.
- PROMPT_build.md is included by default when not overridden.
- get_mount_config returns the correct Docker volume mapping.
- cleanup removes the temporary injection directory.
- Errors during preparation don't leak temp directories.
"""

import os
import textwrap
from pathlib import Path

import pytest

from src.lib.asset_injector import (
    CONTAINER_MOUNT_TARGET,
    DEFAULT_PROMPT_BUILD,
    AssetInjector,
)
from src.lib.config_manager import ConfigManager
from src.lib.models import ProjectConfig


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def config_dir(tmp_path):
    """Provide a temporary config directory."""
    d = tmp_path / "config"
    d.mkdir()
    return d


@pytest.fixture
def config_manager(config_dir):
    """ConfigManager backed by a temp directory."""
    return ConfigManager(config_dir=config_dir)


@pytest.fixture
def app_agents_md(tmp_path):
    """Create a fake app-level AGENTS.md and return its path."""
    p = tmp_path / "AGENTS.md"
    p.write_text("# App AGENTS.md\nDefault agent instructions.\n", encoding="utf-8")
    return p


@pytest.fixture
def injector(config_manager, app_agents_md):
    """AssetInjector wired to temp dirs."""
    return AssetInjector(config_manager, agents_md_path=app_agents_md)


@pytest.fixture
def sample_project():
    """A basic ProjectConfig with no custom prompts."""
    return ProjectConfig(name="test-project", repo_url="/tmp/repo")


@pytest.fixture
def project_with_custom_prompts():
    """A ProjectConfig that overrides several prompts."""
    return ProjectConfig(
        name="custom-project",
        repo_url="/tmp/repo",
        custom_prompts={
            "PROMPT_build.md": "# Custom build\nDo something special.\n",
            "PROMPT_review.md": "# Review\nCheck quality.\n",
        },
    )


@pytest.fixture
def project_with_agents_override():
    """A ProjectConfig that overrides AGENTS.md."""
    return ProjectConfig(
        name="agents-override",
        repo_url="/tmp/repo",
        custom_prompts={
            "AGENTS.md": "# Project-specific AGENTS.md\nCustom agents.\n",
        },
    )


# ---------------------------------------------------------------------------
# Tests: prepare_injection_dir — default behaviour
# ---------------------------------------------------------------------------


class TestPrepareInjectionDirDefaults:
    """Test injection with no custom prompts — just defaults."""

    def test_creates_temp_directory(self, injector, sample_project):
        injection_dir = injector.prepare_injection_dir(sample_project)
        try:
            assert injection_dir.is_dir()
        finally:
            injector.cleanup(injection_dir)

    def test_contains_agents_md_from_app(self, injector, sample_project, app_agents_md):
        injection_dir = injector.prepare_injection_dir(sample_project)
        try:
            agents = injection_dir / "AGENTS.md"
            assert agents.exists()
            assert agents.read_text(encoding="utf-8") == app_agents_md.read_text(
                encoding="utf-8"
            )
        finally:
            injector.cleanup(injection_dir)

    def test_contains_default_prompt_build(self, injector, sample_project):
        injection_dir = injector.prepare_injection_dir(sample_project)
        try:
            pb = injection_dir / "PROMPT_build.md"
            assert pb.exists()
            assert pb.read_text(encoding="utf-8") == DEFAULT_PROMPT_BUILD
        finally:
            injector.cleanup(injection_dir)

    def test_no_extra_files(self, injector, sample_project):
        """Only AGENTS.md and PROMPT_build.md should be present."""
        injection_dir = injector.prepare_injection_dir(sample_project)
        try:
            files = sorted(f.name for f in injection_dir.iterdir())
            assert files == ["AGENTS.md", "PROMPT_build.md"]
        finally:
            injector.cleanup(injection_dir)


# ---------------------------------------------------------------------------
# Tests: prepare_injection_dir — custom prompts
# ---------------------------------------------------------------------------


class TestPrepareInjectionDirCustomPrompts:
    """Test injection when the project defines custom prompts."""

    def test_custom_prompt_build_overrides_default(
        self, injector, project_with_custom_prompts
    ):
        injection_dir = injector.prepare_injection_dir(project_with_custom_prompts)
        try:
            pb = injection_dir / "PROMPT_build.md"
            assert pb.exists()
            assert pb.read_text(encoding="utf-8") == "# Custom build\nDo something special.\n"
        finally:
            injector.cleanup(injection_dir)

    def test_extra_custom_prompts_written(
        self, injector, project_with_custom_prompts
    ):
        injection_dir = injector.prepare_injection_dir(project_with_custom_prompts)
        try:
            review = injection_dir / "PROMPT_review.md"
            assert review.exists()
            assert review.read_text(encoding="utf-8") == "# Review\nCheck quality.\n"
        finally:
            injector.cleanup(injection_dir)

    def test_agents_md_still_from_app_when_not_overridden(
        self, injector, project_with_custom_prompts, app_agents_md
    ):
        injection_dir = injector.prepare_injection_dir(project_with_custom_prompts)
        try:
            agents = injection_dir / "AGENTS.md"
            assert agents.exists()
            assert agents.read_text(encoding="utf-8") == app_agents_md.read_text(
                encoding="utf-8"
            )
        finally:
            injector.cleanup(injection_dir)

    def test_all_expected_files_present(
        self, injector, project_with_custom_prompts
    ):
        injection_dir = injector.prepare_injection_dir(project_with_custom_prompts)
        try:
            files = sorted(f.name for f in injection_dir.iterdir())
            assert files == ["AGENTS.md", "PROMPT_build.md", "PROMPT_review.md"]
        finally:
            injector.cleanup(injection_dir)


# ---------------------------------------------------------------------------
# Tests: prepare_injection_dir — AGENTS.md override
# ---------------------------------------------------------------------------


class TestPrepareInjectionDirAgentsOverride:
    """Test that a project can override AGENTS.md."""

    def test_project_agents_md_used(
        self, injector, project_with_agents_override
    ):
        injection_dir = injector.prepare_injection_dir(project_with_agents_override)
        try:
            agents = injection_dir / "AGENTS.md"
            assert agents.exists()
            assert agents.read_text(encoding="utf-8") == (
                "# Project-specific AGENTS.md\nCustom agents.\n"
            )
        finally:
            injector.cleanup(injection_dir)

    def test_app_agents_md_not_used_when_overridden(
        self, injector, project_with_agents_override, app_agents_md
    ):
        injection_dir = injector.prepare_injection_dir(project_with_agents_override)
        try:
            agents = injection_dir / "AGENTS.md"
            content = agents.read_text(encoding="utf-8")
            assert content != app_agents_md.read_text(encoding="utf-8")
        finally:
            injector.cleanup(injection_dir)


# ---------------------------------------------------------------------------
# Tests: missing app AGENTS.md
# ---------------------------------------------------------------------------


class TestMissingAppAgentsMd:
    """When the app-level AGENTS.md doesn't exist on disk."""

    def test_no_agents_md_when_app_file_missing(self, config_manager, sample_project):
        missing_path = Path("/nonexistent/AGENTS.md")
        inj = AssetInjector(config_manager, agents_md_path=missing_path)
        injection_dir = inj.prepare_injection_dir(sample_project)
        try:
            agents = injection_dir / "AGENTS.md"
            assert not agents.exists()
        finally:
            inj.cleanup(injection_dir)

    def test_prompt_build_still_written_when_agents_missing(
        self, config_manager, sample_project
    ):
        missing_path = Path("/nonexistent/AGENTS.md")
        inj = AssetInjector(config_manager, agents_md_path=missing_path)
        injection_dir = inj.prepare_injection_dir(sample_project)
        try:
            pb = injection_dir / "PROMPT_build.md"
            assert pb.exists()
        finally:
            inj.cleanup(injection_dir)

    def test_project_override_used_even_when_app_missing(
        self, config_manager, project_with_agents_override
    ):
        missing_path = Path("/nonexistent/AGENTS.md")
        inj = AssetInjector(config_manager, agents_md_path=missing_path)
        injection_dir = inj.prepare_injection_dir(project_with_agents_override)
        try:
            agents = injection_dir / "AGENTS.md"
            assert agents.exists()
            assert "Project-specific" in agents.read_text(encoding="utf-8")
        finally:
            inj.cleanup(injection_dir)


# ---------------------------------------------------------------------------
# Tests: get_mount_config
# ---------------------------------------------------------------------------


class TestGetMountConfig:
    """Test the Docker volume mount configuration dict."""

    def test_returns_dict_with_correct_bind(self, injector, sample_project):
        injection_dir = injector.prepare_injection_dir(sample_project)
        try:
            config = injector.get_mount_config(injection_dir)
            assert str(injection_dir) in config
            mount = config[str(injection_dir)]
            assert mount["bind"] == CONTAINER_MOUNT_TARGET
            assert mount["mode"] == "ro"
        finally:
            injector.cleanup(injection_dir)

    def test_mount_target_is_home_ralph_app(self, injector, tmp_path):
        config = injector.get_mount_config(tmp_path)
        mount = config[str(tmp_path)]
        assert mount["bind"] == "/home/ralph/app"

    def test_mount_mode_is_readonly(self, injector, tmp_path):
        config = injector.get_mount_config(tmp_path)
        mount = config[str(tmp_path)]
        assert mount["mode"] == "ro"


# ---------------------------------------------------------------------------
# Tests: cleanup
# ---------------------------------------------------------------------------


class TestCleanup:
    """Test cleanup removes the injection directory."""

    def test_removes_directory(self, injector, sample_project):
        injection_dir = injector.prepare_injection_dir(sample_project)
        assert injection_dir.exists()
        injector.cleanup(injection_dir)
        assert not injection_dir.exists()

    def test_removes_all_contents(self, injector, project_with_custom_prompts):
        injection_dir = injector.prepare_injection_dir(project_with_custom_prompts)
        injector.cleanup(injection_dir)
        assert not injection_dir.exists()

    def test_cleanup_nonexistent_is_noop(self, injector, tmp_path):
        """Cleaning up a dir that doesn't exist should not raise."""
        fake_dir = tmp_path / "does-not-exist"
        injector.cleanup(fake_dir)  # should not raise

    def test_cleanup_idempotent(self, injector, sample_project):
        """Calling cleanup twice should not raise."""
        injection_dir = injector.prepare_injection_dir(sample_project)
        injector.cleanup(injection_dir)
        injector.cleanup(injection_dir)  # second call is a no-op


# ---------------------------------------------------------------------------
# Tests: error handling
# ---------------------------------------------------------------------------


class TestErrorHandling:
    """Test that errors during prepare don't leak temp directories."""

    def test_cleanup_on_write_error(self, config_manager, tmp_path, monkeypatch):
        """If writing a file fails, the temp dir should be cleaned up."""
        agents_path = tmp_path / "AGENTS.md"
        agents_path.write_text("ok", encoding="utf-8")
        inj = AssetInjector(config_manager, agents_md_path=agents_path)

        # Make a project with a custom prompt that will trigger an error
        # by monkeypatching Path.write_text to raise mid-way.
        project = ProjectConfig(
            name="fail-project",
            repo_url="/tmp/repo",
            custom_prompts={"bad.md": "content"},
        )

        original_write_text = Path.write_text
        call_count = 0

        def exploding_write_text(self_path, *args, **kwargs):
            nonlocal call_count
            call_count += 1
            # Fail on the second write_text call (custom prompt write).
            if call_count >= 2:
                raise OSError("Simulated disk full")
            return original_write_text(self_path, *args, **kwargs)

        monkeypatch.setattr(Path, "write_text", exploding_write_text)

        with pytest.raises(OSError, match="Simulated disk full"):
            inj.prepare_injection_dir(project)

        # Verify no leaked temp dirs with our prefix.
        import tempfile as _tf

        temp_root = Path(_tf.gettempdir())
        leaked = [
            d
            for d in temp_root.iterdir()
            if d.is_dir() and d.name.startswith("zephyr-inject-")
        ]
        # There should be no leaked directories (cleanup ran).
        # Note: other tests might leave dirs, so we only check that
        # the one created during this test was cleaned up.
        assert len(leaked) == 0 or all(
            project.id[:8] not in d.name for d in leaked
        )


# ---------------------------------------------------------------------------
# Tests: nested custom prompt filenames
# ---------------------------------------------------------------------------


class TestNestedCustomPrompts:
    """Custom prompts with subdirectory paths should work."""

    def test_nested_prompt_creates_subdirs(self, injector):
        project = ProjectConfig(
            name="nested",
            repo_url="/tmp/repo",
            custom_prompts={"subdir/PROMPT_deploy.md": "deploy instructions"},
        )
        injection_dir = injector.prepare_injection_dir(project)
        try:
            target = injection_dir / "subdir" / "PROMPT_deploy.md"
            assert target.exists()
            assert target.read_text(encoding="utf-8") == "deploy instructions"
        finally:
            injector.cleanup(injection_dir)


# ---------------------------------------------------------------------------
# Tests: temp directory naming
# ---------------------------------------------------------------------------


class TestTempDirNaming:
    """Verify temp dirs include project ID prefix for debuggability."""

    def test_dir_name_contains_project_id_prefix(self, injector, sample_project):
        injection_dir = injector.prepare_injection_dir(sample_project)
        try:
            assert f"zephyr-inject-{sample_project.id[:8]}" in injection_dir.name
        finally:
            injector.cleanup(injection_dir)


# ---------------------------------------------------------------------------
# Tests: multiple projects don't collide
# ---------------------------------------------------------------------------


class TestMultipleProjects:
    """Each project gets its own isolated injection directory."""

    def test_two_projects_get_different_dirs(self, injector):
        p1 = ProjectConfig(name="proj-a", repo_url="/tmp/a")
        p2 = ProjectConfig(name="proj-b", repo_url="/tmp/b")
        d1 = injector.prepare_injection_dir(p1)
        d2 = injector.prepare_injection_dir(p2)
        try:
            assert d1 != d2
            assert d1.exists()
            assert d2.exists()
        finally:
            injector.cleanup(d1)
            injector.cleanup(d2)
