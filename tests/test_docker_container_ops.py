"""Tests for DockerManager container lifecycle operations (part 2).

All tests mock the ``docker`` module so no real Docker daemon is needed.
"""

from unittest.mock import MagicMock, patch, PropertyMock

import pytest
from docker.errors import DockerException, APIError, NotFound

from src.lib.docker_manager import DockerManager
from src.lib.models import ProjectConfig


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
    client.containers.create.return_value = mock_container
    client.containers.get.return_value = mock_container
    client.containers.list.return_value = [mock_container]
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


@pytest.fixture
def project():
    """Return a sample ProjectConfig."""
    return ProjectConfig(
        id="proj001abcdef1234567890abcdef1234",
        name="Test Project",
        repo_url="https://github.com/test/repo.git",
        docker_image="ubuntu:24.04",
    )


# ---------------------------------------------------------------------------
# create_container
# ---------------------------------------------------------------------------


class TestCreateContainer:
    def test_creates_with_correct_image(self, manager, mock_client, project):
        manager.create_container(project, "/tmp/repo")
        mock_client.containers.create.assert_called_once()
        call_kwargs = mock_client.containers.create.call_args
        assert call_kwargs.kwargs["image"] == "ubuntu:24.04"

    def test_creates_with_correct_labels(self, manager, mock_client, project):
        manager.create_container(project, "/tmp/repo")
        call_kwargs = mock_client.containers.create.call_args
        labels = call_kwargs.kwargs["labels"]
        assert labels["zephyr.project_id"] == project.id
        assert labels["zephyr.project_name"] == project.name

    def test_creates_with_volume_mount(self, manager, mock_client, project):
        manager.create_container(project, "/tmp/repo")
        call_kwargs = mock_client.containers.create.call_args
        volumes = call_kwargs.kwargs["volumes"]
        assert "/tmp/repo" in volumes
        assert volumes["/tmp/repo"]["bind"] == "/workspace"
        assert volumes["/tmp/repo"]["mode"] == "rw"

    def test_creates_with_env_vars(self, manager, mock_client, project):
        env = {"ANTHROPIC_API_KEY": "sk-test", "OPENAI_API_KEY": "sk-oai"}
        manager.create_container(project, "/tmp/repo", env_vars=env)
        call_kwargs = mock_client.containers.create.call_args
        assert call_kwargs.kwargs["environment"] == env

    def test_creates_with_empty_env_when_none(self, manager, mock_client, project):
        manager.create_container(project, "/tmp/repo")
        call_kwargs = mock_client.containers.create.call_args
        assert call_kwargs.kwargs["environment"] == {}

    def test_creates_with_working_dir(self, manager, mock_client, project):
        manager.create_container(project, "/tmp/repo")
        call_kwargs = mock_client.containers.create.call_args
        assert call_kwargs.kwargs["working_dir"] == "/workspace"

    def test_creates_with_container_name(self, manager, mock_client, project):
        manager.create_container(project, "/tmp/repo")
        call_kwargs = mock_client.containers.create.call_args
        assert call_kwargs.kwargs["name"] == f"zephyr-{project.id[:12]}"

    def test_returns_container_id(self, manager, mock_client, project, mock_container):
        result = manager.create_container(project, "/tmp/repo")
        assert result == mock_container.id

    def test_raises_when_unavailable(self, unavailable_manager, project):
        with pytest.raises(DockerException, match="not available"):
            unavailable_manager.create_container(project, "/tmp/repo")

    def test_raises_on_api_error(self, manager, mock_client, project):
        mock_client.containers.create.side_effect = APIError("create failed")
        with pytest.raises(APIError):
            manager.create_container(project, "/tmp/repo")

    def test_raises_on_docker_exception(self, manager, mock_client, project):
        mock_client.containers.create.side_effect = DockerException("error")
        with pytest.raises(DockerException):
            manager.create_container(project, "/tmp/repo")

    def test_creates_with_tty_and_stdin(self, manager, mock_client, project):
        manager.create_container(project, "/tmp/repo")
        call_kwargs = mock_client.containers.create.call_args
        assert call_kwargs.kwargs["stdin_open"] is True
        assert call_kwargs.kwargs["tty"] is True
        assert call_kwargs.kwargs["detach"] is True


# ---------------------------------------------------------------------------
# start_container
# ---------------------------------------------------------------------------


class TestStartContainer:
    def test_starts_container(self, manager, mock_client, mock_container):
        manager.start_container("abc123deadbeef")
        mock_client.containers.get.assert_called_once_with("abc123deadbeef")
        mock_container.start.assert_called_once()

    def test_raises_when_unavailable(self, unavailable_manager):
        with pytest.raises(DockerException, match="not available"):
            unavailable_manager.start_container("abc123")

    def test_raises_on_api_error(self, manager, mock_client, mock_container):
        mock_container.start.side_effect = APIError("start failed")
        with pytest.raises(APIError):
            manager.start_container("abc123deadbeef")

    def test_raises_when_container_not_found(self, manager, mock_client):
        mock_client.containers.get.side_effect = NotFound("not found")
        with pytest.raises(NotFound):
            manager.start_container("nonexistent")


# ---------------------------------------------------------------------------
# stop_container
# ---------------------------------------------------------------------------


class TestStopContainer:
    def test_stops_container_with_default_timeout(
        self, manager, mock_client, mock_container
    ):
        manager.stop_container("abc123deadbeef")
        mock_client.containers.get.assert_called_once_with("abc123deadbeef")
        mock_container.stop.assert_called_once_with(timeout=10)

    def test_stops_container_with_custom_timeout(
        self, manager, mock_client, mock_container
    ):
        manager.stop_container("abc123deadbeef", timeout=30)
        mock_container.stop.assert_called_once_with(timeout=30)

    def test_raises_when_unavailable(self, unavailable_manager):
        with pytest.raises(DockerException, match="not available"):
            unavailable_manager.stop_container("abc123")

    def test_raises_on_api_error(self, manager, mock_client, mock_container):
        mock_container.stop.side_effect = APIError("stop failed")
        with pytest.raises(APIError):
            manager.stop_container("abc123deadbeef")

    def test_raises_when_container_not_found(self, manager, mock_client):
        mock_client.containers.get.side_effect = NotFound("not found")
        with pytest.raises(NotFound):
            manager.stop_container("nonexistent")


# ---------------------------------------------------------------------------
# remove_container
# ---------------------------------------------------------------------------


class TestRemoveContainer:
    def test_removes_container(self, manager, mock_client, mock_container):
        manager.remove_container("abc123deadbeef")
        mock_client.containers.get.assert_called_once_with("abc123deadbeef")
        mock_container.remove.assert_called_once_with(force=False)

    def test_removes_container_with_force(
        self, manager, mock_client, mock_container
    ):
        manager.remove_container("abc123deadbeef", force=True)
        mock_container.remove.assert_called_once_with(force=True)

    def test_raises_when_unavailable(self, unavailable_manager):
        with pytest.raises(DockerException, match="not available"):
            unavailable_manager.remove_container("abc123")

    def test_raises_on_api_error(self, manager, mock_client, mock_container):
        mock_container.remove.side_effect = APIError("remove failed")
        with pytest.raises(APIError):
            manager.remove_container("abc123deadbeef")

    def test_raises_when_container_not_found(self, manager, mock_client):
        mock_client.containers.get.side_effect = NotFound("not found")
        with pytest.raises(NotFound):
            manager.remove_container("nonexistent")


# ---------------------------------------------------------------------------
# get_container_status
# ---------------------------------------------------------------------------


class TestGetContainerStatus:
    def test_returns_running_status(self, manager, mock_client, mock_container):
        mock_container.status = "running"
        status = manager.get_container_status("abc123deadbeef")
        assert status == "running"
        mock_container.reload.assert_called_once()

    def test_returns_exited_status(self, manager, mock_client, mock_container):
        mock_container.status = "exited"
        status = manager.get_container_status("abc123deadbeef")
        assert status == "exited"

    def test_returns_paused_status(self, manager, mock_client, mock_container):
        mock_container.status = "paused"
        status = manager.get_container_status("abc123deadbeef")
        assert status == "paused"

    def test_returns_created_status(self, manager, mock_client, mock_container):
        mock_container.status = "created"
        status = manager.get_container_status("abc123deadbeef")
        assert status == "created"

    def test_returns_unknown_when_not_found(self, manager, mock_client):
        mock_client.containers.get.side_effect = NotFound("not found")
        status = manager.get_container_status("nonexistent")
        assert status == "unknown"

    def test_raises_when_unavailable(self, unavailable_manager):
        with pytest.raises(DockerException, match="not available"):
            unavailable_manager.get_container_status("abc123")

    def test_raises_on_api_error(self, manager, mock_client, mock_container):
        mock_container.reload.side_effect = APIError("reload failed")
        with pytest.raises(APIError):
            manager.get_container_status("abc123deadbeef")

    def test_reloads_before_returning_status(
        self, manager, mock_client, mock_container
    ):
        """Verify reload() is called to get fresh status."""
        manager.get_container_status("abc123deadbeef")
        mock_container.reload.assert_called_once()
        mock_client.containers.get.assert_called_once_with("abc123deadbeef")


# ---------------------------------------------------------------------------
# list_running_containers
# ---------------------------------------------------------------------------


class TestListRunningContainers:
    def test_returns_list_of_dicts(self, manager, mock_client, mock_container):
        result = manager.list_running_containers()
        assert len(result) == 1
        assert result[0]["id"] == mock_container.id
        assert result[0]["name"] == mock_container.name
        assert result[0]["status"] == "running"
        assert result[0]["project_id"] == "proj-001"

    def test_filters_by_zephyr_label(self, manager, mock_client):
        manager.list_running_containers()
        mock_client.containers.list.assert_called_once_with(
            filters={"label": "zephyr.project_id"}
        )

    def test_returns_empty_when_unavailable(self, unavailable_manager):
        result = unavailable_manager.list_running_containers()
        assert result == []

    def test_returns_empty_on_error(self, manager, mock_client):
        mock_client.containers.list.side_effect = DockerException("error")
        result = manager.list_running_containers()
        assert result == []

    def test_multiple_containers(self, manager, mock_client):
        c1 = MagicMock()
        c1.id = "container1"
        c1.name = "zephyr-proj1"
        c1.status = "running"
        c1.labels = {"zephyr.project_id": "proj-001"}

        c2 = MagicMock()
        c2.id = "container2"
        c2.name = "zephyr-proj2"
        c2.status = "exited"
        c2.labels = {"zephyr.project_id": "proj-002"}

        mock_client.containers.list.return_value = [c1, c2]
        result = manager.list_running_containers()

        assert len(result) == 2
        assert result[0]["id"] == "container1"
        assert result[0]["project_id"] == "proj-001"
        assert result[1]["id"] == "container2"
        assert result[1]["project_id"] == "proj-002"

    def test_handles_missing_label(self, manager, mock_client):
        c = MagicMock()
        c.id = "container1"
        c.name = "zephyr-test"
        c.status = "running"
        c.labels = {}
        mock_client.containers.list.return_value = [c]

        result = manager.list_running_containers()
        assert len(result) == 1
        assert result[0]["project_id"] == ""

    def test_returns_empty_on_api_error(self, manager, mock_client):
        mock_client.containers.list.side_effect = APIError("api error")
        result = manager.list_running_containers()
        assert result == []
