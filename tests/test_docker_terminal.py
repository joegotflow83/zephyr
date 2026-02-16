"""Tests for DockerManager exec methods used by the terminal feature.

Covers exec_create, exec_start_socket, and exec_resize with mocked
Docker client API calls.
"""

import socket
from unittest.mock import MagicMock, patch, PropertyMock

import pytest
from docker.errors import DockerException, APIError

from src.lib.docker_manager import DockerManager


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_manager_with_client():
    """Return a DockerManager whose _client is a MagicMock."""
    with patch("src.lib.docker_manager.docker.from_env") as mock_from_env:
        mock_client = MagicMock()
        mock_client.ping.return_value = True
        mock_from_env.return_value = mock_client
        manager = DockerManager()
    return manager, mock_client


def _make_manager_no_client():
    """Return a DockerManager with no Docker connection (_client is None)."""
    with patch("src.lib.docker_manager.docker.from_env") as mock_from_env:
        mock_from_env.side_effect = DockerException("not available")
        manager = DockerManager()
    return manager


# ---------------------------------------------------------------------------
# exec_create
# ---------------------------------------------------------------------------


class TestExecCreate:
    def test_returns_exec_id_string(self):
        manager, mock_client = _make_manager_with_client()
        mock_client.api.exec_create.return_value = {"Id": "abc123"}
        result = manager.exec_create("container1", ["/bin/bash"])
        assert result == "abc123"

    def test_returns_plain_string_when_api_returns_string(self):
        manager, mock_client = _make_manager_with_client()
        mock_client.api.exec_create.return_value = "execid456"
        result = manager.exec_create("container1", ["/bin/bash"])
        assert result == "execid456"

    def test_default_user_is_root(self):
        manager, mock_client = _make_manager_with_client()
        mock_client.api.exec_create.return_value = {"Id": "id1"}
        manager.exec_create("container1", ["/bin/bash"])
        mock_client.api.exec_create.assert_called_once_with(
            "container1", ["/bin/bash"], tty=True, stdin=True, user="root"
        )

    def test_custom_user_is_passed(self):
        manager, mock_client = _make_manager_with_client()
        mock_client.api.exec_create.return_value = {"Id": "id2"}
        manager.exec_create("container1", ["/bin/sh"], user="ralph")
        mock_client.api.exec_create.assert_called_once_with(
            "container1", ["/bin/sh"], tty=True, stdin=True, user="ralph"
        )

    def test_tty_and_stdin_always_enabled(self):
        manager, mock_client = _make_manager_with_client()
        mock_client.api.exec_create.return_value = {"Id": "id3"}
        manager.exec_create("container1", ["/bin/bash"])
        call_kwargs = mock_client.api.exec_create.call_args[1]
        assert call_kwargs["tty"] is True
        assert call_kwargs["stdin"] is True

    def test_raises_when_client_unavailable(self):
        manager = _make_manager_no_client()
        with pytest.raises(DockerException, match="not available"):
            manager.exec_create("container1", ["/bin/bash"])

    def test_raises_on_api_error(self):
        manager, mock_client = _make_manager_with_client()
        mock_client.api.exec_create.side_effect = APIError("exec failed")
        with pytest.raises(APIError):
            manager.exec_create("container1", ["/bin/bash"])

    def test_raises_on_docker_exception(self):
        manager, mock_client = _make_manager_with_client()
        mock_client.api.exec_create.side_effect = DockerException("error")
        with pytest.raises(DockerException):
            manager.exec_create("container1", ["/bin/bash"])


# ---------------------------------------------------------------------------
# exec_start_socket
# ---------------------------------------------------------------------------


class TestExecStartSocket:
    def _make_raw_socket(self):
        """Return a mock that looks like a raw socket."""
        raw = MagicMock(spec=socket.socket)
        return raw

    def test_returns_socket_object(self):
        manager, mock_client = _make_manager_with_client()
        raw_sock = self._make_raw_socket()
        mock_client.api.exec_start.return_value = raw_sock
        result = manager.exec_start_socket("exec123")
        assert result is raw_sock

    def test_calls_exec_start_with_tty_and_socket(self):
        manager, mock_client = _make_manager_with_client()
        raw_sock = self._make_raw_socket()
        mock_client.api.exec_start.return_value = raw_sock
        manager.exec_start_socket("exec123")
        mock_client.api.exec_start.assert_called_once_with(
            "exec123", tty=True, socket=True
        )

    def test_sets_nonblocking_mode(self):
        manager, mock_client = _make_manager_with_client()
        raw_sock = self._make_raw_socket()
        mock_client.api.exec_start.return_value = raw_sock
        manager.exec_start_socket("exec123")
        raw_sock.setblocking.assert_called_with(False)

    def test_unwraps_raw_attribute(self):
        """If the wrapper has a .raw attribute, it should be unwrapped."""
        manager, mock_client = _make_manager_with_client()
        inner_sock = self._make_raw_socket()
        # Make the inner socket have no further .raw attribute
        inner_sock.raw = None
        wrapper = MagicMock()
        wrapper.raw = inner_sock
        mock_client.api.exec_start.return_value = wrapper
        result = manager.exec_start_socket("exec123")
        # The inner socket should have setblocking called
        inner_sock.setblocking.assert_called_with(False)

    def test_raises_when_client_unavailable(self):
        manager = _make_manager_no_client()
        with pytest.raises(DockerException, match="not available"):
            manager.exec_start_socket("exec123")

    def test_raises_on_api_error(self):
        manager, mock_client = _make_manager_with_client()
        mock_client.api.exec_start.side_effect = APIError("start failed")
        with pytest.raises(APIError):
            manager.exec_start_socket("exec123")


# ---------------------------------------------------------------------------
# exec_resize
# ---------------------------------------------------------------------------


class TestExecResize:
    def test_calls_api_with_correct_args(self):
        manager, mock_client = _make_manager_with_client()
        manager.exec_resize("exec123", rows=24, cols=80)
        mock_client.api.exec_resize.assert_called_once_with(
            "exec123", height=24, width=80
        )

    def test_does_not_raise_on_api_error(self):
        """exec_resize should silently swallow API errors (warn only)."""
        manager, mock_client = _make_manager_with_client()
        mock_client.api.exec_resize.side_effect = APIError("resize failed")
        # Should NOT raise
        manager.exec_resize("exec123", rows=24, cols=80)

    def test_does_not_raise_on_docker_exception(self):
        manager, mock_client = _make_manager_with_client()
        mock_client.api.exec_resize.side_effect = DockerException("error")
        # Should NOT raise
        manager.exec_resize("exec123", rows=40, cols=120)

    def test_raises_when_client_unavailable(self):
        """exec_resize DOES raise if Docker is unavailable (no client)."""
        manager = _make_manager_no_client()
        with pytest.raises(DockerException, match="not available"):
            manager.exec_resize("exec123", rows=24, cols=80)

    def test_accepts_various_dimensions(self):
        manager, mock_client = _make_manager_with_client()
        manager.exec_resize("exec999", rows=50, cols=200)
        mock_client.api.exec_resize.assert_called_once_with(
            "exec999", height=50, width=200
        )
