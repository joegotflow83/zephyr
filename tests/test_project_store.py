"""Tests for ProjectStore CRUD operations."""

import json

import pytest

from src.lib.config_manager import ConfigManager
from src.lib.models import ProjectConfig
from src.lib.project_store import ProjectStore


@pytest.fixture
def config_manager(tmp_path):
    """ConfigManager using a temporary directory."""
    cm = ConfigManager(config_dir=tmp_path)
    cm.ensure_config_dir()
    return cm


@pytest.fixture
def store(config_manager):
    """Fresh ProjectStore instance."""
    return ProjectStore(config_manager)


@pytest.fixture
def sample_project():
    """A sample ProjectConfig for testing."""
    return ProjectConfig(
        id="abc123",
        name="My Project",
        repo_url="https://github.com/user/repo",
        jtbd="Build a web app",
    )


@pytest.fixture
def sample_project_b():
    """A second sample ProjectConfig."""
    return ProjectConfig(
        id="def456",
        name="Another Project",
        repo_url="/home/user/local-repo",
        jtbd="Automate testing",
        docker_image="python:3.12",
    )


class TestListProjects:
    def test_empty_store_returns_empty_list(self, store):
        assert store.list_projects() == []

    def test_lists_all_added_projects(self, store, sample_project, sample_project_b):
        store.add_project(sample_project)
        store.add_project(sample_project_b)
        projects = store.list_projects()
        assert len(projects) == 2

    def test_projects_sorted_by_name_case_insensitive(
        self, store, sample_project, sample_project_b
    ):
        store.add_project(sample_project)  # "My Project"
        store.add_project(sample_project_b)  # "Another Project"
        projects = store.list_projects()
        assert projects[0].name == "Another Project"
        assert projects[1].name == "My Project"


class TestGetProject:
    def test_returns_project_by_id(self, store, sample_project):
        store.add_project(sample_project)
        result = store.get_project("abc123")
        assert result is not None
        assert result.id == "abc123"
        assert result.name == "My Project"
        assert result.repo_url == "https://github.com/user/repo"

    def test_returns_none_for_missing_id(self, store):
        assert store.get_project("nonexistent") is None

    def test_preserves_all_fields(self, store, sample_project):
        store.add_project(sample_project)
        result = store.get_project("abc123")
        assert result.jtbd == "Build a web app"
        assert result.docker_image == "ubuntu:24.04"
        assert result.custom_prompts == {}


class TestAddProject:
    def test_add_and_retrieve(self, store, sample_project):
        store.add_project(sample_project)
        result = store.get_project(sample_project.id)
        assert result is not None
        assert result.name == sample_project.name

    def test_duplicate_id_raises_value_error(self, store, sample_project):
        store.add_project(sample_project)
        with pytest.raises(ValueError, match="already exists"):
            store.add_project(sample_project)

    def test_persists_to_disk(self, config_manager, sample_project):
        store1 = ProjectStore(config_manager)
        store1.add_project(sample_project)
        # New store instance reads from same file
        store2 = ProjectStore(config_manager)
        result = store2.get_project(sample_project.id)
        assert result is not None
        assert result.name == sample_project.name

    def test_projects_json_structure(self, config_manager, store, sample_project):
        store.add_project(sample_project)
        raw = config_manager.load_json("projects.json")
        assert "projects" in raw
        assert sample_project.id in raw["projects"]
        assert raw["projects"][sample_project.id]["name"] == "My Project"


class TestUpdateProject:
    def test_update_existing_project(self, store, sample_project):
        store.add_project(sample_project)
        sample_project.name = "Renamed Project"
        store.update_project(sample_project)
        result = store.get_project(sample_project.id)
        assert result.name == "Renamed Project"

    def test_update_sets_updated_at(self, store, sample_project):
        store.add_project(sample_project)
        old_updated = sample_project.updated_at
        sample_project.name = "Changed"
        store.update_project(sample_project)
        result = store.get_project(sample_project.id)
        assert result.updated_at >= old_updated

    def test_update_nonexistent_raises_key_error(self, store, sample_project):
        with pytest.raises(KeyError, match="not found"):
            store.update_project(sample_project)

    def test_update_preserves_other_projects(
        self, store, sample_project, sample_project_b
    ):
        store.add_project(sample_project)
        store.add_project(sample_project_b)
        sample_project.name = "Updated"
        store.update_project(sample_project)
        other = store.get_project(sample_project_b.id)
        assert other.name == "Another Project"


class TestRemoveProject:
    def test_remove_existing_project(self, store, sample_project):
        store.add_project(sample_project)
        store.remove_project(sample_project.id)
        assert store.get_project(sample_project.id) is None

    def test_remove_nonexistent_raises_key_error(self, store):
        with pytest.raises(KeyError, match="not found"):
            store.remove_project("nonexistent")

    def test_remove_preserves_other_projects(
        self, store, sample_project, sample_project_b
    ):
        store.add_project(sample_project)
        store.add_project(sample_project_b)
        store.remove_project(sample_project.id)
        assert store.get_project(sample_project_b.id) is not None
        assert len(store.list_projects()) == 1

    def test_remove_persists(self, config_manager, sample_project):
        store = ProjectStore(config_manager)
        store.add_project(sample_project)
        store.remove_project(sample_project.id)
        store2 = ProjectStore(config_manager)
        assert store2.get_project(sample_project.id) is None


class TestEdgeCases:
    def test_corrupted_projects_file_returns_empty(self, config_manager):
        """If projects.json is corrupt, load returns empty → no projects."""
        filepath = config_manager.get_config_dir() / "projects.json"
        filepath.write_text("not valid json", encoding="utf-8")
        store = ProjectStore(config_manager)
        assert store.list_projects() == []

    def test_missing_projects_key_returns_empty(self, config_manager):
        """If projects.json exists but has no 'projects' key."""
        config_manager.save_json("projects.json", {"version": 1})
        store = ProjectStore(config_manager)
        assert store.list_projects() == []

    def test_multiple_add_remove_cycles(self, store):
        """Stress test: add and remove multiple projects."""
        for i in range(10):
            p = ProjectConfig(id=f"id_{i}", name=f"Project {i}", repo_url=f"/repo/{i}")
            store.add_project(p)
        assert len(store.list_projects()) == 10
        for i in range(10):
            store.remove_project(f"id_{i}")
        assert len(store.list_projects()) == 0

    def test_custom_prompts_round_trip(self, store):
        """Custom prompts dict survives save/load."""
        p = ProjectConfig(
            id="prompt_test",
            name="Prompt Test",
            repo_url="/repo",
            custom_prompts={"PROMPT_build.md": "Build instructions here"},
        )
        store.add_project(p)
        result = store.get_project("prompt_test")
        assert result.custom_prompts == {"PROMPT_build.md": "Build instructions here"}
