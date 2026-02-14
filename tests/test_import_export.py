"""Tests for src/lib/import_export.py.

Covers: round-trip export/import, corrupt zip handling, conflict
detection, path traversal safety, and edge cases.
"""

import json
import zipfile

import pytest

from src.lib.config_manager import ConfigManager
from src.lib.import_export import export_config, import_config

# ── helpers ──────────────────────────────────────────────────────────


def _make_config_dir(
    tmp_path, projects=None, settings=None, prompts=None, md_files=None
):
    """Set up a config directory with optional data files."""
    config_dir = tmp_path / "config"
    config_dir.mkdir()

    if projects is not None:
        (config_dir / "projects.json").write_text(
            json.dumps(projects), encoding="utf-8"
        )

    if settings is not None:
        (config_dir / "settings.json").write_text(
            json.dumps(settings), encoding="utf-8"
        )

    if prompts:
        prompts_dir = config_dir / "prompts"
        prompts_dir.mkdir()
        for name, content in prompts.items():
            (prompts_dir / name).write_text(content, encoding="utf-8")

    if md_files:
        for name, content in md_files.items():
            (config_dir / name).write_text(content, encoding="utf-8")

    return ConfigManager(config_dir=config_dir)


def _sample_projects():
    return {
        "projects": {
            "abc123": {
                "id": "abc123",
                "name": "Test Project",
                "repo_url": "https://github.com/test/repo",
                "jtbd": "testing",
                "custom_prompts": {},
                "docker_image": "ubuntu:24.04",
                "created_at": "2025-01-01T00:00:00+00:00",
                "updated_at": "2025-01-01T00:00:00+00:00",
            }
        }
    }


def _sample_settings():
    return {
        "max_concurrent_containers": 3,
        "notification_enabled": False,
        "theme": "dark",
        "log_level": "DEBUG",
    }


# ── export tests ─────────────────────────────────────────────────────


class TestExportConfig:
    def test_export_creates_zip(self, tmp_path):
        cm = _make_config_dir(tmp_path, projects=_sample_projects())
        out = tmp_path / "backup.zip"

        result = export_config(cm, out)

        assert result.exists()
        assert result.suffix == ".zip"
        assert zipfile.is_zipfile(result)

    def test_export_appends_zip_suffix(self, tmp_path):
        cm = _make_config_dir(tmp_path, projects=_sample_projects())
        out = tmp_path / "backup"

        result = export_config(cm, out)

        assert result.name == "backup.zip"

    def test_export_includes_projects_json(self, tmp_path):
        cm = _make_config_dir(tmp_path, projects=_sample_projects())
        out = tmp_path / "backup.zip"

        result = export_config(cm, out)

        with zipfile.ZipFile(result, "r") as zf:
            assert "projects.json" in zf.namelist()
            data = json.loads(zf.read("projects.json"))
            assert data == _sample_projects()

    def test_export_includes_settings_json(self, tmp_path):
        cm = _make_config_dir(
            tmp_path,
            projects=_sample_projects(),
            settings=_sample_settings(),
        )
        out = tmp_path / "backup.zip"

        result = export_config(cm, out)

        with zipfile.ZipFile(result, "r") as zf:
            assert "settings.json" in zf.namelist()
            data = json.loads(zf.read("settings.json"))
            assert data == _sample_settings()

    def test_export_includes_prompt_files(self, tmp_path):
        prompts = {
            "PROMPT_build.md": "build instructions",
            "PROMPT_test.md": "test plan",
        }
        cm = _make_config_dir(tmp_path, projects=_sample_projects(), prompts=prompts)
        out = tmp_path / "backup.zip"

        result = export_config(cm, out)

        with zipfile.ZipFile(result, "r") as zf:
            names = zf.namelist()
            assert "prompts/PROMPT_build.md" in names
            assert "prompts/PROMPT_test.md" in names
            assert zf.read("prompts/PROMPT_build.md").decode() == "build instructions"

    def test_export_includes_md_files_in_config_root(self, tmp_path):
        md_files = {"AGENTS.md": "agent config"}
        cm = _make_config_dir(tmp_path, projects=_sample_projects(), md_files=md_files)
        out = tmp_path / "backup.zip"

        result = export_config(cm, out)

        with zipfile.ZipFile(result, "r") as zf:
            assert "AGENTS.md" in zf.namelist()

    def test_export_empty_config_dir(self, tmp_path):
        """Export of a config dir with no files produces an empty zip."""
        cm = _make_config_dir(tmp_path)
        out = tmp_path / "backup.zip"

        result = export_config(cm, out)

        assert result.exists()
        with zipfile.ZipFile(result, "r") as zf:
            assert zf.namelist() == []

    def test_export_nonexistent_config_dir(self, tmp_path):
        cm = ConfigManager(config_dir=tmp_path / "does_not_exist")

        with pytest.raises(FileNotFoundError):
            export_config(cm, tmp_path / "backup.zip")

    def test_export_creates_parent_dirs(self, tmp_path):
        cm = _make_config_dir(tmp_path, projects=_sample_projects())
        out = tmp_path / "sub" / "dir" / "backup.zip"

        result = export_config(cm, out)

        assert result.exists()


# ── import tests ─────────────────────────────────────────────────────


class TestImportConfig:
    def _create_zip(self, tmp_path, files):
        """Create a zip file with given {name: content} mapping."""
        zip_path = tmp_path / "import.zip"
        with zipfile.ZipFile(zip_path, "w") as zf:
            for name, content in files.items():
                if isinstance(content, bytes):
                    zf.writestr(name, content)
                else:
                    zf.writestr(name, content)
        return zip_path

    def test_import_extracts_files(self, tmp_path):
        projects = _sample_projects()
        zip_path = self._create_zip(tmp_path, {"projects.json": json.dumps(projects)})
        dest = tmp_path / "dest"
        dest.mkdir()
        cm = ConfigManager(config_dir=dest)

        summary = import_config(cm, zip_path)

        assert (dest / "projects.json").exists()
        assert summary["files"] == ["projects.json"]
        assert summary["projects_count"] == 1
        assert summary["has_settings"] is False

    def test_import_with_settings(self, tmp_path):
        zip_path = self._create_zip(
            tmp_path,
            {
                "projects.json": json.dumps(_sample_projects()),
                "settings.json": json.dumps(_sample_settings()),
            },
        )
        dest = tmp_path / "dest"
        dest.mkdir()
        cm = ConfigManager(config_dir=dest)

        summary = import_config(cm, zip_path)

        assert summary["has_settings"] is True
        data = json.loads((dest / "settings.json").read_text())
        assert data == _sample_settings()

    def test_import_with_prompts(self, tmp_path):
        zip_path = self._create_zip(
            tmp_path,
            {
                "projects.json": json.dumps(_sample_projects()),
                "prompts/PROMPT_build.md": "build it",
            },
        )
        dest = tmp_path / "dest"
        dest.mkdir()
        cm = ConfigManager(config_dir=dest)

        summary = import_config(cm, zip_path)

        assert (dest / "prompts" / "PROMPT_build.md").exists()
        assert (dest / "prompts" / "PROMPT_build.md").read_text() == "build it"

    def test_import_creates_config_dir_if_missing(self, tmp_path):
        zip_path = self._create_zip(
            tmp_path, {"projects.json": json.dumps(_sample_projects())}
        )
        dest = tmp_path / "new_dir"
        cm = ConfigManager(config_dir=dest)

        import_config(cm, zip_path)

        assert dest.is_dir()
        assert (dest / "projects.json").exists()

    def test_import_conflict_raises(self, tmp_path):
        """Import raises FileExistsError when files already exist."""
        zip_path = self._create_zip(
            tmp_path, {"projects.json": json.dumps(_sample_projects())}
        )
        dest = tmp_path / "dest"
        dest.mkdir()
        (dest / "projects.json").write_text("{}", encoding="utf-8")
        cm = ConfigManager(config_dir=dest)

        with pytest.raises(FileExistsError, match="projects.json"):
            import_config(cm, zip_path)

    def test_import_nonexistent_zip(self, tmp_path):
        cm = ConfigManager(config_dir=tmp_path)

        with pytest.raises(FileNotFoundError):
            import_config(cm, tmp_path / "nope.zip")

    def test_import_corrupt_zip(self, tmp_path):
        bad_zip = tmp_path / "bad.zip"
        bad_zip.write_bytes(b"this is not a zip file at all")
        cm = ConfigManager(config_dir=tmp_path / "dest")

        with pytest.raises(zipfile.BadZipFile):
            import_config(cm, bad_zip)

    def test_import_path_traversal_rejected(self, tmp_path):
        """Zip with path traversal components is rejected."""
        zip_path = tmp_path / "evil.zip"
        with zipfile.ZipFile(zip_path, "w") as zf:
            zf.writestr("../../../etc/passwd", "pwned")
        dest = tmp_path / "dest"
        dest.mkdir()
        cm = ConfigManager(config_dir=dest)

        with pytest.raises(ValueError, match="unsafe path"):
            import_config(cm, zip_path)

    def test_import_empty_zip(self, tmp_path):
        zip_path = self._create_zip(tmp_path, {})
        dest = tmp_path / "dest"
        dest.mkdir()
        cm = ConfigManager(config_dir=dest)

        summary = import_config(cm, zip_path)

        assert summary["files"] == []
        assert summary["projects_count"] == 0
        assert summary["has_settings"] is False


# ── round-trip tests ─────────────────────────────────────────────────


class TestRoundTrip:
    def test_export_then_import_matches(self, tmp_path):
        """Full round-trip: export from source, import to fresh dest."""
        prompts = {"PROMPT_build.md": "build steps"}
        source_cm = _make_config_dir(
            tmp_path,
            projects=_sample_projects(),
            settings=_sample_settings(),
            prompts=prompts,
        )

        zip_path = export_config(source_cm, tmp_path / "roundtrip.zip")

        dest = tmp_path / "dest"
        dest_cm = ConfigManager(config_dir=dest)
        summary = import_config(dest_cm, zip_path)

        # Verify projects.
        src_projects = json.loads(
            (source_cm.get_config_dir() / "projects.json").read_text()
        )
        dst_projects = json.loads((dest / "projects.json").read_text())
        assert src_projects == dst_projects

        # Verify settings.
        src_settings = json.loads(
            (source_cm.get_config_dir() / "settings.json").read_text()
        )
        dst_settings = json.loads((dest / "settings.json").read_text())
        assert src_settings == dst_settings

        # Verify prompt files.
        assert (dest / "prompts" / "PROMPT_build.md").read_text() == "build steps"

        # Verify summary.
        assert summary["projects_count"] == 1
        assert summary["has_settings"] is True
        assert len(summary["files"]) >= 3  # projects, settings, prompt

    def test_export_import_preserves_multiple_projects(self, tmp_path):
        projects = {
            "projects": {
                "id1": {
                    "id": "id1",
                    "name": "Alpha",
                    "repo_url": "/repos/alpha",
                    "jtbd": "",
                    "custom_prompts": {},
                    "docker_image": "ubuntu:24.04",
                    "created_at": "2025-01-01T00:00:00+00:00",
                    "updated_at": "2025-01-01T00:00:00+00:00",
                },
                "id2": {
                    "id": "id2",
                    "name": "Beta",
                    "repo_url": "/repos/beta",
                    "jtbd": "second project",
                    "custom_prompts": {"PROMPT_review.md": "review it"},
                    "docker_image": "python:3.12",
                    "created_at": "2025-02-01T00:00:00+00:00",
                    "updated_at": "2025-02-01T00:00:00+00:00",
                },
            }
        }
        source_cm = _make_config_dir(tmp_path, projects=projects)
        zip_path = export_config(source_cm, tmp_path / "multi.zip")

        dest = tmp_path / "dest"
        dest_cm = ConfigManager(config_dir=dest)
        summary = import_config(dest_cm, zip_path)

        assert summary["projects_count"] == 2
        dst_data = json.loads((dest / "projects.json").read_text())
        assert "id1" in dst_data["projects"]
        assert "id2" in dst_data["projects"]
