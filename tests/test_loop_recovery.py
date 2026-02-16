"""Tests for Loop Recovery on Startup.

Covers:
- LoopRunner.recover_loops() unit tests (happy paths, edge cases)
- _recover_loops() helper in main.py integration tests
"""

import threading
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

from src.lib.cleanup import CleanupManager
from src.lib.loop_runner import LoopMode, LoopRunner, LoopState, LoopStatus
from src.lib.models import ProjectConfig
from src.main import _recover_loops


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_docker_manager():
    dm = MagicMock()
    dm.is_docker_available.return_value = True
    dm.get_container_created.return_value = "2024-01-15T10:30:00Z"
    dm.stream_logs.return_value = None
    dm.get_container_status.return_value = "running"
    return dm


@pytest.fixture
def mock_project_store():
    store = MagicMock()
    store.get_project.return_value = ProjectConfig(
        id="proj-001", name="Test", repo_url="/tmp/repo", docker_image="ubuntu:24.04"
    )
    return store


@pytest.fixture
def mock_credential_manager():
    return MagicMock()


@pytest.fixture
def loop_runner(mock_docker_manager, mock_project_store, mock_credential_manager):
    return LoopRunner(mock_docker_manager, mock_project_store, mock_credential_manager)


@pytest.fixture
def sample_containers():
    return [
        {
            "id": "container-aaa111",
            "name": "zephyr-proj-001",
            "status": "running",
            "project_id": "proj-001",
        }
    ]


# ---------------------------------------------------------------------------
# Unit tests for LoopRunner.recover_loops()
# ---------------------------------------------------------------------------


def test_recover_single_container(loop_runner, sample_containers, mock_docker_manager):
    """Happy path: one container, project exists — LoopState created correctly."""
    result = loop_runner.recover_loops(sample_containers)

    assert result == ["proj-001"]
    states = loop_runner.get_all_states()
    assert "proj-001" in states

    state = states["proj-001"]
    assert state.status == LoopStatus.RUNNING
    assert state.mode == LoopMode.CONTINUOUS
    assert state.iteration == 0
    assert state.container_id == "container-aaa111"
    assert state.started_at == "2024-01-15T10:30:00Z"


def test_recover_multiple_containers(mock_docker_manager, mock_credential_manager):
    """Two containers for different projects, both get recovered."""
    store = MagicMock()
    store.get_project.side_effect = lambda pid: ProjectConfig(
        id=pid, name=f"Project {pid}", repo_url="/tmp/repo", docker_image="ubuntu:24.04"
    )
    runner = LoopRunner(mock_docker_manager, store, mock_credential_manager)

    containers = [
        {"id": "cid-aaa", "name": "zephyr-aaa", "status": "running", "project_id": "proj-aaa"},
        {"id": "cid-bbb", "name": "zephyr-bbb", "status": "running", "project_id": "proj-bbb"},
    ]
    result = runner.recover_loops(containers)

    assert sorted(result) == ["proj-aaa", "proj-bbb"]
    states = runner.get_all_states()
    assert "proj-aaa" in states
    assert "proj-bbb" in states


def test_skip_deleted_project(loop_runner, mock_project_store):
    """Container whose project was deleted is skipped; others still recover."""
    mock_project_store.get_project.side_effect = lambda pid: (
        None if pid == "proj-deleted"
        else ProjectConfig(
            id=pid, name="Test", repo_url="/tmp/repo", docker_image="ubuntu:24.04"
        )
    )

    containers = [
        {"id": "cid-del", "name": "zephyr-del", "status": "running", "project_id": "proj-deleted"},
        {"id": "cid-ok", "name": "zephyr-ok", "status": "running", "project_id": "proj-001"},
    ]
    result = loop_runner.recover_loops(containers)

    assert "proj-deleted" not in result
    assert "proj-001" in result
    states = loop_runner.get_all_states()
    assert "proj-deleted" not in states
    assert "proj-001" in states


def test_skip_already_tracked_project(loop_runner, sample_containers):
    """Pre-populated state for a project_id is not overwritten."""
    original_state = LoopState(
        project_id="proj-001",
        container_id="old-container",
        mode=LoopMode.SINGLE,
        status=LoopStatus.RUNNING,
        iteration=5,
        started_at="2024-01-01T00:00:00Z",
    )
    loop_runner._states["proj-001"] = original_state

    result = loop_runner.recover_loops(sample_containers)

    assert "proj-001" not in result
    # Original state unchanged
    assert loop_runner._states["proj-001"] is original_state
    assert loop_runner._states["proj-001"].iteration == 5


def test_concurrency_limit_respected(mock_docker_manager, mock_project_store, mock_credential_manager, sample_containers):
    """Containers are skipped when the concurrency limit is reached."""
    runner = LoopRunner(mock_docker_manager, mock_project_store, mock_credential_manager, max_concurrent=1)
    # Pre-acquire the semaphore to simulate the limit being reached
    runner._semaphore.acquire()

    result = runner.recover_loops(sample_containers)

    assert result == []
    assert "proj-001" not in runner.get_all_states()

    # Cleanup: release the semaphore
    runner._semaphore.release()


def test_log_streaming_resumed(loop_runner, sample_containers, mock_docker_manager):
    """stream_logs() is called with the correct container_id and a callback."""
    loop_runner.recover_loops(sample_containers)

    mock_docker_manager.stream_logs.assert_called_once()
    call_kwargs = mock_docker_manager.stream_logs.call_args
    assert call_kwargs.kwargs.get("container_id") == "container-aaa111" or \
        call_kwargs.args[0] == "container-aaa111" or \
        call_kwargs.kwargs.get("container_id") == "container-aaa111"
    # Verify keyword arg pattern used by _stream_logs_for_container
    assert "container_id" in call_kwargs.kwargs or len(call_kwargs.args) >= 1


def test_monitor_thread_started(loop_runner, sample_containers):
    """A thread named zephyr-loop-{project_id[:12]} is stored in _threads."""
    loop_runner.recover_loops(sample_containers)

    assert "proj-001" in loop_runner._threads
    thread = loop_runner._threads["proj-001"]
    assert isinstance(thread, threading.Thread)
    assert thread.name == "zephyr-loop-proj-001"


def test_stream_logs_failure_nonfatal(loop_runner, sample_containers, mock_docker_manager):
    """stream_logs() failure is non-fatal: state and return list still correct."""
    mock_docker_manager.stream_logs.side_effect = RuntimeError("stream error")

    result = loop_runner.recover_loops(sample_containers)

    # Despite the stream failure, recovery still succeeds
    assert "proj-001" in result
    assert "proj-001" in loop_runner.get_all_states()
    assert loop_runner.get_all_states()["proj-001"].status == LoopStatus.RUNNING


def test_default_values(loop_runner, sample_containers):
    """Recovered LoopState has mode=CONTINUOUS, status=RUNNING, iteration=0."""
    loop_runner.recover_loops(sample_containers)

    state = loop_runner.get_all_states()["proj-001"]
    assert state.mode == LoopMode.CONTINUOUS
    assert state.status == LoopStatus.RUNNING
    assert state.iteration == 0


def test_started_at_from_container_created(loop_runner, sample_containers, mock_docker_manager):
    """started_at uses get_container_created() value when available."""
    mock_docker_manager.get_container_created.return_value = "2024-06-01T12:00:00Z"

    loop_runner.recover_loops(sample_containers)

    state = loop_runner.get_all_states()["proj-001"]
    assert state.started_at == "2024-06-01T12:00:00Z"


def test_started_at_fallback_when_created_returns_none(loop_runner, sample_containers, mock_docker_manager):
    """When get_container_created() returns None, started_at is a current UTC timestamp."""
    mock_docker_manager.get_container_created.return_value = None
    before = datetime.now(timezone.utc).isoformat()

    loop_runner.recover_loops(sample_containers)

    after = datetime.now(timezone.utc).isoformat()
    state = loop_runner.get_all_states()["proj-001"]
    assert state.started_at is not None
    assert before <= state.started_at <= after


def test_skip_container_missing_project_id(loop_runner):
    """Containers missing project_id or id keys are skipped gracefully."""
    containers = [
        {"id": "cid-001", "name": "x", "status": "running"},  # no project_id
        {"project_id": "proj-001", "name": "x", "status": "running"},  # no id
    ]
    result = loop_runner.recover_loops(containers)

    assert result == []
    assert loop_runner.get_all_states() == {}


# ---------------------------------------------------------------------------
# Integration tests for _recover_loops() in main.py
# ---------------------------------------------------------------------------


def test_recover_loops_full_flow():
    """Full flow: mocked Docker returns containers, LoopRunner recovers them."""
    docker_manager = MagicMock()
    docker_manager.is_docker_available.return_value = True
    docker_manager.get_container_created.return_value = "2024-01-15T10:30:00Z"
    docker_manager.stream_logs.return_value = None
    docker_manager.get_container_status.return_value = "running"
    docker_manager.list_running_containers.return_value = [
        {
            "id": "container-aaa111",
            "name": "zephyr-proj-001",
            "status": "running",
            "project_id": "proj-001",
        }
    ]

    project_store = MagicMock()
    project_store.get_project.return_value = ProjectConfig(
        id="proj-001", name="Test", repo_url="/tmp/repo", docker_image="ubuntu:24.04"
    )

    credential_manager = MagicMock()
    runner = LoopRunner(docker_manager, project_store, credential_manager)
    cleanup_mgr = CleanupManager()

    _recover_loops(docker_manager, runner, project_store, cleanup_mgr)

    states = runner.get_all_states()
    assert "proj-001" in states
    assert states["proj-001"].status == LoopStatus.RUNNING
    assert "container-aaa111" in cleanup_mgr.tracked_containers


def test_recover_loops_docker_unavailable():
    """When Docker is unavailable, _recover_loops() returns without error."""
    docker_manager = MagicMock()
    docker_manager.is_docker_available.return_value = False

    project_store = MagicMock()
    credential_manager = MagicMock()
    runner = LoopRunner(docker_manager, project_store, credential_manager)
    cleanup_mgr = CleanupManager()

    _recover_loops(docker_manager, runner, project_store, cleanup_mgr)

    # No states created, no containers registered
    assert runner.get_all_states() == {}
    assert cleanup_mgr.tracked_containers == []
