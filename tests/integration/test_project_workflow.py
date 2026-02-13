"""Integration tests for the project management workflow.

Tests the full project lifecycle using real file I/O against temp
directories — no mocks for ConfigManager or ProjectStore. This
validates that the layers compose correctly end-to-end:

  ConfigManager (file I/O) -> ProjectStore (CRUD) -> import/export (zip)

Why integration tests matter here:
  Unit tests mock the layer below, so they can't catch serialization
  mismatches, path handling bugs, or atomic-write race conditions.
  These tests exercise the real filesystem to catch those issues.
"""

import json
import zipfile
from pathlib import Path

import pytest

from src.lib.config_manager import ConfigManager
from src.lib.import_export import export_config, import_config
from src.lib.models import AppSettings, ProjectConfig
from src.lib.project_store import ProjectStore


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def config_dir(tmp_path):
    """Provide a fresh temp config directory."""
    return tmp_path / "zephyr-config"


@pytest.fixture
def config_manager(config_dir):
    """ConfigManager backed by a temp directory."""
    cm = ConfigManager(config_dir=config_dir)
    cm.ensure_config_dir()
    return cm


@pytest.fixture
def project_store(config_manager):
    """ProjectStore wired to the temp ConfigManager."""
    return ProjectStore(config_manager)


@pytest.fixture
def sample_project():
    """A fully-populated ProjectConfig for testing."""
    return ProjectConfig(
        name="My App",
        repo_url="https://github.com/user/my-app.git",
        jtbd="Automate builds and testing for my-app",
        custom_prompts={
            "PROMPT_build.md": "Build and run all tests",
            "PROMPT_review.md": "Review the latest PR",
        },
        docker_image="python:3.12-slim",
    )


@pytest.fixture
def second_project():
    """A second project for multi-project scenarios."""
    return ProjectConfig(
        name="Backend API",
        repo_url="/home/user/repos/backend",
        jtbd="Keep the backend passing CI",
        docker_image="node:20",
    )


# ---------------------------------------------------------------------------
# 1. Full CRUD lifecycle
# ---------------------------------------------------------------------------

class TestProjectCRUDLifecycle:
    """End-to-end: add -> list -> get -> edit -> persist -> delete."""

    def test_add_project_appears_in_list(self, project_store, sample_project):
        project_store.add_project(sample_project)

        projects = project_store.list_projects()
        assert len(projects) == 1
        assert projects[0].id == sample_project.id
        assert projects[0].name == "My App"

    def test_get_project_returns_full_data(self, project_store, sample_project):
        project_store.add_project(sample_project)

        fetched = project_store.get_project(sample_project.id)
        assert fetched is not None
        assert fetched.name == sample_project.name
        assert fetched.repo_url == sample_project.repo_url
        assert fetched.jtbd == sample_project.jtbd
        assert fetched.custom_prompts == sample_project.custom_prompts
        assert fetched.docker_image == sample_project.docker_image

    def test_edit_project_persists_changes(self, project_store, sample_project):
        project_store.add_project(sample_project)

        # Mutate and update
        sample_project.name = "My App v2"
        sample_project.jtbd = "Updated JTBD"
        sample_project.docker_image = "ubuntu:24.04"
        sample_project.custom_prompts["PROMPT_deploy.md"] = "Deploy to prod"
        project_store.update_project(sample_project)

        fetched = project_store.get_project(sample_project.id)
        assert fetched.name == "My App v2"
        assert fetched.jtbd == "Updated JTBD"
        assert fetched.docker_image == "ubuntu:24.04"
        assert "PROMPT_deploy.md" in fetched.custom_prompts
        # updated_at should have been refreshed
        assert fetched.updated_at != fetched.created_at

    def test_delete_project_removes_from_store(self, project_store, sample_project):
        project_store.add_project(sample_project)
        project_store.remove_project(sample_project.id)

        assert project_store.get_project(sample_project.id) is None
        assert project_store.list_projects() == []

    def test_full_crud_cycle(self, project_store, sample_project):
        """Add -> list -> edit -> verify -> delete -> verify gone."""
        # Add
        project_store.add_project(sample_project)
        assert len(project_store.list_projects()) == 1

        # Edit
        sample_project.name = "Renamed"
        project_store.update_project(sample_project)
        assert project_store.get_project(sample_project.id).name == "Renamed"

        # Delete
        project_store.remove_project(sample_project.id)
        assert project_store.list_projects() == []

    def test_multiple_projects_sorted_by_name(
        self, project_store, sample_project, second_project
    ):
        project_store.add_project(sample_project)
        project_store.add_project(second_project)

        projects = project_store.list_projects()
        assert len(projects) == 2
        # Sorted alphabetically: "Backend API" < "My App"
        assert projects[0].name == "Backend API"
        assert projects[1].name == "My App"

    def test_duplicate_id_raises(self, project_store, sample_project):
        project_store.add_project(sample_project)
        with pytest.raises(ValueError, match="already exists"):
            project_store.add_project(sample_project)

    def test_remove_nonexistent_raises(self, project_store):
        with pytest.raises(KeyError, match="not found"):
            project_store.remove_project("nonexistent-id")

    def test_update_nonexistent_raises(self, project_store, sample_project):
        with pytest.raises(KeyError, match="not found"):
            project_store.update_project(sample_project)


# ---------------------------------------------------------------------------
# 2. Persistence across store instances
# ---------------------------------------------------------------------------

class TestPersistenceAcrossInstances:
    """Verify data survives creating a new ProjectStore on the same dir."""

    def test_data_survives_new_store_instance(self, config_manager, sample_project):
        store1 = ProjectStore(config_manager)
        store1.add_project(sample_project)

        # New store, same config dir
        store2 = ProjectStore(config_manager)
        projects = store2.list_projects()
        assert len(projects) == 1
        assert projects[0].id == sample_project.id

    def test_edits_visible_to_new_instance(self, config_manager, sample_project):
        store1 = ProjectStore(config_manager)
        store1.add_project(sample_project)
        sample_project.name = "Changed"
        store1.update_project(sample_project)

        store2 = ProjectStore(config_manager)
        assert store2.get_project(sample_project.id).name == "Changed"

    def test_delete_reflected_in_new_instance(self, config_manager, sample_project):
        store1 = ProjectStore(config_manager)
        store1.add_project(sample_project)
        store1.remove_project(sample_project.id)

        store2 = ProjectStore(config_manager)
        assert store2.list_projects() == []


# ---------------------------------------------------------------------------
# 3. Raw file verification
# ---------------------------------------------------------------------------

class TestRawFileIntegrity:
    """Verify the on-disk JSON structure matches expectations."""

    def test_projects_json_structure(self, config_manager, project_store, sample_project):
        project_store.add_project(sample_project)

        raw = config_manager.load_json("projects.json")
        assert "projects" in raw
        assert sample_project.id in raw["projects"]

        entry = raw["projects"][sample_project.id]
        assert entry["name"] == "My App"
        assert entry["repo_url"] == "https://github.com/user/my-app.git"
        assert entry["docker_image"] == "python:3.12-slim"
        assert "PROMPT_build.md" in entry["custom_prompts"]

    def test_projects_json_is_valid_json(self, config_manager, project_store, sample_project):
        project_store.add_project(sample_project)

        filepath = config_manager.get_config_dir() / "projects.json"
        raw_text = filepath.read_text(encoding="utf-8")
        data = json.loads(raw_text)
        assert isinstance(data, dict)
        assert "projects" in data

    def test_empty_store_has_no_file(self, config_manager, project_store):
        """Before any add, projects.json should not exist."""
        filepath = config_manager.get_config_dir() / "projects.json"
        assert not filepath.exists()

    def test_empty_store_list_returns_empty(self, project_store):
        assert project_store.list_projects() == []


# ---------------------------------------------------------------------------
# 4. Export/Import round-trip
# ---------------------------------------------------------------------------

class TestExportImportRoundTrip:
    """Full export -> import into fresh dir -> verify data matches."""

    def test_export_creates_valid_zip(
        self, config_manager, project_store, sample_project, tmp_path
    ):
        project_store.add_project(sample_project)

        zip_path = tmp_path / "export" / "backup.zip"
        result = export_config(config_manager, zip_path)

        assert result.exists()
        assert zipfile.is_zipfile(result)

        with zipfile.ZipFile(result) as zf:
            assert "projects.json" in zf.namelist()

    def test_round_trip_preserves_project_data(
        self, config_manager, project_store, sample_project, second_project, tmp_path
    ):
        """Add projects -> export -> import to fresh dir -> verify match."""
        project_store.add_project(sample_project)
        project_store.add_project(second_project)

        # Export
        zip_path = tmp_path / "backup.zip"
        export_config(config_manager, zip_path)

        # Import into a completely fresh config directory
        fresh_dir = tmp_path / "fresh-config"
        fresh_cm = ConfigManager(config_dir=fresh_dir)
        fresh_cm.ensure_config_dir()

        summary = import_config(fresh_cm, zip_path)
        assert summary["projects_count"] == 2
        assert "projects.json" in summary["files"]

        # Verify via a new ProjectStore on the fresh dir
        fresh_store = ProjectStore(fresh_cm)
        imported = fresh_store.list_projects()
        assert len(imported) == 2

        # Find the imported sample project and compare fields
        imported_sample = fresh_store.get_project(sample_project.id)
        assert imported_sample is not None
        assert imported_sample.name == sample_project.name
        assert imported_sample.repo_url == sample_project.repo_url
        assert imported_sample.jtbd == sample_project.jtbd
        assert imported_sample.custom_prompts == sample_project.custom_prompts
        assert imported_sample.docker_image == sample_project.docker_image

        imported_second = fresh_store.get_project(second_project.id)
        assert imported_second is not None
        assert imported_second.name == second_project.name

    def test_export_includes_settings(self, config_manager, tmp_path):
        """settings.json is included in the export if present."""
        settings = AppSettings(
            max_concurrent_containers=3,
            notification_enabled=False,
            theme="dark",
            log_level="DEBUG",
        )
        config_manager.save_json("settings.json", settings.to_dict())

        zip_path = tmp_path / "backup.zip"
        export_config(config_manager, zip_path)

        with zipfile.ZipFile(zip_path) as zf:
            assert "settings.json" in zf.namelist()

    def test_import_settings_round_trip(self, config_manager, tmp_path):
        """Settings survive export/import."""
        original = AppSettings(
            max_concurrent_containers=2,
            notification_enabled=False,
            theme="light",
            log_level="WARNING",
        )
        config_manager.save_json("settings.json", original.to_dict())

        zip_path = tmp_path / "backup.zip"
        export_config(config_manager, zip_path)

        fresh_dir = tmp_path / "fresh"
        fresh_cm = ConfigManager(config_dir=fresh_dir)
        fresh_cm.ensure_config_dir()
        summary = import_config(fresh_cm, zip_path)

        assert summary["has_settings"] is True
        loaded = AppSettings.from_dict(fresh_cm.load_json("settings.json"))
        assert loaded.max_concurrent_containers == 2
        assert loaded.notification_enabled is False
        assert loaded.theme == "light"
        assert loaded.log_level == "WARNING"

    def test_import_into_dir_with_existing_file_raises(
        self, config_manager, project_store, sample_project, tmp_path
    ):
        """Import should raise FileExistsError on conflict."""
        project_store.add_project(sample_project)

        zip_path = tmp_path / "backup.zip"
        export_config(config_manager, zip_path)

        # Try importing back into the SAME dir (which already has projects.json)
        with pytest.raises(FileExistsError, match="conflicts"):
            import_config(config_manager, zip_path)

    def test_import_corrupt_zip_raises(self, config_manager, tmp_path):
        """Corrupted zip files are rejected cleanly."""
        bad_zip = tmp_path / "bad.zip"
        bad_zip.write_bytes(b"this is not a zip file")

        with pytest.raises(zipfile.BadZipFile):
            import_config(config_manager, bad_zip)

    def test_import_missing_file_raises(self, config_manager, tmp_path):
        """Missing zip path raises FileNotFoundError."""
        with pytest.raises(FileNotFoundError):
            import_config(config_manager, tmp_path / "nonexistent.zip")

    def test_export_nonexistent_dir_raises(self, tmp_path):
        """Export from a dir that doesn't exist should raise."""
        cm = ConfigManager(config_dir=tmp_path / "nope")
        with pytest.raises(FileNotFoundError):
            export_config(cm, tmp_path / "out.zip")


# ---------------------------------------------------------------------------
# 5. Export with custom prompt files
# ---------------------------------------------------------------------------

class TestExportWithPromptFiles:
    """Verify custom prompt .md files are bundled in exports."""

    def test_md_files_included_in_export(self, config_manager, tmp_path):
        """Markdown files in the config dir are exported."""
        config_dir = config_manager.get_config_dir()
        (config_dir / "CUSTOM.md").write_text("custom content", encoding="utf-8")

        zip_path = tmp_path / "backup.zip"
        export_config(config_manager, zip_path)

        with zipfile.ZipFile(zip_path) as zf:
            assert "CUSTOM.md" in zf.namelist()

    def test_prompts_subdir_included_in_export(self, config_manager, tmp_path):
        """Files in the prompts/ subdirectory are exported."""
        prompts_dir = config_manager.get_config_dir() / "prompts"
        prompts_dir.mkdir()
        (prompts_dir / "build.md").write_text("build prompt", encoding="utf-8")

        zip_path = tmp_path / "backup.zip"
        export_config(config_manager, zip_path)

        with zipfile.ZipFile(zip_path) as zf:
            assert "prompts/build.md" in zf.namelist()

    def test_prompt_files_survive_round_trip(self, config_manager, tmp_path):
        """Custom prompt files are importable after export."""
        prompts_dir = config_manager.get_config_dir() / "prompts"
        prompts_dir.mkdir()
        (prompts_dir / "review.md").write_text("Review code", encoding="utf-8")

        zip_path = tmp_path / "backup.zip"
        export_config(config_manager, zip_path)

        fresh_dir = tmp_path / "fresh"
        fresh_cm = ConfigManager(config_dir=fresh_dir)
        fresh_cm.ensure_config_dir()
        import_config(fresh_cm, zip_path)

        imported_file = fresh_dir / "prompts" / "review.md"
        assert imported_file.exists()
        assert imported_file.read_text(encoding="utf-8") == "Review code"


# ---------------------------------------------------------------------------
# 6. ConfigManager direct integration
# ---------------------------------------------------------------------------

class TestConfigManagerIntegration:
    """Verify ConfigManager works correctly with real filesystem."""

    def test_ensure_creates_nested_dir(self, tmp_path):
        deep_dir = tmp_path / "a" / "b" / "c"
        cm = ConfigManager(config_dir=deep_dir)
        result = cm.ensure_config_dir()
        assert result.is_dir()

    def test_save_load_round_trip(self, config_manager):
        data = {"key": "value", "nested": {"a": 1}}
        config_manager.save_json("test.json", data)
        loaded = config_manager.load_json("test.json")
        assert loaded == data

    def test_load_missing_returns_empty_dict(self, config_manager):
        assert config_manager.load_json("nonexistent.json") == {}

    def test_save_overwrites_existing(self, config_manager):
        config_manager.save_json("data.json", {"v": 1})
        config_manager.save_json("data.json", {"v": 2})
        assert config_manager.load_json("data.json") == {"v": 2}

    def test_atomic_write_doesnt_leave_temp_files(self, config_manager):
        config_manager.save_json("clean.json", {"ok": True})
        config_dir = config_manager.get_config_dir()
        temp_files = list(config_dir.glob(".clean.json.*.tmp"))
        assert temp_files == []


# ---------------------------------------------------------------------------
# 7. Edge cases and concurrent-store scenarios
# ---------------------------------------------------------------------------

class TestEdgeCases:
    """Edge cases: empty fields, special characters, large data."""

    def test_project_with_empty_optional_fields(self, project_store):
        project = ProjectConfig(
            name="Minimal",
            repo_url="https://example.com/repo.git",
        )
        project_store.add_project(project)
        fetched = project_store.get_project(project.id)
        assert fetched.jtbd == ""
        assert fetched.custom_prompts == {}
        assert fetched.docker_image == "ubuntu:24.04"

    def test_project_name_with_special_characters(self, project_store):
        project = ProjectConfig(
            name="My App (v2.0) — 日本語テスト",
            repo_url="https://example.com/repo.git",
        )
        project_store.add_project(project)
        fetched = project_store.get_project(project.id)
        assert fetched.name == "My App (v2.0) — 日本語テスト"

    def test_large_custom_prompts(self, project_store):
        big_prompt = "x" * 100_000
        project = ProjectConfig(
            name="Big Prompts",
            repo_url="https://example.com/repo.git",
            custom_prompts={"PROMPT.md": big_prompt},
        )
        project_store.add_project(project)
        fetched = project_store.get_project(project.id)
        assert len(fetched.custom_prompts["PROMPT.md"]) == 100_000

    def test_concurrent_stores_see_each_others_writes(self, config_manager):
        """Two ProjectStore instances on the same dir stay in sync."""
        store_a = ProjectStore(config_manager)
        store_b = ProjectStore(config_manager)

        p1 = ProjectConfig(name="From A", repo_url="https://a.com")
        store_a.add_project(p1)

        # store_b should see p1 because it reads from disk each time
        projects = store_b.list_projects()
        assert len(projects) == 1
        assert projects[0].name == "From A"

        p2 = ProjectConfig(name="From B", repo_url="https://b.com")
        store_b.add_project(p2)

        # store_a sees both
        assert len(store_a.list_projects()) == 2
