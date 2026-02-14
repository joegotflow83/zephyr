"""Tests for LoopRunner — the core loop execution engine.

Mocks DockerManager, ProjectStore, and CredentialManager to verify
that LoopRunner correctly orchestrates container creation, log streaming,
state transitions, concurrency limits, and cleanup.
"""

import threading
import time
from unittest.mock import MagicMock, patch, call

import pytest

from src.lib.loop_runner import (
    LoopMode,
    LoopRunner,
    LoopState,
    LoopStatus,
    _SERVICE_ENV_MAP,
)
from src.lib.models import ProjectConfig

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def project():
    """A sample project used across tests."""
    return ProjectConfig(
        id="proj-001-abcdef1234567890",
        name="Test Project",
        repo_url="/tmp/test-repo",
        docker_image="ubuntu:24.04",
    )


@pytest.fixture
def mock_project_store(project):
    """ProjectStore that returns our sample project."""
    store = MagicMock()
    store.get_project.return_value = project
    return store


@pytest.fixture
def mock_docker_manager():
    """DockerManager with mocked container operations."""
    dm = MagicMock()
    dm.create_container.return_value = "container-abc123"
    dm.start_container.return_value = None
    dm.stop_container.return_value = None
    dm.remove_container.return_value = None
    dm.get_container_status.return_value = "running"

    # stream_logs returns a mock thread
    mock_thread = MagicMock(spec=threading.Thread)
    mock_thread.daemon = True
    dm.stream_logs.return_value = mock_thread

    return dm


@pytest.fixture
def mock_credential_manager():
    """CredentialManager with some stored keys."""
    cm = MagicMock()

    def _get_key(service):
        keys = {
            "anthropic": "sk-ant-test-key",
            "openai": "sk-oai-test-key",
        }
        return keys.get(service)

    cm.get_api_key.side_effect = _get_key
    return cm


@pytest.fixture
def runner(mock_docker_manager, mock_project_store, mock_credential_manager):
    """LoopRunner wired up with all mocked dependencies."""
    return LoopRunner(
        docker_manager=mock_docker_manager,
        project_store=mock_project_store,
        credential_manager=mock_credential_manager,
    )


# ---------------------------------------------------------------------------
# start_loop — happy path
# ---------------------------------------------------------------------------


class TestStartLoop:
    def test_returns_loop_state(self, runner):
        state = runner.start_loop("proj-001-abcdef1234567890", LoopMode.SINGLE)
        assert isinstance(state, LoopState)
        assert state.project_id == "proj-001-abcdef1234567890"

    def test_state_transitions_to_running(self, runner):
        state = runner.start_loop("proj-001-abcdef1234567890", LoopMode.SINGLE)
        assert state.status == LoopStatus.RUNNING

    def test_state_has_container_id(self, runner):
        state = runner.start_loop("proj-001-abcdef1234567890", LoopMode.SINGLE)
        assert state.container_id == "container-abc123"

    def test_state_has_started_at(self, runner):
        state = runner.start_loop("proj-001-abcdef1234567890", LoopMode.SINGLE)
        assert state.started_at is not None

    def test_state_has_correct_mode(self, runner):
        state = runner.start_loop("proj-001-abcdef1234567890", LoopMode.CONTINUOUS)
        assert state.mode == LoopMode.CONTINUOUS

    def test_creates_container(self, runner, mock_docker_manager, project):
        runner.start_loop("proj-001-abcdef1234567890", LoopMode.SINGLE)
        mock_docker_manager.create_container.assert_called_once()
        call_kwargs = mock_docker_manager.create_container.call_args
        assert call_kwargs.kwargs["project"] is project
        assert call_kwargs.kwargs["repo_path"] == project.repo_url

    def test_starts_container(self, runner, mock_docker_manager):
        runner.start_loop("proj-001-abcdef1234567890", LoopMode.SINGLE)
        mock_docker_manager.start_container.assert_called_once_with("container-abc123")

    def test_starts_log_streaming(self, runner, mock_docker_manager):
        runner.start_loop("proj-001-abcdef1234567890", LoopMode.SINGLE)
        mock_docker_manager.stream_logs.assert_called_once()
        call_kwargs = mock_docker_manager.stream_logs.call_args
        assert call_kwargs.kwargs["container_id"] == "container-abc123"
        assert callable(call_kwargs.kwargs["callback"])

    def test_state_stored_in_runner(self, runner):
        runner.start_loop("proj-001-abcdef1234567890", LoopMode.SINGLE)
        state = runner.get_loop_state("proj-001-abcdef1234567890")
        assert state is not None
        assert state.status == LoopStatus.RUNNING

    def test_injects_env_vars(self, runner, mock_docker_manager):
        runner.start_loop("proj-001-abcdef1234567890", LoopMode.SINGLE)
        call_kwargs = mock_docker_manager.create_container.call_args
        env_vars = call_kwargs.kwargs["env_vars"]
        assert env_vars["ANTHROPIC_API_KEY"] == "sk-ant-test-key"
        assert env_vars["OPENAI_API_KEY"] == "sk-oai-test-key"
        # github key was not set, so should not be in env
        assert "GITHUB_TOKEN" not in env_vars


# ---------------------------------------------------------------------------
# start_loop — validation errors
# ---------------------------------------------------------------------------


class TestStartLoopValidation:
    def test_raises_for_nonexistent_project(self, runner, mock_project_store):
        mock_project_store.get_project.return_value = None
        with pytest.raises(ValueError, match="not found"):
            runner.start_loop("nonexistent-id", LoopMode.SINGLE)

    def test_raises_for_already_running_loop(self, runner):
        runner.start_loop("proj-001-abcdef1234567890", LoopMode.SINGLE)
        with pytest.raises(ValueError, match="already active"):
            runner.start_loop("proj-001-abcdef1234567890", LoopMode.SINGLE)

    def test_raises_for_already_starting_loop(self, runner):
        """If a loop is in STARTING state, reject a second start."""
        runner.start_loop("proj-001-abcdef1234567890", LoopMode.SINGLE)
        # Manually set to STARTING to simulate the edge case
        runner._states["proj-001-abcdef1234567890"].status = LoopStatus.STARTING
        with pytest.raises(ValueError, match="already active"):
            runner.start_loop("proj-001-abcdef1234567890", LoopMode.SINGLE)

    def test_raises_for_paused_loop(self, runner):
        runner.start_loop("proj-001-abcdef1234567890", LoopMode.SINGLE)
        runner._states["proj-001-abcdef1234567890"].status = LoopStatus.PAUSED
        with pytest.raises(ValueError, match="already active"):
            runner.start_loop("proj-001-abcdef1234567890", LoopMode.SINGLE)


# ---------------------------------------------------------------------------
# start_loop — failure handling
# ---------------------------------------------------------------------------


class TestStartLoopFailure:
    def test_state_becomes_failed_on_docker_error(self, runner, mock_docker_manager):
        mock_docker_manager.create_container.side_effect = Exception("Docker broke")
        with pytest.raises(Exception, match="Docker broke"):
            runner.start_loop("proj-001-abcdef1234567890", LoopMode.SINGLE)
        state = runner.get_loop_state("proj-001-abcdef1234567890")
        assert state.status == LoopStatus.FAILED
        assert state.error == "Docker broke"

    def test_semaphore_released_on_failure(self, runner, mock_docker_manager):
        """After a failed start, the semaphore slot should be returned."""
        mock_docker_manager.create_container.side_effect = Exception("fail")
        with pytest.raises(Exception):
            runner.start_loop("proj-001-abcdef1234567890", LoopMode.SINGLE)

        # The semaphore should still have all 5 slots
        # (4 from initial + 1 released on failure = 5)
        # We can verify by starting 5 loops successfully
        mock_docker_manager.create_container.side_effect = None
        mock_docker_manager.create_container.return_value = "ctr-new"
        for i in range(5):
            pid = f"proj-{i:03d}-{'x' * 20}"
            runner._states.pop(pid, None)  # clean state
            project = ProjectConfig(id=pid, name=f"P{i}", repo_url="/tmp/r")
            runner._projects.get_project.return_value = project
            runner.start_loop(pid, LoopMode.SINGLE)


# ---------------------------------------------------------------------------
# Concurrency limit (semaphore)
# ---------------------------------------------------------------------------


class TestConcurrencyLimit:
    def test_rejects_sixth_concurrent_loop(self, runner, mock_project_store):
        """Only 5 loops may run concurrently (default semaphore size)."""
        for i in range(5):
            pid = f"proj-{i:03d}-{'a' * 20}"
            project = ProjectConfig(id=pid, name=f"Project {i}", repo_url="/tmp/r")
            mock_project_store.get_project.return_value = project
            runner.start_loop(pid, LoopMode.SINGLE)

        # 6th should fail
        pid_6 = f"proj-005-{'b' * 20}"
        project_6 = ProjectConfig(id=pid_6, name="Project 5", repo_url="/tmp/r")
        mock_project_store.get_project.return_value = project_6
        with pytest.raises(RuntimeError, match="Maximum concurrent"):
            runner.start_loop(pid_6, LoopMode.SINGLE)

    def test_slot_freed_after_stop(self, runner, mock_project_store):
        """After stopping a loop, a new one can start."""
        pids = []
        for i in range(5):
            pid = f"proj-{i:03d}-{'c' * 20}"
            project = ProjectConfig(id=pid, name=f"Project {i}", repo_url="/tmp/r")
            mock_project_store.get_project.return_value = project
            runner.start_loop(pid, LoopMode.SINGLE)
            pids.append(pid)

        # Stop one
        runner.stop_loop(pids[0])

        # Now a new one should succeed
        pid_new = f"proj-new-{'d' * 20}"
        project_new = ProjectConfig(id=pid_new, name="New Project", repo_url="/tmp/r")
        mock_project_store.get_project.return_value = project_new
        state = runner.start_loop(pid_new, LoopMode.SINGLE)
        assert state.status == LoopStatus.RUNNING

    def test_custom_max_concurrent(
        self, mock_docker_manager, mock_project_store, mock_credential_manager
    ):
        """LoopRunner respects a custom max_concurrent value."""
        runner = LoopRunner(
            docker_manager=mock_docker_manager,
            project_store=mock_project_store,
            credential_manager=mock_credential_manager,
            max_concurrent=2,
        )
        for i in range(2):
            pid = f"proj-{i:03d}-{'e' * 20}"
            project = ProjectConfig(id=pid, name=f"P{i}", repo_url="/tmp/r")
            mock_project_store.get_project.return_value = project
            runner.start_loop(pid, LoopMode.SINGLE)

        # 3rd should fail
        pid_3 = f"proj-002-{'f' * 20}"
        project_3 = ProjectConfig(id=pid_3, name="P2", repo_url="/tmp/r")
        mock_project_store.get_project.return_value = project_3
        with pytest.raises(RuntimeError, match="Maximum concurrent"):
            runner.start_loop(pid_3, LoopMode.SINGLE)


# ---------------------------------------------------------------------------
# stop_loop
# ---------------------------------------------------------------------------


class TestStopLoop:
    def test_transitions_to_stopped(self, runner):
        runner.start_loop("proj-001-abcdef1234567890", LoopMode.SINGLE)
        runner.stop_loop("proj-001-abcdef1234567890")
        state = runner.get_loop_state("proj-001-abcdef1234567890")
        assert state.status == LoopStatus.STOPPED

    def test_stops_container(self, runner, mock_docker_manager):
        runner.start_loop("proj-001-abcdef1234567890", LoopMode.SINGLE)
        runner.stop_loop("proj-001-abcdef1234567890")
        mock_docker_manager.stop_container.assert_called_once_with("container-abc123")

    def test_removes_container(self, runner, mock_docker_manager):
        runner.start_loop("proj-001-abcdef1234567890", LoopMode.SINGLE)
        runner.stop_loop("proj-001-abcdef1234567890")
        mock_docker_manager.remove_container.assert_called_once_with(
            "container-abc123", force=True
        )

    def test_clears_container_id(self, runner):
        runner.start_loop("proj-001-abcdef1234567890", LoopMode.SINGLE)
        runner.stop_loop("proj-001-abcdef1234567890")
        state = runner.get_loop_state("proj-001-abcdef1234567890")
        assert state.container_id is None

    def test_raises_for_no_active_loop(self, runner):
        with pytest.raises(ValueError, match="No active loop"):
            runner.stop_loop("nonexistent-project")

    def test_raises_for_already_stopped_loop(self, runner):
        runner.start_loop("proj-001-abcdef1234567890", LoopMode.SINGLE)
        runner.stop_loop("proj-001-abcdef1234567890")
        with pytest.raises(ValueError, match="No active loop"):
            runner.stop_loop("proj-001-abcdef1234567890")

    def test_handles_docker_error_gracefully(self, runner, mock_docker_manager):
        """stop_loop should still mark STOPPED even if Docker ops fail."""
        runner.start_loop("proj-001-abcdef1234567890", LoopMode.SINGLE)
        mock_docker_manager.stop_container.side_effect = Exception("timeout")
        # Should not raise
        runner.stop_loop("proj-001-abcdef1234567890")
        state = runner.get_loop_state("proj-001-abcdef1234567890")
        assert state.status == LoopStatus.STOPPED

    def test_releases_semaphore_slot(self, runner, mock_project_store):
        """After stop, the concurrency slot is freed for reuse."""
        runner.start_loop("proj-001-abcdef1234567890", LoopMode.SINGLE)
        runner.stop_loop("proj-001-abcdef1234567890")

        # Should be able to start a new loop
        pid_new = "proj-new-abcdef1234567890"
        project = ProjectConfig(id=pid_new, name="New", repo_url="/tmp/r")
        mock_project_store.get_project.return_value = project
        state = runner.start_loop(pid_new, LoopMode.SINGLE)
        assert state.status == LoopStatus.RUNNING


# ---------------------------------------------------------------------------
# get_loop_state / get_all_states
# ---------------------------------------------------------------------------


class TestGetState:
    def test_get_loop_state_returns_none_for_unknown(self, runner):
        assert runner.get_loop_state("unknown-id") is None

    def test_get_loop_state_returns_state(self, runner):
        runner.start_loop("proj-001-abcdef1234567890", LoopMode.SINGLE)
        state = runner.get_loop_state("proj-001-abcdef1234567890")
        assert state is not None
        assert state.project_id == "proj-001-abcdef1234567890"

    def test_get_all_states_empty(self, runner):
        assert runner.get_all_states() == {}

    def test_get_all_states_multiple(self, runner, mock_project_store):
        for i in range(3):
            pid = f"proj-{i:03d}-{'g' * 20}"
            project = ProjectConfig(id=pid, name=f"P{i}", repo_url="/tmp/r")
            mock_project_store.get_project.return_value = project
            runner.start_loop(pid, LoopMode.SINGLE)

        states = runner.get_all_states()
        assert len(states) == 3

    def test_get_all_states_returns_copy(self, runner):
        runner.start_loop("proj-001-abcdef1234567890", LoopMode.SINGLE)
        states = runner.get_all_states()
        states.clear()
        # Original should be unaffected
        assert runner.get_loop_state("proj-001-abcdef1234567890") is not None


# ---------------------------------------------------------------------------
# Credential injection
# ---------------------------------------------------------------------------


class TestCredentialInjection:
    def test_injects_only_available_keys(self, runner, mock_docker_manager):
        runner.start_loop("proj-001-abcdef1234567890", LoopMode.SINGLE)
        call_kwargs = mock_docker_manager.create_container.call_args
        env_vars = call_kwargs.kwargs["env_vars"]
        assert "ANTHROPIC_API_KEY" in env_vars
        assert "OPENAI_API_KEY" in env_vars
        assert "GITHUB_TOKEN" not in env_vars

    def test_no_keys_produces_empty_env(
        self,
        mock_docker_manager,
        mock_project_store,
    ):
        cm = MagicMock()
        cm.get_api_key.return_value = None
        runner = LoopRunner(
            docker_manager=mock_docker_manager,
            project_store=mock_project_store,
            credential_manager=cm,
        )
        runner.start_loop("proj-001-abcdef1234567890", LoopMode.SINGLE)
        call_kwargs = mock_docker_manager.create_container.call_args
        env_vars = call_kwargs.kwargs["env_vars"]
        assert env_vars == {}


# ---------------------------------------------------------------------------
# Log callback
# ---------------------------------------------------------------------------


class TestLogCallback:
    def test_callback_updates_last_log(self, runner, mock_docker_manager):
        """The log callback should update the state's last_log field."""
        runner.start_loop("proj-001-abcdef1234567890", LoopMode.SINGLE)
        # Extract the callback that was passed to stream_logs
        call_kwargs = mock_docker_manager.stream_logs.call_args
        callback = call_kwargs.kwargs["callback"]

        callback("Building project...")
        state = runner.get_loop_state("proj-001-abcdef1234567890")
        assert state.last_log == "Building project..."

        callback("Tests passed!")
        state = runner.get_loop_state("proj-001-abcdef1234567890")
        assert state.last_log == "Tests passed!"


# ---------------------------------------------------------------------------
# Service env map
# ---------------------------------------------------------------------------


class TestServiceEnvMap:
    def test_anthropic_mapping(self):
        assert _SERVICE_ENV_MAP["anthropic"] == "ANTHROPIC_API_KEY"

    def test_openai_mapping(self):
        assert _SERVICE_ENV_MAP["openai"] == "OPENAI_API_KEY"

    def test_github_mapping(self):
        assert _SERVICE_ENV_MAP["github"] == "GITHUB_TOKEN"


# ---------------------------------------------------------------------------
# Restarting after stop / failure
# ---------------------------------------------------------------------------


class TestRestart:
    def test_can_restart_after_stop(self, runner):
        runner.start_loop("proj-001-abcdef1234567890", LoopMode.SINGLE)
        runner.stop_loop("proj-001-abcdef1234567890")
        state = runner.start_loop("proj-001-abcdef1234567890", LoopMode.CONTINUOUS)
        assert state.status == LoopStatus.RUNNING
        assert state.mode == LoopMode.CONTINUOUS

    def test_can_restart_after_failure(self, runner, mock_docker_manager):
        mock_docker_manager.create_container.side_effect = Exception("fail")
        with pytest.raises(Exception):
            runner.start_loop("proj-001-abcdef1234567890", LoopMode.SINGLE)

        # Reset mock
        mock_docker_manager.create_container.side_effect = None
        mock_docker_manager.create_container.return_value = "ctr-new"

        state = runner.start_loop("proj-001-abcdef1234567890", LoopMode.SINGLE)
        assert state.status == LoopStatus.RUNNING

    def test_can_restart_after_completed(self, runner):
        runner.start_loop("proj-001-abcdef1234567890", LoopMode.SINGLE)
        # Simulate completion
        runner._states["proj-001-abcdef1234567890"].status = LoopStatus.COMPLETED
        # Need to release semaphore since we're simulating
        runner._semaphore.release()

        state = runner.start_loop("proj-001-abcdef1234567890", LoopMode.SINGLE)
        assert state.status == LoopStatus.RUNNING


# ---------------------------------------------------------------------------
# Lifecycle callbacks
# ---------------------------------------------------------------------------


class TestLifecycleCallbacks:
    """Verify add_completion_callback and add_failure_callback work."""

    def test_add_completion_callback(self, runner):
        cb = MagicMock()
        runner.add_completion_callback(cb)
        assert cb in runner._on_loop_completed

    def test_add_failure_callback(self, runner):
        cb = MagicMock()
        runner.add_failure_callback(cb)
        assert cb in runner._on_loop_failed

    def test_multiple_callbacks(self, runner):
        cb1, cb2 = MagicMock(), MagicMock()
        runner.add_completion_callback(cb1)
        runner.add_completion_callback(cb2)
        assert len(runner._on_loop_completed) == 2

    def test_failure_callback_called_on_start_error(self, runner, mock_docker_manager):
        cb = MagicMock()
        runner.add_failure_callback(cb)
        mock_docker_manager.create_container.side_effect = Exception("boom")

        with pytest.raises(Exception):
            runner.start_loop("proj-001-abcdef1234567890", LoopMode.SINGLE)

        cb.assert_called_once_with("proj-001-abcdef1234567890", "boom")

    def test_completion_callback_called_on_container_exit(
        self, runner, mock_docker_manager
    ):
        """When _run_loop detects container exited, completion callbacks fire."""
        cb = MagicMock()
        runner.add_completion_callback(cb)

        # Make the monitor thread exit immediately by returning "exited"
        mock_docker_manager.get_container_status.return_value = "exited"

        runner.start_loop("proj-001-abcdef1234567890", LoopMode.SINGLE)
        # Wait for monitor thread to process
        thread = runner._threads.get("proj-001-abcdef1234567890")
        if thread:
            thread.join(timeout=5)

        cb.assert_called_once_with("proj-001-abcdef1234567890", 1)

    def test_failure_callback_called_on_monitor_exception(
        self, runner, mock_docker_manager
    ):
        """When _run_loop raises, failure callbacks fire."""
        cb = MagicMock()
        runner.add_failure_callback(cb)

        mock_docker_manager.get_container_status.side_effect = RuntimeError("oops")

        runner.start_loop("proj-001-abcdef1234567890", LoopMode.SINGLE)
        thread = runner._threads.get("proj-001-abcdef1234567890")
        if thread:
            thread.join(timeout=5)

        cb.assert_called_once_with("proj-001-abcdef1234567890", "oops")

    def test_callback_exception_does_not_propagate(self, runner, mock_docker_manager):
        """If a callback raises, it should be caught and not crash the loop."""
        bad_cb = MagicMock(side_effect=Exception("callback bug"))
        good_cb = MagicMock()
        runner.add_completion_callback(bad_cb)
        runner.add_completion_callback(good_cb)

        mock_docker_manager.get_container_status.return_value = "exited"
        runner.start_loop("proj-001-abcdef1234567890", LoopMode.SINGLE)
        thread = runner._threads.get("proj-001-abcdef1234567890")
        if thread:
            thread.join(timeout=5)

        bad_cb.assert_called_once()
        good_cb.assert_called_once()
