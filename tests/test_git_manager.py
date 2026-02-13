"""Tests for the Git repository manager (src/lib/git_manager.py).

All gitpython interactions are mocked — no real Git operations are performed.
"""

from pathlib import Path
from unittest.mock import MagicMock, patch, PropertyMock
from datetime import datetime, timezone

import pytest
import git as git_module
from git.exc import GitCommandError, InvalidGitRepositoryError, NoSuchPathError

from src.lib.git_manager import GitManager, _ProgressHandler


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def gm():
    """Return a fresh GitManager instance."""
    return GitManager()


@pytest.fixture
def tmp_repo(tmp_path):
    """Return a path that looks like an existing repo dir (for mock use)."""
    return tmp_path / "my-repo"


# ---------------------------------------------------------------------------
# clone_repo tests
# ---------------------------------------------------------------------------

class TestCloneRepo:
    """Tests for GitManager.clone_repo."""

    @patch("src.lib.git_manager.git.Repo.clone_from")
    def test_clone_success(self, mock_clone, gm, tmp_repo):
        mock_repo = MagicMock()
        mock_repo.working_dir = str(tmp_repo)
        mock_clone.return_value = mock_repo

        result = gm.clone_repo("https://github.com/user/repo.git", tmp_repo)

        mock_clone.assert_called_once_with(
            "https://github.com/user/repo.git",
            str(tmp_repo),
            progress=None,
        )
        assert result == tmp_repo

    @patch("src.lib.git_manager.git.Repo.clone_from")
    def test_clone_with_progress_callback(self, mock_clone, gm, tmp_repo):
        mock_repo = MagicMock()
        mock_repo.working_dir = str(tmp_repo)
        mock_clone.return_value = mock_repo
        callback = MagicMock()

        gm.clone_repo("https://github.com/user/repo.git", tmp_repo, progress_callback=callback)

        # Progress handler should be passed
        args, kwargs = mock_clone.call_args
        assert kwargs["progress"] is not None

    def test_clone_empty_url_raises(self, gm, tmp_repo):
        with pytest.raises(ValueError, match="must not be empty"):
            gm.clone_repo("", tmp_repo)

    def test_clone_whitespace_url_raises(self, gm, tmp_repo):
        with pytest.raises(ValueError, match="must not be empty"):
            gm.clone_repo("   ", tmp_repo)

    def test_clone_target_exists_non_empty_raises(self, gm, tmp_path):
        target = tmp_path / "existing"
        target.mkdir()
        (target / "file.txt").write_text("content")

        with pytest.raises(FileExistsError, match="non-empty"):
            gm.clone_repo("https://github.com/user/repo.git", target)

    @patch("src.lib.git_manager.git.Repo.clone_from")
    def test_clone_target_exists_empty_succeeds(self, mock_clone, gm, tmp_path):
        target = tmp_path / "empty-dir"
        target.mkdir()

        mock_repo = MagicMock()
        mock_repo.working_dir = str(target)
        mock_clone.return_value = mock_repo

        result = gm.clone_repo("https://github.com/user/repo.git", target)
        assert result == target

    @patch("src.lib.git_manager.git.Repo.clone_from")
    def test_clone_target_does_not_exist_succeeds(self, mock_clone, gm, tmp_repo):
        mock_repo = MagicMock()
        mock_repo.working_dir = str(tmp_repo)
        mock_clone.return_value = mock_repo

        result = gm.clone_repo("https://github.com/user/repo.git", tmp_repo)
        assert result == tmp_repo

    @patch("src.lib.git_manager.git.Repo.clone_from")
    def test_clone_git_error_propagates(self, mock_clone, gm, tmp_repo):
        mock_clone.side_effect = GitCommandError("clone", "auth failed")

        with pytest.raises(GitCommandError):
            gm.clone_repo("https://github.com/user/repo.git", tmp_repo)

    @patch("src.lib.git_manager.git.Repo.clone_from")
    def test_clone_returns_path_object(self, mock_clone, gm, tmp_repo):
        mock_repo = MagicMock()
        mock_repo.working_dir = str(tmp_repo)
        mock_clone.return_value = mock_repo

        result = gm.clone_repo("https://github.com/user/repo.git", tmp_repo)
        assert isinstance(result, Path)

    @patch("src.lib.git_manager.git.Repo.clone_from")
    def test_clone_ssh_url(self, mock_clone, gm, tmp_repo):
        mock_repo = MagicMock()
        mock_repo.working_dir = str(tmp_repo)
        mock_clone.return_value = mock_repo

        gm.clone_repo("git@github.com:user/repo.git", tmp_repo)

        mock_clone.assert_called_once_with(
            "git@github.com:user/repo.git",
            str(tmp_repo),
            progress=None,
        )


# ---------------------------------------------------------------------------
# validate_repo tests
# ---------------------------------------------------------------------------

class TestValidateRepo:
    """Tests for GitManager.validate_repo."""

    @patch("src.lib.git_manager.git.Repo")
    def test_valid_repo_returns_true(self, mock_repo_cls, gm, tmp_path):
        mock_repo = MagicMock()
        mock_repo.git_dir = str(tmp_path / ".git")
        mock_repo_cls.return_value = mock_repo

        assert gm.validate_repo(tmp_path) is True

    @patch("src.lib.git_manager.git.Repo")
    def test_invalid_repo_returns_false(self, mock_repo_cls, gm, tmp_path):
        mock_repo_cls.side_effect = InvalidGitRepositoryError("not a repo")

        assert gm.validate_repo(tmp_path) is False

    @patch("src.lib.git_manager.git.Repo")
    def test_nonexistent_path_returns_false(self, mock_repo_cls, gm, tmp_path):
        mock_repo_cls.side_effect = NoSuchPathError("no such path")

        assert gm.validate_repo(tmp_path / "nonexistent") is False

    @patch("src.lib.git_manager.git.Repo")
    def test_unexpected_error_returns_false(self, mock_repo_cls, gm, tmp_path):
        mock_repo_cls.side_effect = OSError("something unexpected")

        assert gm.validate_repo(tmp_path) is False

    @patch("src.lib.git_manager.git.Repo")
    def test_validate_passes_str_path(self, mock_repo_cls, gm, tmp_path):
        mock_repo = MagicMock()
        mock_repo.git_dir = str(tmp_path / ".git")
        mock_repo_cls.return_value = mock_repo

        gm.validate_repo(tmp_path)
        mock_repo_cls.assert_called_once_with(str(tmp_path))


# ---------------------------------------------------------------------------
# get_repo_info tests
# ---------------------------------------------------------------------------

class TestGetRepoInfo:
    """Tests for GitManager.get_repo_info."""

    def _make_mock_repo(self, branch="main", commit_sha="abc123def456", remote_url="https://github.com/user/repo.git"):
        """Create a mock Repo object with configurable state."""
        mock_repo = MagicMock()

        # Branch
        mock_branch = MagicMock()
        mock_branch.name = branch
        mock_repo.active_branch = mock_branch

        # HEAD commit
        mock_commit = MagicMock()
        mock_commit.__str__ = lambda self: commit_sha
        mock_repo.head.commit = mock_commit

        # Remote — gitpython's IterableList acts as list + attr access
        mock_remote = MagicMock()
        mock_remote.name = "origin"
        mock_remote.url = remote_url
        remotes = MagicMock()
        remotes.__iter__ = lambda self: iter([mock_remote])
        remotes.origin = mock_remote
        mock_repo.remotes = remotes

        return mock_repo

    @patch("src.lib.git_manager.git.Repo")
    def test_basic_repo_info(self, mock_repo_cls, gm, tmp_path):
        mock_repo = self._make_mock_repo()
        mock_repo_cls.return_value = mock_repo

        info = gm.get_repo_info(tmp_path)

        assert info["branch"] == "main"
        assert info["last_commit"] == "abc123def456"[:12]
        assert info["remote_url"] == "https://github.com/user/repo.git"

    @patch("src.lib.git_manager.git.Repo")
    def test_detached_head(self, mock_repo_cls, gm, tmp_path):
        mock_repo = self._make_mock_repo()
        type(mock_repo).active_branch = PropertyMock(side_effect=TypeError("HEAD is detached"))
        mock_repo_cls.return_value = mock_repo

        info = gm.get_repo_info(tmp_path)

        # Falls back to commit hash
        assert info["branch"] == "abc123def456"[:12]

    @patch("src.lib.git_manager.git.Repo")
    def test_empty_repo_no_commits(self, mock_repo_cls, gm, tmp_path):
        mock_repo = self._make_mock_repo()
        type(mock_repo.head).commit = PropertyMock(side_effect=ValueError("no commits"))
        type(mock_repo).active_branch = PropertyMock(side_effect=TypeError("no branch"))
        mock_repo_cls.return_value = mock_repo

        info = gm.get_repo_info(tmp_path)

        assert info["last_commit"] == ""

    @patch("src.lib.git_manager.git.Repo")
    def test_no_origin_remote(self, mock_repo_cls, gm, tmp_path):
        mock_repo = self._make_mock_repo()
        mock_upstream = MagicMock()
        mock_upstream.name = "upstream"
        remotes = MagicMock()
        remotes.__iter__ = lambda self: iter([mock_upstream])
        mock_repo.remotes = remotes
        mock_repo_cls.return_value = mock_repo

        info = gm.get_repo_info(tmp_path)

        assert info["remote_url"] == ""

    @patch("src.lib.git_manager.git.Repo")
    def test_no_remotes(self, mock_repo_cls, gm, tmp_path):
        mock_repo = self._make_mock_repo()
        remotes = MagicMock()
        remotes.__iter__ = lambda self: iter([])
        mock_repo.remotes = remotes
        mock_repo_cls.return_value = mock_repo

        info = gm.get_repo_info(tmp_path)

        assert info["remote_url"] == ""

    @patch("src.lib.git_manager.git.Repo")
    def test_invalid_repo_raises(self, mock_repo_cls, gm, tmp_path):
        mock_repo_cls.side_effect = InvalidGitRepositoryError("not a repo")

        with pytest.raises(InvalidGitRepositoryError):
            gm.get_repo_info(tmp_path)

    @patch("src.lib.git_manager.git.Repo")
    def test_info_returns_dict_with_expected_keys(self, mock_repo_cls, gm, tmp_path):
        mock_repo = self._make_mock_repo()
        mock_repo_cls.return_value = mock_repo

        info = gm.get_repo_info(tmp_path)

        assert set(info.keys()) == {"branch", "last_commit", "remote_url"}

    @patch("src.lib.git_manager.git.Repo")
    def test_feature_branch(self, mock_repo_cls, gm, tmp_path):
        mock_repo = self._make_mock_repo(branch="feature/add-auth")
        mock_repo_cls.return_value = mock_repo

        info = gm.get_repo_info(tmp_path)
        assert info["branch"] == "feature/add-auth"


# ---------------------------------------------------------------------------
# get_recent_commits tests
# ---------------------------------------------------------------------------

class TestGetRecentCommits:
    """Tests for GitManager.get_recent_commits."""

    def _make_commit(self, hexsha, message, author, dt):
        """Create a mock commit object."""
        mock = MagicMock()
        mock.hexsha = hexsha
        mock.message = message
        mock.author = MagicMock()
        mock.author.__str__ = lambda self: author
        mock.committed_datetime = dt
        return mock

    @patch("src.lib.git_manager.git.Repo")
    def test_returns_recent_commits(self, mock_repo_cls, gm, tmp_path):
        dt1 = datetime(2024, 1, 15, 10, 0, 0, tzinfo=timezone.utc)
        dt2 = datetime(2024, 1, 14, 9, 0, 0, tzinfo=timezone.utc)

        commits = [
            self._make_commit("aaa111", "Add feature X\n\nDetailed description", "Alice", dt1),
            self._make_commit("bbb222", "Fix bug Y", "Bob", dt2),
        ]

        mock_repo = MagicMock()
        mock_repo.iter_commits.return_value = iter(commits)
        mock_repo_cls.return_value = mock_repo

        result = gm.get_recent_commits(tmp_path, count=10)

        assert len(result) == 2
        assert result[0]["hash"] == "aaa111"
        assert result[0]["message"] == "Add feature X"  # First line only
        assert result[0]["author"] == "Alice"
        assert result[0]["date"] == dt1.isoformat()

        assert result[1]["hash"] == "bbb222"
        assert result[1]["message"] == "Fix bug Y"

    @patch("src.lib.git_manager.git.Repo")
    def test_default_count_is_10(self, mock_repo_cls, gm, tmp_path):
        mock_repo = MagicMock()
        mock_repo.iter_commits.return_value = iter([])
        mock_repo_cls.return_value = mock_repo

        gm.get_recent_commits(tmp_path)

        mock_repo.iter_commits.assert_called_once_with(max_count=10)

    @patch("src.lib.git_manager.git.Repo")
    def test_custom_count(self, mock_repo_cls, gm, tmp_path):
        mock_repo = MagicMock()
        mock_repo.iter_commits.return_value = iter([])
        mock_repo_cls.return_value = mock_repo

        gm.get_recent_commits(tmp_path, count=5)

        mock_repo.iter_commits.assert_called_once_with(max_count=5)

    @patch("src.lib.git_manager.git.Repo")
    def test_empty_repo_returns_empty_list(self, mock_repo_cls, gm, tmp_path):
        mock_repo = MagicMock()
        mock_repo.iter_commits.side_effect = ValueError("no commits")
        mock_repo_cls.return_value = mock_repo

        result = gm.get_recent_commits(tmp_path)

        assert result == []

    @patch("src.lib.git_manager.git.Repo")
    def test_commit_message_multiline_uses_first_line(self, mock_repo_cls, gm, tmp_path):
        dt = datetime(2024, 1, 15, 10, 0, 0, tzinfo=timezone.utc)
        commit = self._make_commit(
            "ccc333",
            "First line\n\nSecond paragraph\nThird line",
            "Charlie",
            dt,
        )

        mock_repo = MagicMock()
        mock_repo.iter_commits.return_value = iter([commit])
        mock_repo_cls.return_value = mock_repo

        result = gm.get_recent_commits(tmp_path)

        assert result[0]["message"] == "First line"

    @patch("src.lib.git_manager.git.Repo")
    def test_invalid_repo_raises(self, mock_repo_cls, gm, tmp_path):
        mock_repo_cls.side_effect = InvalidGitRepositoryError("not a repo")

        with pytest.raises(InvalidGitRepositoryError):
            gm.get_recent_commits(tmp_path)

    @patch("src.lib.git_manager.git.Repo")
    def test_commit_dict_keys(self, mock_repo_cls, gm, tmp_path):
        dt = datetime(2024, 1, 15, 10, 0, 0, tzinfo=timezone.utc)
        commit = self._make_commit("ddd444", "Some commit", "Dave", dt)

        mock_repo = MagicMock()
        mock_repo.iter_commits.return_value = iter([commit])
        mock_repo_cls.return_value = mock_repo

        result = gm.get_recent_commits(tmp_path)

        assert set(result[0].keys()) == {"hash", "message", "author", "date"}

    @patch("src.lib.git_manager.git.Repo")
    def test_single_commit_repo(self, mock_repo_cls, gm, tmp_path):
        dt = datetime(2024, 6, 1, 12, 0, 0, tzinfo=timezone.utc)
        commit = self._make_commit("eee555", "Initial commit", "Eve", dt)

        mock_repo = MagicMock()
        mock_repo.iter_commits.return_value = iter([commit])
        mock_repo_cls.return_value = mock_repo

        result = gm.get_recent_commits(tmp_path, count=10)

        assert len(result) == 1
        assert result[0]["hash"] == "eee555"
        assert result[0]["message"] == "Initial commit"


# ---------------------------------------------------------------------------
# _ProgressHandler tests
# ---------------------------------------------------------------------------

class TestProgressHandler:
    """Tests for the _ProgressHandler helper."""

    def test_update_with_message(self):
        callback = MagicMock()
        handler = _ProgressHandler(callback)

        handler.update(0, 50, 100, message="Receiving objects")

        callback.assert_called_once_with("Receiving objects")

    def test_update_without_message_shows_count(self):
        callback = MagicMock()
        handler = _ProgressHandler(callback)

        handler.update(0, 50, 100, message="")

        callback.assert_called_once_with("50/100")

    def test_update_without_message_or_max_count_no_call(self):
        callback = MagicMock()
        handler = _ProgressHandler(callback)

        handler.update(0, 50, None, message="")

        callback.assert_not_called()

    def test_multiple_updates(self):
        callback = MagicMock()
        handler = _ProgressHandler(callback)

        handler.update(0, 10, 100, message="Counting objects")
        handler.update(0, 50, 100, message="Receiving objects")
        handler.update(0, 100, 100, message="Resolving deltas")

        assert callback.call_count == 3
