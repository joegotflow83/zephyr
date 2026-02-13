"""Tests for DockerManager (part 1: connection and status).

All tests mock the ``docker`` module so no real Docker daemon is needed.
"""

from unittest.mock import MagicMock, patch, call

import pytest
from docker.errors import DockerException, ImageNotFound, APIError

from src.lib.docker_manager import DockerManager


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_client():
    """Return a pre-configured mock DockerClient."""
    client = MagicMock()
    client.ping.return_value = True
    client.info.return_value = {
        "ServerVersion": "24.0.0",
        "OperatingSystem": "Ubuntu 24.04",
        "NCPU": 4,
        "MemTotal": 8_000_000_000,
    }
    client.images.get.return_value = MagicMock(tags=["ubuntu:24.04"])
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
# Constructor tests
# ---------------------------------------------------------------------------


class TestDockerManagerInit:
    def test_connects_when_daemon_available(self, mock_client):
        with patch("src.lib.docker_manager.docker.from_env", return_value=mock_client):
            mgr = DockerManager()
        assert mgr._client is mock_client
        mock_client.ping.assert_called_once()

    def test_sets_client_none_when_daemon_unavailable(self):
        with patch(
            "src.lib.docker_manager.docker.from_env",
            side_effect=DockerException("not found"),
        ):
            mgr = DockerManager()
        assert mgr._client is None

    def test_sets_client_none_when_ping_fails(self, mock_client):
        mock_client.ping.side_effect = DockerException("ping failed")
        with patch("src.lib.docker_manager.docker.from_env", return_value=mock_client):
            mgr = DockerManager()
        assert mgr._client is None


# ---------------------------------------------------------------------------
# is_docker_available
# ---------------------------------------------------------------------------


class TestIsDockerAvailable:
    def test_returns_true_when_daemon_reachable(self, manager, mock_client):
        assert manager.is_docker_available() is True
        # ping is called once more (beyond the constructor call)
        assert mock_client.ping.call_count >= 2

    def test_returns_false_when_client_is_none(self, unavailable_manager):
        assert unavailable_manager.is_docker_available() is False

    def test_returns_false_when_ping_raises(self, manager, mock_client):
        mock_client.ping.side_effect = DockerException("gone")
        assert manager.is_docker_available() is False


# ---------------------------------------------------------------------------
# get_docker_info
# ---------------------------------------------------------------------------


class TestGetDockerInfo:
    def test_returns_info_dict(self, manager, mock_client):
        info = manager.get_docker_info()
        assert info is not None
        assert info["ServerVersion"] == "24.0.0"
        mock_client.info.assert_called_once()

    def test_returns_none_when_unavailable(self, unavailable_manager):
        assert unavailable_manager.get_docker_info() is None

    def test_returns_none_when_info_raises(self, manager, mock_client):
        mock_client.info.side_effect = DockerException("error")
        assert manager.get_docker_info() is None


# ---------------------------------------------------------------------------
# is_image_available
# ---------------------------------------------------------------------------


class TestIsImageAvailable:
    def test_returns_true_when_image_exists(self, manager, mock_client):
        assert manager.is_image_available("ubuntu:24.04") is True
        mock_client.images.get.assert_called_once_with("ubuntu:24.04")

    def test_returns_false_when_image_not_found(self, manager, mock_client):
        mock_client.images.get.side_effect = ImageNotFound("nope")
        assert manager.is_image_available("nonexistent:latest") is False

    def test_returns_false_when_client_unavailable(self, unavailable_manager):
        assert unavailable_manager.is_image_available("ubuntu:24.04") is False

    def test_returns_false_on_generic_docker_error(self, manager, mock_client):
        mock_client.images.get.side_effect = DockerException("oops")
        assert manager.is_image_available("ubuntu:24.04") is False


# ---------------------------------------------------------------------------
# pull_image
# ---------------------------------------------------------------------------


class TestPullImage:
    def test_pull_calls_api_correctly(self, manager, mock_client):
        mock_client.api.pull.return_value = iter(
            [
                {"status": "Pulling layer", "id": "abc123"},
                {"status": "Download complete", "id": "abc123"},
            ]
        )
        manager.pull_image("ubuntu:24.04")
        mock_client.api.pull.assert_called_once_with(
            "ubuntu:24.04", stream=True, decode=True
        )

    def test_pull_invokes_progress_callback(self, manager, mock_client):
        chunks = [
            {"status": "Pulling layer", "id": "abc123"},
            {"status": "Download complete", "id": "abc123"},
        ]
        mock_client.api.pull.return_value = iter(chunks)

        callback = MagicMock()
        manager.pull_image("ubuntu:24.04", progress_callback=callback)

        assert callback.call_count == 2
        callback.assert_any_call({"status": "Pulling layer", "id": "abc123"})
        callback.assert_any_call({"status": "Download complete", "id": "abc123"})

    def test_pull_without_callback_succeeds(self, manager, mock_client):
        mock_client.api.pull.return_value = iter(
            [{"status": "Done"}]
        )
        # Should not raise
        manager.pull_image("ubuntu:24.04", progress_callback=None)

    def test_pull_raises_when_unavailable(self, unavailable_manager):
        with pytest.raises(DockerException, match="not available"):
            unavailable_manager.pull_image("ubuntu:24.04")

    def test_pull_raises_on_api_error(self, manager, mock_client):
        mock_client.api.pull.side_effect = APIError("pull failed")
        with pytest.raises(APIError):
            manager.pull_image("ubuntu:24.04")

    def test_pull_raises_on_docker_exception(self, manager, mock_client):
        mock_client.api.pull.side_effect = DockerException("network error")
        with pytest.raises(DockerException):
            manager.pull_image("ubuntu:24.04")

    def test_pull_with_empty_stream(self, manager, mock_client):
        mock_client.api.pull.return_value = iter([])
        callback = MagicMock()
        manager.pull_image("ubuntu:24.04", progress_callback=callback)
        callback.assert_not_called()
