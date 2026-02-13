"""Tests for ProjectConfig and AppSettings data models."""

from datetime import datetime, timezone

from src.lib.models import AppSettings, ProjectConfig


class TestProjectConfig:
    """Tests for ProjectConfig dataclass."""

    def test_create_with_required_fields(self):
        p = ProjectConfig(name="My Project", repo_url="https://github.com/user/repo")
        assert p.name == "My Project"
        assert p.repo_url == "https://github.com/user/repo"
        assert len(p.id) == 32  # uuid4 hex
        assert p.jtbd == ""
        assert p.custom_prompts == {}
        assert p.docker_image == "ubuntu:24.04"
        assert p.created_at  # non-empty
        assert p.updated_at  # non-empty

    def test_create_with_all_fields(self):
        p = ProjectConfig(
            id="abc123",
            name="Full",
            repo_url="/local/path",
            jtbd="Build a widget",
            custom_prompts={"PROMPT_build.md": "do stuff"},
            docker_image="python:3.12",
            created_at="2025-01-01T00:00:00+00:00",
            updated_at="2025-06-15T12:00:00+00:00",
        )
        assert p.id == "abc123"
        assert p.docker_image == "python:3.12"
        assert p.jtbd == "Build a widget"
        assert p.custom_prompts == {"PROMPT_build.md": "do stuff"}

    def test_to_dict(self):
        p = ProjectConfig(name="Test", repo_url="https://example.com/repo")
        d = p.to_dict()
        assert isinstance(d, dict)
        assert d["name"] == "Test"
        assert d["repo_url"] == "https://example.com/repo"
        assert d["id"] == p.id
        assert d["jtbd"] == ""
        assert d["custom_prompts"] == {}
        assert d["docker_image"] == "ubuntu:24.04"
        assert "created_at" in d
        assert "updated_at" in d

    def test_from_dict_full(self):
        data = {
            "id": "xyz",
            "name": "FromDict",
            "repo_url": "git@github.com:user/repo.git",
            "jtbd": "Automate things",
            "custom_prompts": {"PROMPT_test.md": "run pytest"},
            "docker_image": "node:20",
            "created_at": "2025-01-01T00:00:00+00:00",
            "updated_at": "2025-06-01T00:00:00+00:00",
        }
        p = ProjectConfig.from_dict(data)
        assert p.id == "xyz"
        assert p.name == "FromDict"
        assert p.repo_url == "git@github.com:user/repo.git"
        assert p.jtbd == "Automate things"
        assert p.custom_prompts == {"PROMPT_test.md": "run pytest"}
        assert p.docker_image == "node:20"
        assert p.created_at == "2025-01-01T00:00:00+00:00"
        assert p.updated_at == "2025-06-01T00:00:00+00:00"

    def test_from_dict_minimal(self):
        """Missing optional fields get sensible defaults."""
        data = {"name": "Minimal", "repo_url": "https://example.com"}
        p = ProjectConfig.from_dict(data)
        assert p.name == "Minimal"
        assert p.repo_url == "https://example.com"
        assert len(p.id) == 32
        assert p.jtbd == ""
        assert p.custom_prompts == {}
        assert p.docker_image == "ubuntu:24.04"
        assert p.created_at  # auto-generated
        assert p.updated_at  # auto-generated

    def test_round_trip_serialization(self):
        original = ProjectConfig(
            name="RoundTrip",
            repo_url="https://github.com/test/repo",
            jtbd="Test round-trip",
            custom_prompts={"A.md": "content A", "B.md": "content B"},
            docker_image="alpine:3.18",
        )
        d = original.to_dict()
        restored = ProjectConfig.from_dict(d)
        assert restored.to_dict() == d

    def test_each_instance_gets_unique_id(self):
        p1 = ProjectConfig(name="A", repo_url="url1")
        p2 = ProjectConfig(name="B", repo_url="url2")
        assert p1.id != p2.id

    def test_custom_prompts_is_independent_copy(self):
        """to_dict returns an independent copy of custom_prompts."""
        prompts = {"file.md": "content"}
        p = ProjectConfig(name="X", repo_url="url", custom_prompts=prompts)
        d = p.to_dict()
        d["custom_prompts"]["new.md"] = "new"
        assert "new.md" not in p.custom_prompts

    def test_timestamps_are_valid_iso(self):
        p = ProjectConfig(name="T", repo_url="url")
        # Should parse without error
        datetime.fromisoformat(p.created_at)
        datetime.fromisoformat(p.updated_at)


class TestAppSettings:
    """Tests for AppSettings dataclass."""

    def test_defaults(self):
        s = AppSettings()
        assert s.max_concurrent_containers == 5
        assert s.notification_enabled is True
        assert s.theme == "system"
        assert s.log_level == "INFO"

    def test_custom_values(self):
        s = AppSettings(
            max_concurrent_containers=3,
            notification_enabled=False,
            theme="dark",
            log_level="DEBUG",
        )
        assert s.max_concurrent_containers == 3
        assert s.notification_enabled is False
        assert s.theme == "dark"
        assert s.log_level == "DEBUG"

    def test_to_dict(self):
        s = AppSettings()
        d = s.to_dict()
        assert d == {
            "max_concurrent_containers": 5,
            "notification_enabled": True,
            "theme": "system",
            "log_level": "INFO",
        }

    def test_from_dict_full(self):
        data = {
            "max_concurrent_containers": 2,
            "notification_enabled": False,
            "theme": "light",
            "log_level": "WARNING",
        }
        s = AppSettings.from_dict(data)
        assert s.max_concurrent_containers == 2
        assert s.notification_enabled is False
        assert s.theme == "light"
        assert s.log_level == "WARNING"

    def test_from_dict_empty(self):
        """Empty dict falls back to all defaults."""
        s = AppSettings.from_dict({})
        assert s.max_concurrent_containers == 5
        assert s.notification_enabled is True
        assert s.theme == "system"
        assert s.log_level == "INFO"

    def test_from_dict_partial(self):
        """Partial dict uses defaults for missing keys."""
        data = {"theme": "dark", "log_level": "ERROR"}
        s = AppSettings.from_dict(data)
        assert s.max_concurrent_containers == 5
        assert s.notification_enabled is True
        assert s.theme == "dark"
        assert s.log_level == "ERROR"

    def test_round_trip_serialization(self):
        original = AppSettings(
            max_concurrent_containers=8,
            notification_enabled=False,
            theme="light",
            log_level="DEBUG",
        )
        d = original.to_dict()
        restored = AppSettings.from_dict(d)
        assert restored.to_dict() == d

    def test_from_dict_ignores_unknown_keys(self):
        """Extra keys in the dict are silently ignored."""
        data = {
            "max_concurrent_containers": 3,
            "unknown_future_field": "value",
            "another": 42,
        }
        s = AppSettings.from_dict(data)
        assert s.max_concurrent_containers == 3
        assert not hasattr(s, "unknown_future_field")
