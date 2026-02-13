"""Tests for the disk space checker module."""

import os
from pathlib import Path
from unittest.mock import patch

import pytest

from src.lib.disk_checker import DiskChecker


@pytest.fixture
def checker():
    """Return a fresh DiskChecker instance."""
    return DiskChecker()


# ---------------------------------------------------------------------------
# get_available_space
# ---------------------------------------------------------------------------

class TestGetAvailableSpace:
    """Tests for DiskChecker.get_available_space."""

    def test_returns_free_space_from_disk_usage(self, checker, tmp_path):
        """Should delegate to shutil.disk_usage and return the free field."""
        fake_usage = os.statvfs_result((4096, 4096, 1000000, 500000, 500000, 0, 0, 0, 0, 255))
        with patch("shutil.disk_usage") as mock_du:
            mock_du.return_value = type("Usage", (), {"total": 100_000_000, "used": 40_000_000, "free": 60_000_000})()
            result = checker.get_available_space(tmp_path)
            assert result == 60_000_000
            mock_du.assert_called_once_with(tmp_path.resolve())

    def test_raises_for_nonexistent_path(self, checker, tmp_path):
        """Should raise FileNotFoundError for a path that doesn't exist."""
        missing = tmp_path / "does_not_exist"
        with pytest.raises(FileNotFoundError, match="does not exist"):
            checker.get_available_space(missing)

    def test_works_with_real_filesystem(self, checker, tmp_path):
        """Smoke test against the real filesystem — free space should be > 0."""
        result = checker.get_available_space(tmp_path)
        assert isinstance(result, int)
        assert result > 0

    def test_works_with_file_path(self, checker, tmp_path):
        """Should work when given a path to a file, not just a directory."""
        f = tmp_path / "somefile.txt"
        f.write_text("hello")
        with patch("shutil.disk_usage") as mock_du:
            mock_du.return_value = type("Usage", (), {"total": 100, "used": 40, "free": 60})()
            result = checker.get_available_space(f)
            assert result == 60

    def test_resolves_relative_paths(self, checker, tmp_path):
        """Should resolve relative paths before checking."""
        sub = tmp_path / "a" / "b"
        sub.mkdir(parents=True)
        with patch("shutil.disk_usage") as mock_du:
            mock_du.return_value = type("Usage", (), {"total": 100, "used": 40, "free": 60})()
            checker.get_available_space(sub)
            mock_du.assert_called_once_with(sub.resolve())


# ---------------------------------------------------------------------------
# check_repo_size
# ---------------------------------------------------------------------------

class TestCheckRepoSize:
    """Tests for DiskChecker.check_repo_size."""

    def test_empty_directory_returns_zero(self, checker, tmp_path):
        """An empty directory should have a size of 0."""
        assert checker.check_repo_size(tmp_path) == 0

    def test_sums_file_sizes(self, checker, tmp_path):
        """Should sum the sizes of all files in the tree."""
        (tmp_path / "a.txt").write_bytes(b"x" * 100)
        (tmp_path / "b.txt").write_bytes(b"y" * 200)
        result = checker.check_repo_size(tmp_path)
        assert result == 300

    def test_includes_nested_files(self, checker, tmp_path):
        """Should include files in subdirectories."""
        sub = tmp_path / "sub" / "deep"
        sub.mkdir(parents=True)
        (tmp_path / "root.txt").write_bytes(b"a" * 50)
        (sub / "nested.txt").write_bytes(b"b" * 75)
        result = checker.check_repo_size(tmp_path)
        assert result == 125

    def test_does_not_follow_symlinks(self, checker, tmp_path):
        """Should not count symlinked files (they're not regular files for this check)."""
        target = tmp_path / "real.txt"
        target.write_bytes(b"z" * 100)
        link = tmp_path / "link.txt"
        link.symlink_to(target)
        # Only the real file should be counted, not the symlink
        result = checker.check_repo_size(tmp_path)
        assert result == 100

    def test_raises_for_nonexistent_path(self, checker, tmp_path):
        """Should raise FileNotFoundError if the repo path doesn't exist."""
        missing = tmp_path / "no_such_repo"
        with pytest.raises(FileNotFoundError, match="does not exist"):
            checker.check_repo_size(missing)

    def test_raises_for_file_instead_of_directory(self, checker, tmp_path):
        """Should raise NotADirectoryError if given a file path."""
        f = tmp_path / "file.txt"
        f.write_text("data")
        with pytest.raises(NotADirectoryError, match="not a directory"):
            checker.check_repo_size(f)

    def test_handles_inaccessible_files_gracefully(self, checker, tmp_path):
        """Should skip files that can't be stat'd without raising."""
        (tmp_path / "ok.txt").write_bytes(b"a" * 50)
        (tmp_path / "bad.txt").write_bytes(b"b" * 30)

        original_rglob = Path.rglob

        def patched_rglob(self_path, pattern):
            for entry in original_rglob(self_path, pattern):
                yield entry

        original_stat = Path.stat

        def patched_stat(self_path, *args, **kwargs):
            if self_path.name == "bad.txt":
                raise OSError("Permission denied")
            return original_stat(self_path, *args, **kwargs)

        with patch.object(Path, "stat", patched_stat):
            result = checker.check_repo_size(tmp_path)
            # Only ok.txt (50 bytes) should be counted
            assert result == 50

    def test_large_repo_with_many_files(self, checker, tmp_path):
        """Should correctly sum many small files."""
        for i in range(50):
            (tmp_path / f"file_{i}.txt").write_bytes(b"x" * 10)
        result = checker.check_repo_size(tmp_path)
        assert result == 500


# ---------------------------------------------------------------------------
# warn_if_low
# ---------------------------------------------------------------------------

class TestWarnIfLow:
    """Tests for DiskChecker.warn_if_low."""

    def test_returns_none_when_plenty_of_space(self, checker, tmp_path):
        """Should return None when free space exceeds the threshold."""
        ten_gb = 10 * 1024 * 1024 * 1024
        with patch.object(checker, "get_available_space", return_value=ten_gb):
            result = checker.warn_if_low(tmp_path, threshold_gb=5.0)
            assert result is None

    def test_returns_warning_when_space_is_low(self, checker, tmp_path):
        """Should return a warning message when space is below threshold."""
        two_gb = 2 * 1024 * 1024 * 1024
        with patch.object(checker, "get_available_space", return_value=two_gb):
            result = checker.warn_if_low(tmp_path, threshold_gb=5.0)
            assert result is not None
            assert "2.0 GB available" in result
            assert "5.0 GB" in result

    def test_returns_warning_at_exact_threshold(self, checker, tmp_path):
        """Space exactly at threshold should NOT trigger a warning (not strictly less)."""
        five_gb = 5 * 1024 * 1024 * 1024
        with patch.object(checker, "get_available_space", return_value=five_gb):
            result = checker.warn_if_low(tmp_path, threshold_gb=5.0)
            assert result is None

    def test_returns_warning_just_below_threshold(self, checker, tmp_path):
        """One byte below threshold should trigger a warning."""
        just_below = 5 * 1024 * 1024 * 1024 - 1
        with patch.object(checker, "get_available_space", return_value=just_below):
            result = checker.warn_if_low(tmp_path, threshold_gb=5.0)
            assert result is not None

    def test_custom_threshold(self, checker, tmp_path):
        """Should respect custom threshold values."""
        one_gb = 1 * 1024 * 1024 * 1024
        with patch.object(checker, "get_available_space", return_value=one_gb):
            # Below 2 GB threshold
            result = checker.warn_if_low(tmp_path, threshold_gb=2.0)
            assert result is not None
            assert "2.0 GB" in result

            # Above 0.5 GB threshold
            result = checker.warn_if_low(tmp_path, threshold_gb=0.5)
            assert result is None

    def test_default_path_is_home(self, checker):
        """Should use home directory when no path is given."""
        ten_gb = 10 * 1024 * 1024 * 1024
        with patch.object(checker, "get_available_space", return_value=ten_gb) as mock_space:
            checker.warn_if_low()
            mock_space.assert_called_once_with(Path.home())

    def test_returns_message_when_path_does_not_exist(self, checker, tmp_path):
        """Should return a message (not raise) when the check path doesn't exist."""
        missing = tmp_path / "gone"
        with patch.object(
            checker, "get_available_space", side_effect=FileNotFoundError("nope")
        ):
            result = checker.warn_if_low(missing)
            assert result is not None
            assert "Cannot check disk space" in result

    def test_warning_message_contains_actionable_advice(self, checker, tmp_path):
        """Warning message should tell the user what to do."""
        low = 1 * 1024 * 1024 * 1024
        with patch.object(checker, "get_available_space", return_value=low):
            result = checker.warn_if_low(tmp_path, threshold_gb=5.0)
            assert "freeing up space" in result

    def test_zero_space(self, checker, tmp_path):
        """Should warn when there is literally zero space."""
        with patch.object(checker, "get_available_space", return_value=0):
            result = checker.warn_if_low(tmp_path, threshold_gb=5.0)
            assert result is not None
            assert "0.0 GB available" in result

    def test_very_large_threshold(self, checker, tmp_path):
        """Should handle very large threshold values."""
        hundred_gb = 100 * 1024 * 1024 * 1024
        with patch.object(checker, "get_available_space", return_value=hundred_gb):
            result = checker.warn_if_low(tmp_path, threshold_gb=200.0)
            assert result is not None
            assert "200.0 GB" in result

    def test_fractional_gb_display(self, checker, tmp_path):
        """Should display fractional GB correctly."""
        half_gb = int(0.5 * 1024 * 1024 * 1024)
        with patch.object(checker, "get_available_space", return_value=half_gb):
            result = checker.warn_if_low(tmp_path, threshold_gb=1.0)
            assert result is not None
            assert "0.5 GB available" in result
