"""Integration tests for the loop execution workflow.

Tests the full loop lifecycle using real file I/O for ConfigManager,
ProjectStore, and CredentialManager — only Docker and keyring are mocked.
This validates that the backend services compose correctly end-to-end:

  ConfigManager -> ProjectStore (project data)
  ConfigManager -> CredentialManager (API key index)
  CredentialManager + ProjectStore + DockerManager -> LoopRunner

Why integration tests matter here:
  Unit tests mock every dependency individually, so they can't catch
  wiring issues between real services — e.g. credential env vars not
  matching what LoopRunner injects, or LoopState not reflecting actual
  container operations. These tests use real services where possible
  to surface those composition bugs.
"""

import threading
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from src.lib.config_manager import ConfigManager
from src.lib.credential_manager import CredentialManager
from src.lib.loop_runner import LoopMode, LoopRunner, LoopState, LoopStatus
from src.lib.models import ProjectConfig
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
def mock_keyring():
    """Mock keyring module to avoid real system keyring access."""
    store = {}
    with patch("src.lib.credential_manager.keyring") as kr:
        kr.set_password = MagicMock(
            side_effect=lambda app, svc, key: store.__setitem__(
                (app, svc), key
            )
        )
        kr.get_password = MagicMock(
            side_effect=lambda app, svc: store.get((app, svc))
        )
        kr.delete_password = MagicMock(
            side_effect=lambda app, svc: store.pop((app, svc), None)
        )
        yield kr


@pytest.fixture
def credential_manager(config_manager, mock_keyring):
    """CredentialManager with mocked keyring, real config index."""
    return CredentialManager(config_manager)


@pytest.fixture
def mock_docker():
    """Mock DockerManager that simulates successful container ops."""
    dm = MagicMock()
    dm.is_docker_available.return_value = True
    dm.create_container.return_value = "container-abc123"
    dm.start_container.return_value = None
    dm.stop_container.return_value = None
    dm.remove_container.return_value = None
    # Default: container is running; tests can override
    dm.get_container_status.return_value = "running"
    # stream_logs returns a mock thread
    mock_thread = MagicMock(spec=threading.Thread)
    mock_thread.daemon = True
    dm.stream_logs.return_value = mock_thread
    return dm


@pytest.fixture
def sample_project():
    """A fully-populated ProjectConfig for testing."""
    return ProjectConfig(
        name="Test App",
        repo_url="https://github.com/user/test-app.git",
        jtbd="Run automated builds",
        custom_prompts={"PROMPT_build.md": "Build all targets"},
        docker_image="python:3.12-slim",
    )


@pytest.fixture
def second_project():
    """A second project for multi-loop scenarios."""
    return ProjectConfig(
        name="Backend Service",
        repo_url="/home/user/repos/backend",
        jtbd="Keep CI green",
        docker_image="node:20",
    )


@pytest.fixture
def loop_runner(mock_docker, project_store, credential_manager):
    """LoopRunner wired to real ProjectStore/CredentialManager, mocked Docker."""
    return LoopRunner(
        docker_manager=mock_docker,
        project_store=project_store,
        credential_manager=credential_manager,
    )


# ---------------------------------------------------------------------------
# 1. Basic loop start/stop lifecycle
# ---------------------------------------------------------------------------


class TestLoopStartStop:
    """End-to-end: add project -> start loop -> verify -> stop -> verify."""

    def test_start_loop_creates_container(
        self, loop_runner, project_store, sample_project, mock_docker
    ):
        project_store.add_project(sample_project)

        state = loop_runner.start_loop(sample_project.id, LoopMode.SINGLE)

        assert state.status == LoopStatus.RUNNING
        assert state.container_id == "container-abc123"
        assert state.project_id == sample_project.id
        assert state.mode == LoopMode.SINGLE
        assert state.started_at is not None
        mock_docker.create_container.assert_called_once()

    def test_start_loop_passes_correct_project(
        self, loop_runner, project_store, sample_project, mock_docker
    ):
        project_store.add_project(sample_project)
        loop_runner.start_loop(sample_project.id, LoopMode.SINGLE)

        call_args = mock_docker.create_container.call_args
        project_arg = call_args.kwargs.get("project") or call_args[0][0]
        assert project_arg.id == sample_project.id
        assert project_arg.name == "Test App"
        assert project_arg.docker_image == "python:3.12-slim"

    def test_start_loop_passes_repo_as_path(
        self, loop_runner, project_store, sample_project, mock_docker
    ):
        project_store.add_project(sample_project)
        loop_runner.start_loop(sample_project.id, LoopMode.SINGLE)

        call_args = mock_docker.create_container.call_args
        repo_path = call_args.kwargs.get("repo_path") or call_args[0][1]
        assert repo_path == sample_project.repo_url

    def test_start_container_called_after_create(
        self, loop_runner, project_store, sample_project, mock_docker
    ):
        project_store.add_project(sample_project)
        loop_runner.start_loop(sample_project.id, LoopMode.SINGLE)

        mock_docker.start_container.assert_called_once_with("container-abc123")

    def test_log_streaming_started(
        self, loop_runner, project_store, sample_project, mock_docker
    ):
        project_store.add_project(sample_project)
        loop_runner.start_loop(sample_project.id, LoopMode.SINGLE)

        mock_docker.stream_logs.assert_called_once()
        call_kwargs = mock_docker.stream_logs.call_args.kwargs
        assert call_kwargs.get("container_id") == "container-abc123"
        assert callable(
            call_kwargs.get("callback")
            or mock_docker.stream_logs.call_args[0][1]
        )

    def test_stop_loop_stops_container(
        self, loop_runner, project_store, sample_project, mock_docker
    ):
        project_store.add_project(sample_project)
        loop_runner.start_loop(sample_project.id, LoopMode.SINGLE)

        loop_runner.stop_loop(sample_project.id)

        mock_docker.stop_container.assert_called_once_with("container-abc123")
        mock_docker.remove_container.assert_called_once_with(
            "container-abc123", force=True
        )

    def test_stop_loop_transitions_to_stopped(
        self, loop_runner, project_store, sample_project, mock_docker
    ):
        project_store.add_project(sample_project)
        loop_runner.start_loop(sample_project.id, LoopMode.SINGLE)

        loop_runner.stop_loop(sample_project.id)

        state = loop_runner.get_loop_state(sample_project.id)
        assert state.status == LoopStatus.STOPPED
        assert state.container_id is None

    def test_full_start_stop_cycle(
        self, loop_runner, project_store, sample_project, mock_docker
    ):
        """Add -> start -> verify running -> stop -> verify stopped."""
        project_store.add_project(sample_project)

        # Start
        state = loop_runner.start_loop(sample_project.id, LoopMode.CONTINUOUS)
        assert state.status == LoopStatus.RUNNING
        assert state.container_id == "container-abc123"

        # Stop
        loop_runner.stop_loop(sample_project.id)
        state = loop_runner.get_loop_state(sample_project.id)
        assert state.status == LoopStatus.STOPPED
        assert state.container_id is None


# ---------------------------------------------------------------------------
# 2. Credential injection
# ---------------------------------------------------------------------------


class TestCredentialInjection:
    """Verify API keys flow from CredentialManager into container env vars."""

    def test_anthropic_key_injected(
        self,
        loop_runner,
        project_store,
        credential_manager,
        sample_project,
        mock_docker,
    ):
        project_store.add_project(sample_project)
        credential_manager.store_api_key("anthropic", "sk-ant-test-key")

        loop_runner.start_loop(sample_project.id, LoopMode.SINGLE)

        call_args = mock_docker.create_container.call_args
        env_vars = call_args.kwargs.get("env_vars") or call_args[0][2]
        assert env_vars.get("ANTHROPIC_API_KEY") == "sk-ant-test-key"

    def test_multiple_keys_injected(
        self,
        loop_runner,
        project_store,
        credential_manager,
        sample_project,
        mock_docker,
    ):
        project_store.add_project(sample_project)
        credential_manager.store_api_key("anthropic", "sk-ant-key")
        credential_manager.store_api_key("openai", "sk-openai-key")
        credential_manager.store_api_key("github", "ghp-token")

        loop_runner.start_loop(sample_project.id, LoopMode.SINGLE)

        call_args = mock_docker.create_container.call_args
        env_vars = call_args.kwargs.get("env_vars") or call_args[0][2]
        assert env_vars["ANTHROPIC_API_KEY"] == "sk-ant-key"
        assert env_vars["OPENAI_API_KEY"] == "sk-openai-key"
        assert env_vars["GITHUB_TOKEN"] == "ghp-token"

    def test_no_keys_means_empty_env(
        self,
        loop_runner,
        project_store,
        sample_project,
        mock_docker,
    ):
        project_store.add_project(sample_project)

        loop_runner.start_loop(sample_project.id, LoopMode.SINGLE)

        call_args = mock_docker.create_container.call_args
        env_vars = call_args.kwargs.get("env_vars", {})
        assert env_vars == {}

    def test_deleted_key_not_injected(
        self,
        loop_runner,
        project_store,
        credential_manager,
        sample_project,
        mock_docker,
    ):
        project_store.add_project(sample_project)
        credential_manager.store_api_key("anthropic", "old-key")
        credential_manager.delete_api_key("anthropic")

        loop_runner.start_loop(sample_project.id, LoopMode.SINGLE)

        call_args = mock_docker.create_container.call_args
        env_vars = call_args.kwargs.get("env_vars", {})
        assert "ANTHROPIC_API_KEY" not in env_vars

    def test_credential_index_persists_across_instances(
        self,
        config_manager,
        mock_keyring,
        project_store,
        sample_project,
        mock_docker,
    ):
        """Credential index file survives CredentialManager recreation."""
        cm1 = CredentialManager(config_manager)
        cm1.store_api_key("anthropic", "key-1")

        # New CredentialManager on same config dir sees the key
        cm2 = CredentialManager(config_manager)
        assert cm2.get_api_key("anthropic") == "key-1"
        assert "anthropic" in cm2.list_services()

        # LoopRunner with cm2 injects the key
        project_store.add_project(sample_project)
        runner = LoopRunner(mock_docker, project_store, cm2)
        runner.start_loop(sample_project.id, LoopMode.SINGLE)

        call_args = mock_docker.create_container.call_args
        env_vars = call_args.kwargs.get("env_vars") or call_args[0][2]
        assert env_vars["ANTHROPIC_API_KEY"] == "key-1"


# ---------------------------------------------------------------------------
# 3. LoopState tracking
# ---------------------------------------------------------------------------


class TestLoopStateTracking:
    """Verify LoopState is maintained correctly through the lifecycle."""

    def test_initial_state_fields(
        self, loop_runner, project_store, sample_project
    ):
        project_store.add_project(sample_project)
        state = loop_runner.start_loop(sample_project.id, LoopMode.SINGLE)

        assert state.project_id == sample_project.id
        assert state.container_id == "container-abc123"
        assert state.mode == LoopMode.SINGLE
        assert state.status == LoopStatus.RUNNING
        assert state.iteration == 0
        assert state.started_at is not None
        assert state.last_log == ""
        assert state.commits_detected == []
        assert state.error is None

    def test_get_loop_state_returns_current(
        self, loop_runner, project_store, sample_project
    ):
        project_store.add_project(sample_project)
        loop_runner.start_loop(sample_project.id, LoopMode.SINGLE)

        state = loop_runner.get_loop_state(sample_project.id)
        assert state is not None
        assert state.status == LoopStatus.RUNNING

    def test_get_all_states_includes_loop(
        self, loop_runner, project_store, sample_project
    ):
        project_store.add_project(sample_project)
        loop_runner.start_loop(sample_project.id, LoopMode.SINGLE)

        all_states = loop_runner.get_all_states()
        assert sample_project.id in all_states
        assert all_states[sample_project.id].status == LoopStatus.RUNNING

    def test_state_after_stop(
        self, loop_runner, project_store, sample_project
    ):
        project_store.add_project(sample_project)
        loop_runner.start_loop(sample_project.id, LoopMode.SINGLE)
        loop_runner.stop_loop(sample_project.id)

        state = loop_runner.get_loop_state(sample_project.id)
        assert state.status == LoopStatus.STOPPED
        assert state.container_id is None
        assert state.error is None

    def test_state_serialization_round_trip(
        self, loop_runner, project_store, sample_project
    ):
        project_store.add_project(sample_project)
        state = loop_runner.start_loop(sample_project.id, LoopMode.CONTINUOUS)

        data = state.to_dict()
        restored = LoopState.from_dict(data)

        assert restored.project_id == state.project_id
        assert restored.container_id == state.container_id
        assert restored.mode == state.mode
        assert restored.status == state.status
        assert restored.iteration == state.iteration
        assert restored.started_at == state.started_at

    def test_nonexistent_project_state_is_none(self, loop_runner):
        assert loop_runner.get_loop_state("nonexistent-id") is None

    def test_continuous_mode_recorded(
        self, loop_runner, project_store, sample_project
    ):
        project_store.add_project(sample_project)
        state = loop_runner.start_loop(sample_project.id, LoopMode.CONTINUOUS)
        assert state.mode == LoopMode.CONTINUOUS

    def test_scheduled_mode_recorded(
        self, loop_runner, project_store, sample_project
    ):
        project_store.add_project(sample_project)
        state = loop_runner.start_loop(sample_project.id, LoopMode.SCHEDULED)
        assert state.mode == LoopMode.SCHEDULED


# ---------------------------------------------------------------------------
# 4. Log callback updates LoopState
# ---------------------------------------------------------------------------


class TestLogCallbackUpdatesState:
    """Verify log lines from Docker flow into LoopState.last_log."""

    def test_log_callback_updates_last_log(
        self, loop_runner, project_store, sample_project, mock_docker
    ):
        project_store.add_project(sample_project)
        loop_runner.start_loop(sample_project.id, LoopMode.SINGLE)

        # Extract the callback that was passed to stream_logs
        callback = mock_docker.stream_logs.call_args.kwargs.get("callback")
        if callback is None:
            callback = mock_docker.stream_logs.call_args[0][1]

        # Simulate log lines arriving
        callback("Building project...")
        state = loop_runner.get_loop_state(sample_project.id)
        assert state.last_log == "Building project..."

        callback("Tests passing: 42/42")
        state = loop_runner.get_loop_state(sample_project.id)
        assert state.last_log == "Tests passing: 42/42"

    def test_log_callback_multiple_lines(
        self, loop_runner, project_store, sample_project, mock_docker
    ):
        project_store.add_project(sample_project)
        loop_runner.start_loop(sample_project.id, LoopMode.SINGLE)

        callback = mock_docker.stream_logs.call_args.kwargs.get("callback")
        if callback is None:
            callback = mock_docker.stream_logs.call_args[0][1]

        lines = [
            "======================== LOOP 1 ========================",
            "Running iteration 1...",
            "[main abc1234] Fix bug in auth module",
            "All tests passed.",
        ]
        for line in lines:
            callback(line)

        state = loop_runner.get_loop_state(sample_project.id)
        assert state.last_log == "All tests passed."

    def test_log_callback_after_stop_is_safe(
        self, loop_runner, project_store, sample_project, mock_docker
    ):
        """Calling the log callback after stop shouldn't crash."""
        project_store.add_project(sample_project)
        loop_runner.start_loop(sample_project.id, LoopMode.SINGLE)

        callback = mock_docker.stream_logs.call_args.kwargs.get("callback")
        if callback is None:
            callback = mock_docker.stream_logs.call_args[0][1]

        loop_runner.stop_loop(sample_project.id)

        # Should not raise — the state still exists, just STOPPED
        callback("Late log line")
        state = loop_runner.get_loop_state(sample_project.id)
        assert state.last_log == "Late log line"


# ---------------------------------------------------------------------------
# 5. Error handling
# ---------------------------------------------------------------------------


class TestErrorHandling:
    """Verify error states are handled correctly across layers."""

    def test_start_nonexistent_project_raises(self, loop_runner):
        with pytest.raises(ValueError, match="not found"):
            loop_runner.start_loop("nonexistent-id", LoopMode.SINGLE)

    def test_double_start_raises(
        self, loop_runner, project_store, sample_project
    ):
        project_store.add_project(sample_project)
        loop_runner.start_loop(sample_project.id, LoopMode.SINGLE)

        with pytest.raises(ValueError, match="already active"):
            loop_runner.start_loop(sample_project.id, LoopMode.SINGLE)

    def test_stop_without_start_raises(
        self, loop_runner, project_store, sample_project
    ):
        project_store.add_project(sample_project)

        with pytest.raises(ValueError, match="No active loop"):
            loop_runner.stop_loop(sample_project.id)

    def test_stop_already_stopped_raises(
        self, loop_runner, project_store, sample_project
    ):
        project_store.add_project(sample_project)
        loop_runner.start_loop(sample_project.id, LoopMode.SINGLE)
        loop_runner.stop_loop(sample_project.id)

        with pytest.raises(ValueError, match="No active loop"):
            loop_runner.stop_loop(sample_project.id)

    def test_container_create_failure_marks_failed(
        self, project_store, credential_manager, sample_project
    ):
        project_store.add_project(sample_project)

        failing_docker = MagicMock()
        failing_docker.create_container.side_effect = RuntimeError(
            "Docker daemon crashed"
        )
        runner = LoopRunner(failing_docker, project_store, credential_manager)

        with pytest.raises(RuntimeError, match="Docker daemon crashed"):
            runner.start_loop(sample_project.id, LoopMode.SINGLE)

        state = runner.get_loop_state(sample_project.id)
        assert state.status == LoopStatus.FAILED
        assert "Docker daemon crashed" in state.error

    def test_container_start_failure_marks_failed(
        self, project_store, credential_manager, sample_project
    ):
        project_store.add_project(sample_project)

        failing_docker = MagicMock()
        failing_docker.create_container.return_value = "container-xyz"
        failing_docker.start_container.side_effect = RuntimeError(
            "Port already in use"
        )
        runner = LoopRunner(failing_docker, project_store, credential_manager)

        with pytest.raises(RuntimeError, match="Port already in use"):
            runner.start_loop(sample_project.id, LoopMode.SINGLE)

        state = runner.get_loop_state(sample_project.id)
        assert state.status == LoopStatus.FAILED
        assert "Port already in use" in state.error

    def test_stop_container_error_still_marks_stopped(
        self, loop_runner, project_store, sample_project, mock_docker
    ):
        """Even if stop_container throws, state transitions to STOPPED."""
        project_store.add_project(sample_project)
        loop_runner.start_loop(sample_project.id, LoopMode.SINGLE)

        mock_docker.stop_container.side_effect = RuntimeError("Already dead")
        loop_runner.stop_loop(sample_project.id)

        state = loop_runner.get_loop_state(sample_project.id)
        assert state.status == LoopStatus.STOPPED


# ---------------------------------------------------------------------------
# 6. Concurrency limits
# ---------------------------------------------------------------------------


class TestConcurrencyLimits:
    """Verify semaphore-based concurrency limit works end-to-end."""

    def _make_project(self, name, store):
        """Helper: create and persist a project, return it."""
        p = ProjectConfig(
            name=name,
            repo_url=f"https://github.com/user/{name.lower().replace(' ', '-')}",
        )
        store.add_project(p)
        return p

    def test_max_concurrent_enforced(
        self, project_store, credential_manager, mock_docker
    ):
        runner = LoopRunner(
            mock_docker, project_store, credential_manager, max_concurrent=2
        )

        p1 = self._make_project("Proj 1", project_store)
        p2 = self._make_project("Proj 2", project_store)
        p3 = self._make_project("Proj 3", project_store)

        runner.start_loop(p1.id, LoopMode.CONTINUOUS)
        runner.start_loop(p2.id, LoopMode.CONTINUOUS)

        with pytest.raises(RuntimeError, match="Maximum concurrent"):
            runner.start_loop(p3.id, LoopMode.CONTINUOUS)

    def test_stop_frees_slot(
        self, project_store, credential_manager, mock_docker
    ):
        runner = LoopRunner(
            mock_docker, project_store, credential_manager, max_concurrent=2
        )

        p1 = self._make_project("Proj A", project_store)
        p2 = self._make_project("Proj B", project_store)
        p3 = self._make_project("Proj C", project_store)

        runner.start_loop(p1.id, LoopMode.CONTINUOUS)
        runner.start_loop(p2.id, LoopMode.CONTINUOUS)

        # Stop one to free a slot
        runner.stop_loop(p1.id)

        # Now p3 should be startable
        state = runner.start_loop(p3.id, LoopMode.CONTINUOUS)
        assert state.status == LoopStatus.RUNNING

    def test_failed_start_releases_semaphore(
        self, project_store, credential_manager
    ):
        failing_docker = MagicMock()
        failing_docker.create_container.side_effect = RuntimeError("Boom")

        runner = LoopRunner(
            failing_docker, project_store, credential_manager, max_concurrent=1
        )

        p1 = ProjectConfig(name="Fail", repo_url="https://example.com/fail")
        project_store.add_project(p1)

        with pytest.raises(RuntimeError, match="Boom"):
            runner.start_loop(p1.id, LoopMode.SINGLE)

        # The semaphore slot should be released, allowing another start
        p2 = ProjectConfig(name="Pass", repo_url="https://example.com/pass")
        project_store.add_project(p2)

        # Need a working docker for p2
        working_docker = MagicMock()
        working_docker.create_container.return_value = "container-p2"
        working_docker.stream_logs.return_value = MagicMock(
            spec=threading.Thread
        )
        runner._docker = working_docker

        state = runner.start_loop(p2.id, LoopMode.SINGLE)
        assert state.status == LoopStatus.RUNNING


# ---------------------------------------------------------------------------
# 7. Container exit detection (monitor thread)
# ---------------------------------------------------------------------------


class TestContainerExitDetection:
    """Verify the monitor thread detects container exit and updates state."""

    def test_container_exit_transitions_to_completed(
        self, project_store, credential_manager, sample_project
    ):
        """When container exits, status should become COMPLETED."""
        project_store.add_project(sample_project)

        # Docker mock that reports 'running' then 'exited'
        status_sequence = iter(["running", "running", "exited"])
        dm = MagicMock()
        dm.create_container.return_value = "container-exit-test"
        dm.stream_logs.return_value = MagicMock(spec=threading.Thread)
        dm.get_container_status.side_effect = lambda cid: next(status_sequence)

        runner = LoopRunner(dm, project_store, credential_manager)
        runner.start_loop(sample_project.id, LoopMode.SINGLE)

        # Wait for the monitor thread to detect exit
        # The monitor polls every 2 seconds, so we wait up to 8 seconds
        deadline = time.time() + 8
        while time.time() < deadline:
            state = runner.get_loop_state(sample_project.id)
            if state.status == LoopStatus.COMPLETED:
                break
            time.sleep(0.2)

        state = runner.get_loop_state(sample_project.id)
        assert state.status == LoopStatus.COMPLETED
        assert state.iteration == 1

    def test_dead_container_transitions_to_completed(
        self, project_store, credential_manager, sample_project
    ):
        project_store.add_project(sample_project)

        status_sequence = iter(["running", "dead"])
        dm = MagicMock()
        dm.create_container.return_value = "container-dead-test"
        dm.stream_logs.return_value = MagicMock(spec=threading.Thread)
        dm.get_container_status.side_effect = lambda cid: next(status_sequence)

        runner = LoopRunner(dm, project_store, credential_manager)
        runner.start_loop(sample_project.id, LoopMode.SINGLE)

        deadline = time.time() + 8
        while time.time() < deadline:
            state = runner.get_loop_state(sample_project.id)
            if state.status in (LoopStatus.COMPLETED, LoopStatus.FAILED):
                break
            time.sleep(0.2)

        state = runner.get_loop_state(sample_project.id)
        assert state.status == LoopStatus.COMPLETED

    def test_stop_during_monitoring_transitions_to_stopped(
        self, project_store, credential_manager, sample_project
    ):
        """Stopping a loop while monitor thread is running."""
        project_store.add_project(sample_project)

        dm = MagicMock()
        dm.create_container.return_value = "container-stop-test"
        dm.stream_logs.return_value = MagicMock(spec=threading.Thread)
        dm.get_container_status.return_value = "running"

        runner = LoopRunner(dm, project_store, credential_manager)
        runner.start_loop(sample_project.id, LoopMode.CONTINUOUS)

        # Small delay to let monitor thread start
        time.sleep(0.1)

        runner.stop_loop(sample_project.id)
        state = runner.get_loop_state(sample_project.id)
        assert state.status == LoopStatus.STOPPED


# ---------------------------------------------------------------------------
# 8. Multi-project loops
# ---------------------------------------------------------------------------


class TestMultiProjectLoops:
    """Verify multiple projects can run loops simultaneously."""

    def test_two_projects_run_concurrently(
        self,
        loop_runner,
        project_store,
        sample_project,
        second_project,
        mock_docker,
    ):
        project_store.add_project(sample_project)
        project_store.add_project(second_project)

        # Give each project a unique container ID
        container_ids = iter(["container-1", "container-2"])
        mock_docker.create_container.side_effect = lambda **kw: next(
            container_ids
        )

        state1 = loop_runner.start_loop(sample_project.id, LoopMode.CONTINUOUS)
        state2 = loop_runner.start_loop(
            second_project.id, LoopMode.CONTINUOUS
        )

        assert state1.status == LoopStatus.RUNNING
        assert state2.status == LoopStatus.RUNNING

        all_states = loop_runner.get_all_states()
        assert len(all_states) == 2
        assert sample_project.id in all_states
        assert second_project.id in all_states

    def test_stop_one_doesnt_affect_other(
        self,
        loop_runner,
        project_store,
        sample_project,
        second_project,
        mock_docker,
    ):
        project_store.add_project(sample_project)
        project_store.add_project(second_project)

        container_ids = iter(["container-1", "container-2"])
        mock_docker.create_container.side_effect = lambda **kw: next(
            container_ids
        )

        loop_runner.start_loop(sample_project.id, LoopMode.CONTINUOUS)
        loop_runner.start_loop(second_project.id, LoopMode.CONTINUOUS)

        # Stop first project
        loop_runner.stop_loop(sample_project.id)

        assert (
            loop_runner.get_loop_state(sample_project.id).status
            == LoopStatus.STOPPED
        )
        assert (
            loop_runner.get_loop_state(second_project.id).status
            == LoopStatus.RUNNING
        )

    def test_each_project_gets_own_log_callback(
        self,
        loop_runner,
        project_store,
        sample_project,
        second_project,
        mock_docker,
    ):
        project_store.add_project(sample_project)
        project_store.add_project(second_project)

        container_ids = iter(["container-1", "container-2"])
        mock_docker.create_container.side_effect = lambda **kw: next(
            container_ids
        )

        loop_runner.start_loop(sample_project.id, LoopMode.CONTINUOUS)
        loop_runner.start_loop(second_project.id, LoopMode.CONTINUOUS)

        # Extract both callbacks
        calls = mock_docker.stream_logs.call_args_list
        assert len(calls) == 2

        cb1 = calls[0].kwargs.get("callback") or calls[0][0][1]
        cb2 = calls[1].kwargs.get("callback") or calls[1][0][1]

        # Feed different log lines to each
        cb1("Log from project 1")
        cb2("Log from project 2")

        assert (
            loop_runner.get_loop_state(sample_project.id).last_log
            == "Log from project 1"
        )
        assert (
            loop_runner.get_loop_state(second_project.id).last_log
            == "Log from project 2"
        )


# ---------------------------------------------------------------------------
# 9. Restart after stop
# ---------------------------------------------------------------------------


class TestRestartAfterStop:
    """Verify a project can be restarted after being stopped."""

    def test_restart_after_stop(
        self, loop_runner, project_store, sample_project, mock_docker
    ):
        project_store.add_project(sample_project)

        # First run
        loop_runner.start_loop(sample_project.id, LoopMode.SINGLE)
        loop_runner.stop_loop(sample_project.id)

        assert (
            loop_runner.get_loop_state(sample_project.id).status
            == LoopStatus.STOPPED
        )

        # Second run
        state = loop_runner.start_loop(sample_project.id, LoopMode.SINGLE)
        assert state.status == LoopStatus.RUNNING

    def test_restart_with_different_mode(
        self, loop_runner, project_store, sample_project, mock_docker
    ):
        project_store.add_project(sample_project)

        loop_runner.start_loop(sample_project.id, LoopMode.SINGLE)
        loop_runner.stop_loop(sample_project.id)

        state = loop_runner.start_loop(
            sample_project.id, LoopMode.CONTINUOUS
        )
        assert state.mode == LoopMode.CONTINUOUS
        assert state.status == LoopStatus.RUNNING


# ---------------------------------------------------------------------------
# 10. Project store integration with loop runner
# ---------------------------------------------------------------------------


class TestProjectStoreIntegration:
    """Verify LoopRunner correctly reads project data from ProjectStore."""

    def test_edited_project_reflected_in_next_loop(
        self, loop_runner, project_store, sample_project, mock_docker
    ):
        """After editing a project, the next loop start uses updated data."""
        project_store.add_project(sample_project)
        loop_runner.start_loop(sample_project.id, LoopMode.SINGLE)
        loop_runner.stop_loop(sample_project.id)

        # Edit the project
        sample_project.docker_image = "node:20"
        sample_project.name = "Updated App"
        project_store.update_project(sample_project)

        # Restart — should use updated project data
        loop_runner.start_loop(sample_project.id, LoopMode.SINGLE)

        # The most recent create_container call should use updated image
        last_call = mock_docker.create_container.call_args
        project_arg = last_call.kwargs.get("project") or last_call[0][0]
        assert project_arg.docker_image == "node:20"
        assert project_arg.name == "Updated App"

    def test_deleted_project_cant_start_loop(
        self, loop_runner, project_store, sample_project
    ):
        project_store.add_project(sample_project)
        project_store.remove_project(sample_project.id)

        with pytest.raises(ValueError, match="not found"):
            loop_runner.start_loop(sample_project.id, LoopMode.SINGLE)

    def test_loop_with_minimal_project(
        self, loop_runner, project_store, mock_docker
    ):
        """A project with only required fields can still start a loop."""
        minimal = ProjectConfig(
            name="Minimal",
            repo_url="https://example.com/repo.git",
        )
        project_store.add_project(minimal)

        state = loop_runner.start_loop(minimal.id, LoopMode.SINGLE)
        assert state.status == LoopStatus.RUNNING

        call_args = mock_docker.create_container.call_args
        project_arg = call_args.kwargs.get("project") or call_args[0][0]
        assert project_arg.docker_image == "ubuntu:24.04"  # default
