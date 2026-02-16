"""Tests for TerminalBridge — WebSocket-to-Docker-exec bridge.

The bridge runs asyncio on a daemon thread and emits Qt signals back to the
main thread via QueuedConnection.  All tests use mocked DockerManager and
synthetic asyncio helpers so no real Docker daemon is required.
"""

import asyncio
import socket
import threading
import time
import types
import unittest
from unittest.mock import AsyncMock, MagicMock, patch, PropertyMock

import pytest

from PyQt6.QtCore import QCoreApplication, QObject, pyqtSignal, Qt


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _process_events(ms: int = 100) -> None:
    """Pump the Qt event loop for *ms* milliseconds to flush queued signals."""
    app = QCoreApplication.instance()
    if app is None:
        return
    deadline = time.monotonic() + ms / 1000.0
    while time.monotonic() < deadline:
        app.processEvents()
        time.sleep(0.01)


def _make_docker_manager() -> MagicMock:
    """Return a MagicMock that behaves like DockerManager for exec methods."""
    dm = MagicMock()
    # exec_create returns a fake exec_id string
    dm.exec_create.return_value = "fake-exec-id-123"
    # exec_start_socket returns a loopback pair so real socket ops work
    dm.exec_start_socket.return_value = MagicMock(spec=socket.socket)
    dm.exec_resize.return_value = None
    return dm


# ---------------------------------------------------------------------------
# Unit tests — no Qt signals needed
# ---------------------------------------------------------------------------

class TestFindFreePort:
    def test_returns_integer(self, qapp) -> None:
        from src.lib.terminal_bridge import TerminalBridge
        dm = _make_docker_manager()
        bridge = TerminalBridge(dm)
        port = bridge._find_free_port()
        assert isinstance(port, int)

    def test_port_in_valid_range(self, qapp) -> None:
        from src.lib.terminal_bridge import TerminalBridge
        dm = _make_docker_manager()
        bridge = TerminalBridge(dm)
        port = bridge._find_free_port()
        assert 1024 <= port <= 65535

    def test_port_is_available(self, qapp) -> None:
        """The port returned should be bindable (briefly free at call time)."""
        from src.lib.terminal_bridge import TerminalBridge
        dm = _make_docker_manager()
        bridge = TerminalBridge(dm)
        port = bridge._find_free_port()
        # We should be able to bind to it immediately after
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            s.bind(("127.0.0.1", port))  # should not raise


class TestGetSessionContainerName:
    def test_returns_empty_for_unknown_session(self, qapp) -> None:
        from src.lib.terminal_bridge import TerminalBridge
        dm = _make_docker_manager()
        bridge = TerminalBridge(dm)
        assert bridge.get_session_container_name("nonexistent") == ""

    def test_returns_name_for_known_session(self, qapp) -> None:
        from src.lib.terminal_bridge import TerminalBridge
        dm = _make_docker_manager()
        bridge = TerminalBridge(dm)
        # Manually inject a session entry
        bridge._sessions["sess-1"] = {"container_name": "my-project", "tasks": []}
        assert bridge.get_session_container_name("sess-1") == "my-project"


class TestStartStop:
    def test_start_creates_thread(self, qapp) -> None:
        from src.lib.terminal_bridge import TerminalBridge
        dm = _make_docker_manager()
        bridge = TerminalBridge(dm)
        bridge.start()
        assert bridge._thread is not None
        assert bridge._thread.is_alive()
        bridge.stop()

    def test_stop_clears_thread(self, qapp) -> None:
        from src.lib.terminal_bridge import TerminalBridge
        dm = _make_docker_manager()
        bridge = TerminalBridge(dm)
        bridge.start()
        bridge.stop()
        assert bridge._thread is None
        assert bridge._loop is None

    def test_double_start_is_idempotent(self, qapp) -> None:
        from src.lib.terminal_bridge import TerminalBridge
        dm = _make_docker_manager()
        bridge = TerminalBridge(dm)
        bridge.start()
        t1 = bridge._thread
        bridge.start()  # second start should be a no-op
        assert bridge._thread is t1
        bridge.stop()

    def test_stop_without_start_is_safe(self, qapp) -> None:
        from src.lib.terminal_bridge import TerminalBridge
        dm = _make_docker_manager()
        bridge = TerminalBridge(dm)
        bridge.stop()  # should not raise

    def test_start_creates_asyncio_loop(self, qapp) -> None:
        from src.lib.terminal_bridge import TerminalBridge
        dm = _make_docker_manager()
        bridge = TerminalBridge(dm)
        bridge.start()
        assert bridge._loop is not None
        assert isinstance(bridge._loop, asyncio.AbstractEventLoop)
        bridge.stop()


class TestOpenSessionWithoutStart:
    def test_open_session_without_start_logs_warning(self, qapp, caplog) -> None:
        """open_session before start() should warn but not raise."""
        import logging
        from src.lib.terminal_bridge import TerminalBridge
        dm = _make_docker_manager()
        bridge = TerminalBridge(dm)
        with caplog.at_level(logging.WARNING, logger="zephyr.terminal_bridge"):
            bridge.open_session("container-123", "my-project")
        assert "not started" in caplog.text.lower() or caplog.records  # warning was emitted

    def test_close_session_without_start_is_safe(self, qapp) -> None:
        from src.lib.terminal_bridge import TerminalBridge
        dm = _make_docker_manager()
        bridge = TerminalBridge(dm)
        bridge.close_session("nonexistent-session")  # should not raise


def _make_mock_websockets():
    """Return a mock websockets module with an async serve coroutine."""
    mock_ws = MagicMock()
    mock_ws.serve = AsyncMock(return_value=MagicMock())
    return mock_ws


class TestOpenSessionCallsDockerManager:
    def test_open_session_calls_exec_create_with_root_user(self, qapp) -> None:
        """open_session must call exec_create with user='root'."""
        import sys
        from src.lib.terminal_bridge import TerminalBridge

        dm = _make_docker_manager()

        mock_ws = _make_mock_websockets()
        # Patch the module-level 'websockets' name and HAS_WEBSOCKETS flag
        with patch.dict(sys.modules, {"websockets": mock_ws, "websockets.server": MagicMock()}):
            with patch("src.lib.terminal_bridge.websockets", mock_ws):
                with patch("src.lib.terminal_bridge.HAS_WEBSOCKETS", True):
                    bridge = TerminalBridge(dm)
                    bridge.start()
                    bridge.open_session("container-abc", "project-x")
                    time.sleep(0.3)  # Let the asyncio task run
                    bridge.stop()

        dm.exec_create.assert_called_once_with(
            "container-abc", ["/bin/bash"], user="root"
        )

    def test_open_session_calls_exec_start_socket(self, qapp) -> None:
        """open_session must call exec_start_socket after exec_create."""
        import sys
        from src.lib.terminal_bridge import TerminalBridge

        dm = _make_docker_manager()

        mock_ws = _make_mock_websockets()
        with patch.dict(sys.modules, {"websockets": mock_ws, "websockets.server": MagicMock()}):
            with patch("src.lib.terminal_bridge.websockets", mock_ws):
                with patch("src.lib.terminal_bridge.HAS_WEBSOCKETS", True):
                    bridge = TerminalBridge(dm)
                    bridge.start()
                    bridge.open_session("container-abc", "project-x")
                    time.sleep(0.3)
                    bridge.stop()

        dm.exec_start_socket.assert_called_once_with("fake-exec-id-123")


class TestOpenSessionErrorHandling:
    def test_exec_create_failure_does_not_crash(self, qapp) -> None:
        """If exec_create raises, the bridge should not crash."""
        from src.lib.terminal_bridge import TerminalBridge

        dm = _make_docker_manager()
        dm.exec_create.side_effect = RuntimeError("Docker exec failed")

        bridge = TerminalBridge(dm)
        bridge.start()
        bridge.open_session("container-err", "project-err")
        time.sleep(0.3)
        bridge.stop()
        # If we get here without crashing, the test passes

    def test_exec_start_socket_failure_does_not_crash(self, qapp) -> None:
        """If exec_start_socket raises, the bridge should not crash."""
        from src.lib.terminal_bridge import TerminalBridge

        dm = _make_docker_manager()
        dm.exec_start_socket.side_effect = RuntimeError("Socket error")

        bridge = TerminalBridge(dm)
        bridge.start()
        bridge.open_session("container-err", "project-err")
        time.sleep(0.3)
        bridge.stop()


class TestCloseSession:
    def test_close_nonexistent_session_is_safe(self, qapp) -> None:
        """close_session for unknown session_id should not raise."""
        from src.lib.terminal_bridge import TerminalBridge

        dm = _make_docker_manager()

        bridge = TerminalBridge(dm)
        bridge.start()
        bridge.close_session("bogus-session-id")
        time.sleep(0.1)
        bridge.stop()

    def test_close_session_removes_from_sessions_dict(self, qapp) -> None:
        """After close_session, the session must no longer be in _sessions."""
        from src.lib.terminal_bridge import TerminalBridge

        dm = _make_docker_manager()

        bridge = TerminalBridge(dm)
        bridge.start()

        # Inject a fake session directly
        mock_sock = MagicMock(spec=socket.socket)
        bridge._sessions["fake-sess"] = {
            "container_name": "proj",
            "exec_id": "eid",
            "sock": mock_sock,
            "tasks": [],
            "server": None,
        }

        bridge.close_session("fake-sess")
        time.sleep(0.2)
        assert "fake-sess" not in bridge._sessions
        bridge.stop()


class TestReadSocket:
    def test_read_socket_returns_bytes(self, qapp) -> None:
        from src.lib.terminal_bridge import TerminalBridge

        dm = _make_docker_manager()
        bridge = TerminalBridge(dm)

        mock_sock = MagicMock(spec=socket.socket)
        mock_sock.recv.return_value = b"hello"
        result = bridge._read_socket(mock_sock)
        assert result == b"hello"

    def test_read_socket_returns_empty_on_error(self, qapp) -> None:
        from src.lib.terminal_bridge import TerminalBridge

        dm = _make_docker_manager()
        bridge = TerminalBridge(dm)

        mock_sock = MagicMock(spec=socket.socket)
        mock_sock.recv.side_effect = OSError("connection reset")
        result = bridge._read_socket(mock_sock)
        assert result == b""

    def test_read_socket_returns_empty_on_eof(self, qapp) -> None:
        from src.lib.terminal_bridge import TerminalBridge

        dm = _make_docker_manager()
        bridge = TerminalBridge(dm)

        mock_sock = MagicMock(spec=socket.socket)
        mock_sock.recv.return_value = b""
        result = bridge._read_socket(mock_sock)
        assert result == b""


class TestBridgeEmitterSignals:
    def test_session_ready_signal_forwarded(self, qapp) -> None:
        """session_ready on _emitter must arrive at TerminalBridge.session_ready."""
        from src.lib.terminal_bridge import TerminalBridge

        dm = _make_docker_manager()
        bridge = TerminalBridge(dm)

        received = []

        def on_ready(sid, port, user):
            received.append((sid, port, user))

        bridge.session_ready.connect(on_ready)
        # Directly emit the internal signal (simulating asyncio thread behavior)
        bridge._emitter._session_ready.emit("sess-x", 9999, "root")
        _process_events(200)
        assert received == [("sess-x", 9999, "root")]

    def test_session_ended_signal_forwarded(self, qapp) -> None:
        """session_ended on _emitter must arrive at TerminalBridge.session_ended."""
        from src.lib.terminal_bridge import TerminalBridge

        dm = _make_docker_manager()
        bridge = TerminalBridge(dm)

        ended = []
        bridge.session_ended.connect(ended.append)
        bridge._emitter._session_ended.emit("sess-y")
        _process_events(200)
        assert ended == ["sess-y"]


class TestGetExecId:
    def test_get_exec_id_returns_empty_for_unknown(self, qapp) -> None:
        from src.lib.terminal_bridge import TerminalBridge

        dm = _make_docker_manager()
        bridge = TerminalBridge(dm)
        assert bridge._get_exec_id("nope") == ""

    def test_get_exec_id_returns_correct_value(self, qapp) -> None:
        from src.lib.terminal_bridge import TerminalBridge

        dm = _make_docker_manager()
        bridge = TerminalBridge(dm)
        bridge._sessions["s1"] = {"exec_id": "eid-abc", "tasks": []}
        assert bridge._get_exec_id("s1") == "eid-abc"
