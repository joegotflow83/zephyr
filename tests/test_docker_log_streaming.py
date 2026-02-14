"""Tests for DockerManager log streaming (part 3).

All tests mock the ``docker`` module so no real Docker daemon is needed.
Validates that stream_logs starts a daemon thread delivering decoded
log lines via callback, and that get_logs returns a string of recent
log output.
"""

import threading
import time
from unittest.mock import MagicMock, patch

import pytest
from docker.errors import DockerException, APIError, NotFound

from src.lib.docker_manager import DockerManager

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_container():
    """Return a mock container object."""
    container = MagicMock()
    container.id = "abc123deadbeef"
    container.name = "zephyr-abc123deadbe"
    container.status = "running"
    container.labels = {
        "zephyr.project_id": "proj-001",
        "zephyr.project_name": "Test Project",
    }
    return container


@pytest.fixture
def mock_client(mock_container):
    """Return a pre-configured mock DockerClient with container support."""
    client = MagicMock()
    client.ping.return_value = True
    client.containers.get.return_value = mock_container
    return client


@pytest.fixture
def manager(mock_client):
    """Return a DockerManager with a mocked, reachable client."""
    with patch("src.lib.docker_manager.docker.from_env", return_value=mock_client):
        mgr = DockerManager()
    assert mgr._client is mock_client
    return mgr


@pytest.fixture
def unavailable_manager():
    """Return a DockerManager whose Docker daemon is unreachable."""
    with patch(
        "src.lib.docker_manager.docker.from_env",
        side_effect=DockerException("connection refused"),
    ):
        mgr = DockerManager()
    assert mgr._client is None
    return mgr


# ---------------------------------------------------------------------------
# stream_logs
# ---------------------------------------------------------------------------


class TestStreamLogs:
    """Tests for DockerManager.stream_logs()."""

    def test_returns_thread(self, manager, mock_container):
        mock_container.logs.return_value = iter([])
        thread = manager.stream_logs("abc123deadbeef", lambda line: None)
        assert isinstance(thread, threading.Thread)
        thread.join(timeout=1)

    def test_thread_is_daemon(self, manager, mock_container):
        mock_container.logs.return_value = iter([])
        thread = manager.stream_logs("abc123deadbeef", lambda line: None)
        assert thread.daemon is True
        thread.join(timeout=1)

    def test_thread_name_contains_container_id(self, manager, mock_container):
        mock_container.logs.return_value = iter([])
        thread = manager.stream_logs("abc123deadbeef", lambda line: None)
        assert "abc123deadbe" in thread.name
        thread.join(timeout=1)

    def test_callback_receives_decoded_lines(self, manager, mock_container):
        log_lines = [b"Hello world\n", b"Second line\n", b"Third line\n"]
        mock_container.logs.return_value = iter(log_lines)

        received = []
        thread = manager.stream_logs("abc123deadbeef", received.append)
        thread.join(timeout=2)

        assert received == ["Hello world", "Second line", "Third line"]

    def test_callback_handles_utf8(self, manager, mock_container):
        log_lines = [b"\xc3\xa9l\xc3\xa8ve\n", b"caf\xc3\xa9\n"]
        mock_container.logs.return_value = iter(log_lines)

        received = []
        thread = manager.stream_logs("abc123deadbeef", received.append)
        thread.join(timeout=2)

        assert received == ["élève", "café"]

    def test_callback_handles_invalid_utf8(self, manager, mock_container):
        log_lines = [b"valid\n", b"\xff\xfe bad bytes\n"]
        mock_container.logs.return_value = iter(log_lines)

        received = []
        thread = manager.stream_logs("abc123deadbeef", received.append)
        thread.join(timeout=2)

        assert len(received) == 2
        assert received[0] == "valid"
        # The invalid bytes should be replaced, not cause an exception
        assert "bad bytes" in received[1]

    def test_skips_empty_lines(self, manager, mock_container):
        log_lines = [b"line1\n", b"\n", b"line2\n"]
        mock_container.logs.return_value = iter(log_lines)

        received = []
        thread = manager.stream_logs("abc123deadbeef", received.append)
        thread.join(timeout=2)

        assert received == ["line1", "line2"]

    def test_passes_follow_true_by_default(self, manager, mock_container):
        mock_container.logs.return_value = iter([])
        thread = manager.stream_logs("abc123deadbeef", lambda line: None)
        thread.join(timeout=1)

        mock_container.logs.assert_called_once_with(
            stream=True, follow=True, timestamps=False
        )

    def test_passes_follow_false_when_requested(self, manager, mock_container):
        mock_container.logs.return_value = iter([])
        thread = manager.stream_logs("abc123deadbeef", lambda line: None, follow=False)
        thread.join(timeout=1)

        mock_container.logs.assert_called_once_with(
            stream=True, follow=False, timestamps=False
        )

    def test_raises_when_unavailable(self, unavailable_manager):
        with pytest.raises(DockerException, match="not available"):
            unavailable_manager.stream_logs("abc123", lambda line: None)

    def test_raises_when_container_not_found(self, manager, mock_client):
        mock_client.containers.get.side_effect = NotFound("not found")
        with pytest.raises(NotFound):
            manager.stream_logs("nonexistent", lambda line: None)

    def test_raises_on_api_error(self, manager, mock_client):
        mock_client.containers.get.side_effect = APIError("api error")
        with pytest.raises(APIError):
            manager.stream_logs("bad-container", lambda line: None)

    def test_thread_handles_streaming_exception_gracefully(
        self, manager, mock_container
    ):
        """If the log generator raises mid-stream, the thread exits
        without propagating the exception to the caller."""

        def exploding_generator():
            yield b"line before error\n"
            raise DockerException("connection lost")

        mock_container.logs.return_value = exploding_generator()

        received = []
        thread = manager.stream_logs("abc123deadbeef", received.append)
        thread.join(timeout=2)

        assert received == ["line before error"]
        assert not thread.is_alive()

    def test_multiple_stream_threads_are_independent(self, manager, mock_client):
        """Starting streams for different containers creates separate
        threads that don't interfere with each other."""
        c1 = MagicMock()
        c1.id = "container1"
        c1.logs.return_value = iter([b"c1-line1\n", b"c1-line2\n"])

        c2 = MagicMock()
        c2.id = "container2"
        c2.logs.return_value = iter([b"c2-line1\n"])

        mock_client.containers.get.side_effect = lambda cid: (
            c1 if cid == "container1" else c2
        )

        received1 = []
        received2 = []
        t1 = manager.stream_logs("container1", received1.append)
        t2 = manager.stream_logs("container2", received2.append)
        t1.join(timeout=2)
        t2.join(timeout=2)

        assert received1 == ["c1-line1", "c1-line2"]
        assert received2 == ["c2-line1"]

    def test_handles_lines_without_trailing_newline(self, manager, mock_container):
        log_lines = [b"no newline"]
        mock_container.logs.return_value = iter(log_lines)

        received = []
        thread = manager.stream_logs("abc123deadbeef", received.append)
        thread.join(timeout=2)

        assert received == ["no newline"]

    def test_handles_multiline_chunks(self, manager, mock_container):
        """Docker sometimes sends multi-line chunks. The current
        implementation treats each chunk as one unit after stripping
        the trailing newline."""
        log_lines = [b"line1\nline2\n"]
        mock_container.logs.return_value = iter(log_lines)

        received = []
        thread = manager.stream_logs("abc123deadbeef", received.append)
        thread.join(timeout=2)

        # Single chunk delivered as one callback call (newline-stripped)
        assert len(received) == 1
        assert "line1" in received[0]


# ---------------------------------------------------------------------------
# get_logs
# ---------------------------------------------------------------------------


class TestGetLogs:
    """Tests for DockerManager.get_logs()."""

    def test_returns_decoded_string(self, manager, mock_container):
        mock_container.logs.return_value = b"line1\nline2\nline3\n"
        result = manager.get_logs("abc123deadbeef")
        assert result == "line1\nline2\nline3\n"

    def test_default_tail_is_100(self, manager, mock_container):
        mock_container.logs.return_value = b""
        manager.get_logs("abc123deadbeef")
        mock_container.logs.assert_called_once_with(tail=100, timestamps=False)

    def test_custom_tail(self, manager, mock_container):
        mock_container.logs.return_value = b""
        manager.get_logs("abc123deadbeef", tail=50)
        mock_container.logs.assert_called_once_with(tail=50, timestamps=False)

    def test_handles_utf8(self, manager, mock_container):
        mock_container.logs.return_value = "café résumé\n".encode("utf-8")
        result = manager.get_logs("abc123deadbeef")
        assert result == "café résumé\n"

    def test_handles_invalid_utf8(self, manager, mock_container):
        mock_container.logs.return_value = b"\xff\xfe invalid bytes\n"
        result = manager.get_logs("abc123deadbeef")
        assert "invalid bytes" in result

    def test_returns_empty_string_for_no_logs(self, manager, mock_container):
        mock_container.logs.return_value = b""
        result = manager.get_logs("abc123deadbeef")
        assert result == ""

    def test_raises_when_unavailable(self, unavailable_manager):
        with pytest.raises(DockerException, match="not available"):
            unavailable_manager.get_logs("abc123")

    def test_raises_when_container_not_found(self, manager, mock_client):
        mock_client.containers.get.side_effect = NotFound("not found")
        with pytest.raises(NotFound):
            manager.get_logs("nonexistent")

    def test_raises_on_api_error(self, manager, mock_client, mock_container):
        mock_container.logs.side_effect = APIError("log read failed")
        with pytest.raises(APIError):
            manager.get_logs("abc123deadbeef")
