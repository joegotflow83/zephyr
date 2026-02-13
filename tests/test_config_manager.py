"""Tests for ConfigManager.

Uses tmp_path fixture to isolate each test from the real filesystem.
"""

import json
import os

import pytest

from src.lib.config_manager import ConfigManager


class TestEnsureConfigDir:
    def test_creates_directory(self, tmp_path):
        config_dir = tmp_path / ".zephyr"
        mgr = ConfigManager(config_dir)
        result = mgr.ensure_config_dir()
        assert result == config_dir
        assert config_dir.is_dir()

    def test_idempotent(self, tmp_path):
        config_dir = tmp_path / ".zephyr"
        mgr = ConfigManager(config_dir)
        mgr.ensure_config_dir()
        mgr.ensure_config_dir()  # Should not raise
        assert config_dir.is_dir()

    def test_creates_nested_parents(self, tmp_path):
        config_dir = tmp_path / "deep" / "nested" / ".zephyr"
        mgr = ConfigManager(config_dir)
        mgr.ensure_config_dir()
        assert config_dir.is_dir()


class TestGetConfigDir:
    def test_returns_configured_dir(self, tmp_path):
        config_dir = tmp_path / ".zephyr"
        mgr = ConfigManager(config_dir)
        assert mgr.get_config_dir() == config_dir


class TestLoadJson:
    def test_missing_file_returns_empty_dict(self, tmp_path):
        mgr = ConfigManager(tmp_path)
        assert mgr.load_json("nonexistent.json") == {}

    def test_loads_valid_json(self, tmp_path):
        data = {"key": "value", "count": 42}
        (tmp_path / "test.json").write_text(json.dumps(data), encoding="utf-8")
        mgr = ConfigManager(tmp_path)
        assert mgr.load_json("test.json") == data

    def test_invalid_json_returns_empty_dict(self, tmp_path):
        (tmp_path / "bad.json").write_text("not valid json{{{", encoding="utf-8")
        mgr = ConfigManager(tmp_path)
        assert mgr.load_json("bad.json") == {}

    def test_non_dict_json_returns_empty_dict(self, tmp_path):
        (tmp_path / "list.json").write_text(json.dumps([1, 2, 3]), encoding="utf-8")
        mgr = ConfigManager(tmp_path)
        assert mgr.load_json("list.json") == {}

    def test_empty_dict_roundtrip(self, tmp_path):
        (tmp_path / "empty.json").write_text("{}", encoding="utf-8")
        mgr = ConfigManager(tmp_path)
        assert mgr.load_json("empty.json") == {}


class TestSaveJson:
    def test_creates_dir_and_file(self, tmp_path):
        config_dir = tmp_path / ".zephyr"
        mgr = ConfigManager(config_dir)
        mgr.save_json("test.json", {"hello": "world"})
        assert (config_dir / "test.json").exists()
        loaded = json.loads((config_dir / "test.json").read_text(encoding="utf-8"))
        assert loaded == {"hello": "world"}

    def test_save_load_roundtrip(self, tmp_path):
        mgr = ConfigManager(tmp_path)
        data = {
            "projects": [{"name": "proj1"}, {"name": "proj2"}],
            "nested": {"deep": {"value": True}},
            "unicode": "caf\u00e9 \u2603",
        }
        mgr.save_json("data.json", data)
        assert mgr.load_json("data.json") == data

    def test_overwrites_existing_file(self, tmp_path):
        mgr = ConfigManager(tmp_path)
        mgr.save_json("test.json", {"v": 1})
        mgr.save_json("test.json", {"v": 2})
        assert mgr.load_json("test.json") == {"v": 2}

    def test_atomic_write_no_corruption_on_partial_failure(self, tmp_path):
        """If save_json fails mid-write, the original file should be intact."""
        mgr = ConfigManager(tmp_path)
        mgr.save_json("important.json", {"original": True})

        # Simulate a failure by making json.dump raise
        class BadValue:
            def __repr__(self):
                raise RuntimeError("serialize error")

        with pytest.raises(TypeError):
            mgr.save_json("important.json", {"bad": BadValue()})

        # Original file should still be intact
        assert mgr.load_json("important.json") == {"original": True}

    def test_no_temp_files_left_on_success(self, tmp_path):
        mgr = ConfigManager(tmp_path)
        mgr.save_json("test.json", {"a": 1})
        files = list(tmp_path.iterdir())
        assert len(files) == 1
        assert files[0].name == "test.json"

    def test_no_temp_files_left_on_failure(self, tmp_path):
        mgr = ConfigManager(tmp_path)
        mgr.ensure_config_dir()

        class BadValue:
            pass

        with pytest.raises(TypeError):
            mgr.save_json("fail.json", {"bad": BadValue()})

        # Only config dir contents, no temp files
        remaining = [f.name for f in tmp_path.iterdir() if not f.name.startswith(".")]
        assert "fail.json" not in remaining
        # No .tmp files should remain
        assert not any(f.name.endswith(".tmp") for f in tmp_path.iterdir())
