"""Tests for src/lib/log_exporter.py — log export functionality."""

import zipfile
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import pytest

from src.lib.log_exporter import LogExporter
from src.lib.loop_runner import LoopMode, LoopState, LoopStatus


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_state(project_id: str, **kwargs) -> LoopState:
    """Create a LoopState with sensible defaults, overridable via kwargs."""
    defaults = {
        "project_id": project_id,
        "container_id": f"ctr-{project_id}",
        "mode": LoopMode.CONTINUOUS,
        "status": LoopStatus.RUNNING,
        "iteration": 3,
        "started_at": "2025-01-15T10:00:00Z",
        "last_log": "some log line",
        "commits_detected": ["abc1234"],
        "error": None,
    }
    defaults.update(kwargs)
    return LoopState(**defaults)


# ---------------------------------------------------------------------------
# export_loop_log
# ---------------------------------------------------------------------------

class TestExportLoopLog:
    """Tests for LogExporter.export_loop_log."""

    def test_creates_output_directory(self, tmp_path: Path):
        dest = tmp_path / "nested" / "dir"
        path = LogExporter.export_loop_log("proj-1", "log line", dest)
        assert dest.is_dir()
        assert path.exists()

    def test_returns_path_inside_output_dir(self, tmp_path: Path):
        path = LogExporter.export_loop_log("proj-1", "hello", tmp_path)
        assert path.parent == tmp_path

    def test_file_contains_log_content(self, tmp_path: Path):
        content = "line1\nline2\nline3"
        path = LogExporter.export_loop_log("p1", content, tmp_path)
        assert path.read_text(encoding="utf-8") == content

    def test_filename_contains_project_id(self, tmp_path: Path):
        path = LogExporter.export_loop_log("my-proj", "x", tmp_path)
        assert "my-proj" in path.name

    def test_filename_ends_with_log_extension(self, tmp_path: Path):
        path = LogExporter.export_loop_log("p", "x", tmp_path)
        assert path.suffix == ".log"

    def test_filename_contains_timestamp(self, tmp_path: Path):
        fixed = datetime(2025, 6, 15, 12, 30, 45, tzinfo=timezone.utc)
        with patch("src.lib.log_exporter.datetime") as mock_dt:
            mock_dt.now.return_value = fixed
            mock_dt.side_effect = lambda *a, **kw: datetime(*a, **kw)
            path = LogExporter.export_loop_log("p", "x", tmp_path)
        assert "20250615T123045Z" in path.name

    def test_empty_log_content(self, tmp_path: Path):
        path = LogExporter.export_loop_log("p", "", tmp_path)
        assert path.read_text(encoding="utf-8") == ""

    def test_large_log_content(self, tmp_path: Path):
        big = "A" * 10_000_000  # 10 MB
        path = LogExporter.export_loop_log("p", big, tmp_path)
        assert path.stat().st_size >= 10_000_000

    def test_unicode_log_content(self, tmp_path: Path):
        content = "日本語ログ\n中文日志\nПривет"
        path = LogExporter.export_loop_log("p", content, tmp_path)
        assert path.read_text(encoding="utf-8") == content

    def test_existing_directory_ok(self, tmp_path: Path):
        """Does not error when the output directory already exists."""
        path = LogExporter.export_loop_log("p", "data", tmp_path)
        assert path.exists()

    def test_two_exports_different_timestamps(self, tmp_path: Path):
        """Two rapid exports produce distinct files (timestamps differ)."""
        t1 = datetime(2025, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
        t2 = datetime(2025, 1, 1, 0, 0, 1, tzinfo=timezone.utc)
        with patch("src.lib.log_exporter.datetime") as mock_dt:
            mock_dt.side_effect = lambda *a, **kw: datetime(*a, **kw)
            mock_dt.now.return_value = t1
            p1 = LogExporter.export_loop_log("p", "a", tmp_path)
            mock_dt.now.return_value = t2
            p2 = LogExporter.export_loop_log("p", "b", tmp_path)
        assert p1 != p2


# ---------------------------------------------------------------------------
# export_all_logs
# ---------------------------------------------------------------------------

class TestExportAllLogs:
    """Tests for LogExporter.export_all_logs."""

    def test_creates_zip_file(self, tmp_path: Path):
        states = {"p1": _make_state("p1")}
        logs = {"p1": "log data"}
        zp = LogExporter.export_all_logs(states, logs, tmp_path)
        assert zp.suffix == ".zip"
        assert zp.exists()

    def test_zip_is_valid(self, tmp_path: Path):
        states = {"p1": _make_state("p1")}
        logs = {"p1": "log data"}
        zp = LogExporter.export_all_logs(states, logs, tmp_path)
        assert zipfile.is_zipfile(zp)

    def test_zip_contains_log_files(self, tmp_path: Path):
        states = {
            "alpha": _make_state("alpha"),
            "beta": _make_state("beta"),
        }
        logs = {"alpha": "alpha log", "beta": "beta log"}
        zp = LogExporter.export_all_logs(states, logs, tmp_path)
        with zipfile.ZipFile(zp, "r") as zf:
            names = zf.namelist()
            assert "alpha.log" in names
            assert "beta.log" in names

    def test_zip_log_content_matches(self, tmp_path: Path):
        states = {"p1": _make_state("p1")}
        logs = {"p1": "expected content"}
        zp = LogExporter.export_all_logs(states, logs, tmp_path)
        with zipfile.ZipFile(zp, "r") as zf:
            assert zf.read("p1.log").decode("utf-8") == "expected content"

    def test_zip_contains_summary(self, tmp_path: Path):
        states = {"p1": _make_state("p1")}
        logs = {"p1": "x"}
        zp = LogExporter.export_all_logs(states, logs, tmp_path)
        with zipfile.ZipFile(zp, "r") as zf:
            assert "summary.txt" in zf.namelist()

    def test_summary_contains_project_info(self, tmp_path: Path):
        states = {"p1": _make_state("p1", status=LoopStatus.RUNNING, iteration=7)}
        logs = {"p1": "x"}
        zp = LogExporter.export_all_logs(states, logs, tmp_path)
        with zipfile.ZipFile(zp, "r") as zf:
            summary = zf.read("summary.txt").decode("utf-8")
            assert "p1" in summary
            assert "running" in summary
            assert "7" in summary

    def test_summary_lists_all_projects(self, tmp_path: Path):
        states = {
            "a": _make_state("a"),
            "b": _make_state("b"),
            "c": _make_state("c"),
        }
        logs = {"a": "x", "b": "y", "c": "z"}
        zp = LogExporter.export_all_logs(states, logs, tmp_path)
        with zipfile.ZipFile(zp, "r") as zf:
            summary = zf.read("summary.txt").decode("utf-8")
            for pid in ("a", "b", "c"):
                assert pid in summary

    def test_creates_output_directory(self, tmp_path: Path):
        dest = tmp_path / "deep" / "nested"
        states = {"p1": _make_state("p1")}
        logs = {"p1": "x"}
        zp = LogExporter.export_all_logs(states, logs, dest)
        assert dest.is_dir()
        assert zp.exists()

    def test_zip_filename_contains_timestamp(self, tmp_path: Path):
        fixed = datetime(2025, 3, 20, 8, 15, 0, tzinfo=timezone.utc)
        with patch("src.lib.log_exporter.datetime") as mock_dt:
            mock_dt.now.return_value = fixed
            mock_dt.side_effect = lambda *a, **kw: datetime(*a, **kw)
            zp = LogExporter.export_all_logs(
                {"p1": _make_state("p1")}, {"p1": "x"}, tmp_path
            )
        assert "20250320T081500Z" in zp.name

    def test_empty_states_and_logs(self, tmp_path: Path):
        """Exporting with no loops creates a zip with only a summary."""
        zp = LogExporter.export_all_logs({}, {}, tmp_path)
        assert zipfile.is_zipfile(zp)
        with zipfile.ZipFile(zp, "r") as zf:
            assert zf.namelist() == ["summary.txt"]

    def test_logs_without_matching_state(self, tmp_path: Path):
        """Log entries without a corresponding state are still exported."""
        states = {}
        logs = {"orphan": "orphan log content"}
        zp = LogExporter.export_all_logs(states, logs, tmp_path)
        with zipfile.ZipFile(zp, "r") as zf:
            assert "orphan.log" in zf.namelist()
            assert zf.read("orphan.log").decode("utf-8") == "orphan log content"

    def test_uses_deflate_compression(self, tmp_path: Path):
        states = {"p1": _make_state("p1")}
        logs = {"p1": "A" * 10000}
        zp = LogExporter.export_all_logs(states, logs, tmp_path)
        with zipfile.ZipFile(zp, "r") as zf:
            for info in zf.infolist():
                assert info.compress_type == zipfile.ZIP_DEFLATED


# ---------------------------------------------------------------------------
# get_default_export_path
# ---------------------------------------------------------------------------

class TestGetDefaultExportPath:
    """Tests for LogExporter.get_default_export_path."""

    def test_returns_path_under_desktop(self):
        path = LogExporter.get_default_export_path()
        assert path.parent == Path.home() / "Desktop"

    def test_directory_name_starts_with_zephyr_logs(self):
        path = LogExporter.get_default_export_path()
        assert path.name.startswith("zephyr-logs-")

    def test_directory_name_contains_timestamp(self):
        fixed = datetime(2025, 12, 31, 23, 59, 59, tzinfo=timezone.utc)
        with patch("src.lib.log_exporter.datetime") as mock_dt:
            mock_dt.now.return_value = fixed
            mock_dt.side_effect = lambda *a, **kw: datetime(*a, **kw)
            path = LogExporter.get_default_export_path()
        assert "20251231T235959Z" in path.name

    def test_returns_path_instance(self):
        assert isinstance(LogExporter.get_default_export_path(), Path)

    def test_successive_calls_may_differ(self):
        """Two calls at different times produce different paths."""
        t1 = datetime(2025, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
        t2 = datetime(2025, 1, 1, 0, 0, 1, tzinfo=timezone.utc)
        with patch("src.lib.log_exporter.datetime") as mock_dt:
            mock_dt.side_effect = lambda *a, **kw: datetime(*a, **kw)
            mock_dt.now.return_value = t1
            p1 = LogExporter.get_default_export_path()
            mock_dt.now.return_value = t2
            p2 = LogExporter.get_default_export_path()
        assert p1 != p2
