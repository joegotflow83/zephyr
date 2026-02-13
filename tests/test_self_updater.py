"""Tests for the self-update mechanism (src/lib/self_updater.py).

Validates that SelfUpdater correctly:
- Checks for upstream updates via git fetch
- Handles missing/invalid repos gracefully
- Triggers self-update loops through LoopRunner
- Creates the self-update project config properly
- Handles edge cases (no remote, no tracking branch, already running)
"""

import pytest
from pathlib import Path
from unittest.mock import MagicMock, patch

from src.lib.self_updater import SelfUpdater, SELF_UPDATE_PROJECT_ID
from src.lib.models import ProjectConfig
from src.lib.loop_runner import LoopMode, LoopStatus, LoopState


# ── Helpers ─────────────────────────────────────────────────────────


class _MockRemotes(list):
    """List subclass that also supports attribute access (e.g. .origin)."""

    def __init__(self, items=None, **attrs):
        super().__init__(items or [])
        for k, v in attrs.items():
            setattr(self, k, v)


# ── Fixtures ────────────────────────────────────────────────────────


@pytest.fixture
def mock_git_manager():
    """GitManager mock with default valid-repo behavior."""
    gm = MagicMock()
    gm.validate_repo.return_value = True
    return gm


@pytest.fixture
def mock_project_store():
    """ProjectStore mock with no existing self-update project."""
    ps = MagicMock()
    ps.get_project.return_value = None
    return ps


@pytest.fixture
def mock_loop_runner(mock_project_store):
    """LoopRunner mock wired with the mock project store."""
    lr = MagicMock()
    lr._projects = mock_project_store
    lr.start_loop.return_value = LoopState(
        project_id=SELF_UPDATE_PROJECT_ID,
        status=LoopStatus.RUNNING,
        mode=LoopMode.SINGLE,
    )
    return lr


@pytest.fixture
def updater(mock_git_manager, mock_loop_runner):
    """SelfUpdater instance with mocked dependencies."""
    return SelfUpdater(
        git_manager=mock_git_manager,
        loop_runner=mock_loop_runner,
    )


@pytest.fixture
def app_repo(tmp_path):
    """Return a temporary path representing the app repo."""
    return tmp_path / "zephyr-app"


def _make_repo_mock(
    *,
    origin=None,
    local_commit=None,
    tracking=None,
    is_ancestor=True,
):
    """Build a git.Repo mock with remotes supporting iteration + .origin."""
    mock_repo = MagicMock()

    if origin is not None:
        mock_repo.remotes = _MockRemotes([origin], origin=origin)
    else:
        mock_repo.remotes = _MockRemotes()

    if local_commit is not None:
        mock_repo.head.commit = local_commit

    if tracking is not None:
        mock_repo.active_branch.tracking_branch.return_value = tracking
    else:
        mock_repo.active_branch.tracking_branch.return_value = None

    mock_repo.is_ancestor.return_value = is_ancestor
    return mock_repo


# ── SELF_UPDATE_PROJECT_ID constant ──────────────────────────────


def test_self_update_project_id_is_string():
    assert isinstance(SELF_UPDATE_PROJECT_ID, str)
    assert len(SELF_UPDATE_PROJECT_ID) > 0


# ── Constructor ──────────────────────────────────────────────────


def test_constructor_stores_dependencies(mock_git_manager, mock_loop_runner):
    updater = SelfUpdater(mock_git_manager, mock_loop_runner)
    assert updater._git is mock_git_manager
    assert updater._loop_runner is mock_loop_runner


# ── check_for_updates ────────────────────────────────────────────


class TestCheckForUpdates:
    """Tests for SelfUpdater.check_for_updates."""

    def test_invalid_repo_returns_false(self, updater, mock_git_manager, app_repo):
        mock_git_manager.validate_repo.return_value = False
        assert updater.check_for_updates(app_repo) is False

    def test_valid_repo_calls_validate(self, updater, mock_git_manager, app_repo):
        # Will fall into the exception handler since git.Repo is real,
        # but validate_repo is still called first.
        updater.check_for_updates(app_repo)
        mock_git_manager.validate_repo.assert_called_once_with(app_repo)

    def test_no_origin_remote_returns_false(self, updater, app_repo):
        """When repo has no 'origin' remote, return False."""
        mock_repo = _make_repo_mock()  # no origin
        with patch("git.Repo", return_value=mock_repo):
            result = updater.check_for_updates(app_repo)
        assert result is False

    def test_updates_available_returns_true(self, updater, app_repo):
        """When remote is ahead, return True."""
        local_commit = MagicMock()
        remote_commit = MagicMock()
        local_commit.__eq__ = lambda self, other: False
        local_commit.__ne__ = lambda self, other: True

        mock_tracking = MagicMock()
        mock_tracking.commit = remote_commit

        mock_origin = MagicMock()
        mock_origin.name = "origin"

        mock_repo = _make_repo_mock(
            origin=mock_origin,
            local_commit=local_commit,
            tracking=mock_tracking,
            is_ancestor=True,
        )

        with patch("git.Repo", return_value=mock_repo):
            result = updater.check_for_updates(app_repo)
        assert result is True

    def test_no_updates_when_same_commit(self, updater, app_repo):
        """When local HEAD equals remote, return False."""
        commit = MagicMock()

        mock_tracking = MagicMock()
        mock_tracking.commit = commit

        mock_origin = MagicMock()
        mock_origin.name = "origin"

        mock_repo = _make_repo_mock(
            origin=mock_origin,
            local_commit=commit,
            tracking=mock_tracking,
            is_ancestor=True,
        )

        with patch("git.Repo", return_value=mock_repo):
            result = updater.check_for_updates(app_repo)
        assert result is False

    def test_no_tracking_branch_returns_false(self, updater, app_repo):
        """When active branch has no tracking branch, return False."""
        mock_origin = MagicMock()
        mock_origin.name = "origin"

        mock_repo = _make_repo_mock(
            origin=mock_origin,
            local_commit=MagicMock(),
            tracking=None,
        )

        with patch("git.Repo", return_value=mock_repo):
            result = updater.check_for_updates(app_repo)
        assert result is False

    def test_fetch_failure_returns_false(self, updater, app_repo):
        """Network error during fetch returns False gracefully."""
        mock_origin = MagicMock()
        mock_origin.name = "origin"
        mock_origin.fetch.side_effect = Exception("network error")

        mock_repo = _make_repo_mock(origin=mock_origin)

        with patch("git.Repo", return_value=mock_repo):
            result = updater.check_for_updates(app_repo)
        assert result is False

    def test_not_ancestor_returns_false(self, updater, app_repo):
        """When local is NOT an ancestor of remote (diverged), return False."""
        local_commit = MagicMock()
        remote_commit = MagicMock()

        mock_tracking = MagicMock()
        mock_tracking.commit = remote_commit

        mock_origin = MagicMock()
        mock_origin.name = "origin"

        mock_repo = _make_repo_mock(
            origin=mock_origin,
            local_commit=local_commit,
            tracking=mock_tracking,
            is_ancestor=False,
        )

        with patch("git.Repo", return_value=mock_repo):
            result = updater.check_for_updates(app_repo)
        assert result is False

    def test_generic_exception_returns_false(self, updater, app_repo):
        """Any unexpected exception returns False, not raised."""
        with patch("git.Repo", side_effect=RuntimeError("unexpected")):
            result = updater.check_for_updates(app_repo)
        assert result is False

    def test_fetch_is_called_on_origin(self, updater, app_repo):
        """Verify that origin.fetch() is actually invoked."""
        mock_origin = MagicMock()
        mock_origin.name = "origin"

        mock_tracking = MagicMock()
        mock_tracking.commit = MagicMock()

        mock_repo = _make_repo_mock(
            origin=mock_origin,
            local_commit=MagicMock(),
            tracking=mock_tracking,
            is_ancestor=True,
        )

        with patch("git.Repo", return_value=mock_repo):
            updater.check_for_updates(app_repo)
        mock_origin.fetch.assert_called_once()

    def test_accepts_path_object(self, updater, mock_git_manager):
        """Accepts pathlib.Path without error."""
        mock_git_manager.validate_repo.return_value = False
        result = updater.check_for_updates(Path("/some/path"))
        assert result is False


# ── trigger_self_update ──────────────────────────────────────────


class TestTriggerSelfUpdate:
    """Tests for SelfUpdater.trigger_self_update."""

    def test_invalid_repo_raises_value_error(self, updater, mock_git_manager, app_repo):
        mock_git_manager.validate_repo.return_value = False
        with pytest.raises(ValueError, match="Not a valid git repository"):
            updater.trigger_self_update(app_repo)

    def test_validates_repo_before_starting(
        self, updater, mock_git_manager, app_repo
    ):
        updater.trigger_self_update(app_repo)
        mock_git_manager.validate_repo.assert_called_once_with(app_repo)

    def test_starts_loop_with_single_mode(
        self, updater, mock_loop_runner, app_repo
    ):
        updater.trigger_self_update(app_repo)
        mock_loop_runner.start_loop.assert_called_once_with(
            project_id=SELF_UPDATE_PROJECT_ID,
            mode=LoopMode.SINGLE,
        )

    def test_adds_project_to_store_when_missing(
        self, updater, mock_loop_runner, mock_project_store, app_repo
    ):
        mock_project_store.get_project.return_value = None
        updater.trigger_self_update(app_repo)
        mock_project_store.add_project.assert_called_once()

        added_project = mock_project_store.add_project.call_args[0][0]
        assert added_project.id == SELF_UPDATE_PROJECT_ID
        assert added_project.name == "Zephyr Self-Update"
        assert added_project.repo_url == str(app_repo)

    def test_updates_project_in_store_when_existing(
        self, updater, mock_loop_runner, mock_project_store, app_repo
    ):
        existing = ProjectConfig(
            name="Old Self-Update",
            repo_url="/old/path",
            id=SELF_UPDATE_PROJECT_ID,
        )
        mock_project_store.get_project.return_value = existing
        updater.trigger_self_update(app_repo)
        mock_project_store.update_project.assert_called_once()
        mock_project_store.add_project.assert_not_called()

    def test_project_config_has_correct_jtbd(
        self, updater, mock_loop_runner, mock_project_store, app_repo
    ):
        updater.trigger_self_update(app_repo)
        added_project = mock_project_store.add_project.call_args[0][0]
        assert "Zephyr" in added_project.jtbd

    def test_project_repo_url_matches_path(
        self, updater, mock_loop_runner, mock_project_store, app_repo
    ):
        updater.trigger_self_update(app_repo)
        added_project = mock_project_store.add_project.call_args[0][0]
        assert added_project.repo_url == str(app_repo)

    def test_loop_runner_error_propagates(
        self, updater, mock_loop_runner, app_repo
    ):
        """RuntimeError from LoopRunner (e.g., max concurrent) propagates."""
        mock_loop_runner.start_loop.side_effect = RuntimeError("max limit")
        with pytest.raises(RuntimeError, match="max limit"):
            updater.trigger_self_update(app_repo)

    def test_loop_already_active_propagates(
        self, updater, mock_loop_runner, app_repo
    ):
        """ValueError from LoopRunner (already running) propagates."""
        mock_loop_runner.start_loop.side_effect = ValueError("already active")
        with pytest.raises(ValueError, match="already active"):
            updater.trigger_self_update(app_repo)

    def test_project_uses_default_docker_image(
        self, updater, mock_loop_runner, mock_project_store, app_repo
    ):
        updater.trigger_self_update(app_repo)
        added_project = mock_project_store.add_project.call_args[0][0]
        assert added_project.docker_image == "ubuntu:24.04"

    def test_project_id_is_reserved_constant(
        self, updater, mock_loop_runner, mock_project_store, app_repo
    ):
        updater.trigger_self_update(app_repo)
        mock_loop_runner.start_loop.assert_called_once()
        call_kwargs = mock_loop_runner.start_loop.call_args
        assert call_kwargs[1]["project_id"] == SELF_UPDATE_PROJECT_ID

    def test_self_update_with_different_paths(
        self, mock_git_manager, mock_loop_runner, mock_project_store
    ):
        """Verify path is correctly forwarded for different locations."""
        updater = SelfUpdater(mock_git_manager, mock_loop_runner)

        path1 = Path("/home/user/zephyr")
        updater.trigger_self_update(path1)
        project1 = mock_project_store.add_project.call_args[0][0]
        assert project1.repo_url == str(path1)

        mock_project_store.reset_mock()
        mock_project_store.get_project.return_value = None

        path2 = Path("/opt/apps/zephyr-desktop")
        updater.trigger_self_update(path2)
        project2 = mock_project_store.add_project.call_args[0][0]
        assert project2.repo_url == str(path2)

    def test_project_store_get_called_with_correct_id(
        self, updater, mock_loop_runner, mock_project_store, app_repo
    ):
        updater.trigger_self_update(app_repo)
        mock_project_store.get_project.assert_called_once_with(SELF_UPDATE_PROJECT_ID)

    def test_updated_project_has_new_repo_url(
        self, updater, mock_loop_runner, mock_project_store, app_repo
    ):
        """When updating existing project, new repo_url is used."""
        existing = ProjectConfig(
            name="Old Self-Update",
            repo_url="/old/path",
            id=SELF_UPDATE_PROJECT_ID,
        )
        mock_project_store.get_project.return_value = existing
        updater.trigger_self_update(app_repo)
        updated_project = mock_project_store.update_project.call_args[0][0]
        assert updated_project.repo_url == str(app_repo)


# ── Integration-style tests ──────────────────────────────────────


class TestSelfUpdaterIntegration:
    """Higher-level tests combining check + trigger flows."""

    def test_full_update_check_then_trigger(
        self, updater, mock_loop_runner, mock_project_store, app_repo
    ):
        """Simulate checking for updates, finding them, and triggering update."""
        local_commit = MagicMock()
        remote_commit = MagicMock()
        local_commit.__eq__ = lambda self, other: False
        local_commit.__ne__ = lambda self, other: True

        mock_tracking = MagicMock()
        mock_tracking.commit = remote_commit

        mock_origin = MagicMock()
        mock_origin.name = "origin"

        mock_repo = _make_repo_mock(
            origin=mock_origin,
            local_commit=local_commit,
            tracking=mock_tracking,
            is_ancestor=True,
        )

        with patch("git.Repo", return_value=mock_repo):
            has_updates = updater.check_for_updates(app_repo)
        assert has_updates is True

        # Now trigger the update
        updater.trigger_self_update(app_repo)
        mock_loop_runner.start_loop.assert_called_once()

    def test_no_updates_skip_trigger(
        self, updater, mock_git_manager, mock_loop_runner, app_repo
    ):
        """When no updates found, caller should not trigger (logic check)."""
        mock_git_manager.validate_repo.return_value = False
        has_updates = updater.check_for_updates(app_repo)
        assert has_updates is False
        mock_loop_runner.start_loop.assert_not_called()

    def test_updater_reusable_across_multiple_checks(
        self, updater, mock_git_manager, app_repo
    ):
        """SelfUpdater can be called multiple times without issues."""
        mock_git_manager.validate_repo.return_value = False
        for _ in range(3):
            result = updater.check_for_updates(app_repo)
            assert result is False
        assert mock_git_manager.validate_repo.call_count == 3

    def test_check_then_trigger_different_paths(
        self, mock_git_manager, mock_loop_runner, mock_project_store
    ):
        """Check on one path, trigger on another — both work independently."""
        updater = SelfUpdater(mock_git_manager, mock_loop_runner)
        mock_git_manager.validate_repo.return_value = False

        check_path = Path("/check/path")
        result = updater.check_for_updates(check_path)
        assert result is False

        mock_git_manager.validate_repo.return_value = True
        trigger_path = Path("/trigger/path")
        updater.trigger_self_update(trigger_path)
        mock_loop_runner.start_loop.assert_called_once()
