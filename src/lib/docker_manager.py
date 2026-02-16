"""Docker integration for Zephyr Desktop.

Provides DockerManager for checking Docker availability, querying
daemon info, verifying image presence, pulling images, managing
container lifecycle (create, start, stop, remove, status, list),
streaming container logs, and creating interactive exec sessions.
"""

import logging
import socket
import threading
from typing import Callable

import docker
from docker.errors import DockerException, ImageNotFound, APIError, NotFound

from src.lib.models import ProjectConfig

logger = logging.getLogger("zephyr.docker")


class DockerManager:
    """Manages the connection to the local Docker daemon.

    Attempts to connect to Docker on construction.  All public methods
    handle the case where Docker is unreachable gracefully.
    """

    def __init__(self) -> None:
        self._client: docker.DockerClient | None = None
        try:
            self._client = docker.from_env()
            # Verify the connection is actually alive
            self._client.ping()
            logger.info("Docker daemon connected")
        except DockerException as exc:
            logger.warning("Docker daemon not reachable: %s", exc)
            self._client = None

    # -- Connection & status -------------------------------------------------

    def is_docker_available(self) -> bool:
        """Return True if the Docker daemon is reachable."""
        if self._client is None:
            return False
        try:
            self._client.ping()
            return True
        except DockerException:
            return False

    def get_docker_info(self) -> dict | None:
        """Return ``client.info()`` dict, or None if Docker is unavailable."""
        if self._client is None:
            return None
        try:
            return self._client.info()
        except DockerException as exc:
            logger.warning("Failed to get Docker info: %s", exc)
            return None

    # -- Image operations ----------------------------------------------------

    def is_image_available(self, image: str) -> bool:
        """Check whether *image* (e.g. ``ubuntu:24.04``) exists locally."""
        if self._client is None:
            return False
        try:
            self._client.images.get(image)
            return True
        except ImageNotFound:
            return False
        except DockerException as exc:
            logger.warning("Error checking image %s: %s", image, exc)
            return False

    def pull_image(
        self,
        image: str,
        progress_callback: Callable[[dict], None] | None = None,
    ) -> None:
        """Pull *image* from the registry.

        If *progress_callback* is provided it is called with each
        progress dict emitted by the Docker daemon (contains keys like
        ``status``, ``progress``, ``id``).

        Raises ``DockerException`` if Docker is unavailable or the pull
        fails.
        """
        if self._client is None:
            raise DockerException("Docker daemon is not available")
        try:
            # Use the low-level API for streaming progress
            resp = self._client.api.pull(image, stream=True, decode=True)
            for chunk in resp:
                if progress_callback is not None:
                    progress_callback(chunk)
            logger.info("Successfully pulled image %s", image)
        except (DockerException, APIError) as exc:
            # docker-py wraps StoreError (missing credentials helper) as a
            # DockerException.  For public images this is recoverable: retry
            # with an empty auth_config to bypass the credentials store.
            if "Credentials store error" in str(exc) or "StoreError" in str(exc):
                logger.warning(
                    "Credentials store unavailable for %s, retrying without auth: %s",
                    image,
                    exc,
                )
                try:
                    resp = self._client.api.pull(
                        image, stream=True, decode=True, auth_config={}
                    )
                    for chunk in resp:
                        if progress_callback is not None:
                            progress_callback(chunk)
                    logger.info(
                        "Successfully pulled image %s (no credentials store)", image
                    )
                    return
                except (DockerException, APIError) as retry_exc:
                    logger.error(
                        "Failed to pull image %s (no-auth retry): %s", image, retry_exc
                    )
                    raise retry_exc
            logger.error("Failed to pull image %s: %s", image, exc)
            raise

    # -- Container lifecycle -------------------------------------------------

    def create_container(
        self,
        project: ProjectConfig,
        repo_path: str,
        env_vars: dict | None = None,
    ) -> str:
        """Create a container for *project*.

        Mounts *repo_path* to ``/workspace`` inside the container, injects
        *env_vars*, and labels the container with ``zephyr.project_id``.

        Returns the container ID.

        Raises ``DockerException`` if Docker is unavailable or creation fails.
        """
        if self._client is None:
            raise DockerException("Docker daemon is not available")

        labels = {
            "zephyr.project_id": project.id,
            "zephyr.project_name": project.name,
        }

        volumes = {
            repo_path: {"bind": "/workspace", "mode": "rw"},
        }

        try:
            container = self._client.containers.create(
                image=project.docker_image,
                name=f"zephyr-{project.id[:12]}",
                labels=labels,
                volumes=volumes,
                environment=env_vars or {},
                working_dir="/workspace",
                stdin_open=True,
                tty=True,
                detach=True,
            )
            logger.info(
                "Created container %s for project %s",
                container.id,
                project.name,
            )
            return container.id
        except (DockerException, APIError) as exc:
            logger.error(
                "Failed to create container for project %s: %s",
                project.name,
                exc,
            )
            raise

    def start_container(self, container_id: str) -> None:
        """Start a previously created container.

        Raises ``DockerException`` if Docker is unavailable or start fails.
        """
        if self._client is None:
            raise DockerException("Docker daemon is not available")
        try:
            container = self._client.containers.get(container_id)
            container.start()
            logger.info("Started container %s", container_id)
        except (DockerException, APIError) as exc:
            logger.error("Failed to start container %s: %s", container_id, exc)
            raise

    def stop_container(self, container_id: str, timeout: int = 10) -> None:
        """Stop a running container with the given *timeout*.

        Raises ``DockerException`` if Docker is unavailable or stop fails.
        """
        if self._client is None:
            raise DockerException("Docker daemon is not available")
        try:
            container = self._client.containers.get(container_id)
            container.stop(timeout=timeout)
            logger.info("Stopped container %s", container_id)
        except (DockerException, APIError) as exc:
            logger.error("Failed to stop container %s: %s", container_id, exc)
            raise

    def remove_container(self, container_id: str, force: bool = False) -> None:
        """Remove a container, optionally *force* killing it first.

        Raises ``DockerException`` if Docker is unavailable or removal fails.
        """
        if self._client is None:
            raise DockerException("Docker daemon is not available")
        try:
            container = self._client.containers.get(container_id)
            container.remove(force=force)
            logger.info("Removed container %s (force=%s)", container_id, force)
        except (DockerException, APIError) as exc:
            logger.error("Failed to remove container %s: %s", container_id, exc)
            raise

    def get_container_status(self, container_id: str) -> str:
        """Return the status of a container.

        Returns one of ``"running"``, ``"exited"``, ``"paused"``,
        ``"created"``, ``"restarting"``, ``"removing"``, ``"dead"``,
        or ``"unknown"`` if the container cannot be found.

        Raises ``DockerException`` if Docker is unavailable.
        """
        if self._client is None:
            raise DockerException("Docker daemon is not available")
        try:
            container = self._client.containers.get(container_id)
            container.reload()
            return container.status
        except NotFound:
            return "unknown"
        except (DockerException, APIError) as exc:
            logger.error(
                "Failed to get status of container %s: %s",
                container_id,
                exc,
            )
            raise

    def list_running_containers(self) -> list[dict]:
        """Return a list of Zephyr-managed running containers.

        Each dict contains ``id``, ``name``, ``status``, and
        ``project_id`` (from the ``zephyr.project_id`` label).

        Returns an empty list if Docker is unavailable.
        """
        if self._client is None:
            return []
        try:
            containers = self._client.containers.list(
                filters={"label": "zephyr.project_id"}
            )
            result = []
            for c in containers:
                result.append(
                    {
                        "id": c.id,
                        "name": c.name,
                        "status": c.status,
                        "project_id": c.labels.get("zephyr.project_id", ""),
                    }
                )
            return result
        except (DockerException, APIError) as exc:
            logger.warning("Failed to list containers: %s", exc)
            return []

    # -- Log streaming -------------------------------------------------------

    def stream_logs(
        self,
        container_id: str,
        callback: Callable[[str], None],
        follow: bool = True,
    ) -> threading.Thread:
        """Stream container logs in a background daemon thread.

        Each decoded line from the container's log output is passed to
        *callback*.  The thread runs as a daemon so it won't block
        application shutdown.

        Returns the started ``threading.Thread``.

        Raises ``DockerException`` if Docker is unavailable or the
        container cannot be found.
        """
        if self._client is None:
            raise DockerException("Docker daemon is not available")

        # Resolve the container object on the calling thread so errors
        # surface immediately rather than silently inside the daemon.
        try:
            container = self._client.containers.get(container_id)
        except (DockerException, APIError) as exc:
            logger.error(
                "Failed to get container %s for log streaming: %s",
                container_id,
                exc,
            )
            raise

        def _stream() -> None:
            try:
                log_generator = container.logs(
                    stream=True, follow=follow, timestamps=False
                )
                for chunk in log_generator:
                    line = chunk.decode("utf-8", errors="replace").rstrip("\n")
                    if line:
                        callback(line)
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "Log streaming ended for container %s: %s",
                    container_id,
                    exc,
                )

        thread = threading.Thread(
            target=_stream,
            name=f"zephyr-log-{container_id[:12]}",
            daemon=True,
        )
        thread.start()
        logger.info("Started log streaming thread for container %s", container_id)
        return thread

    def get_logs(self, container_id: str, tail: int = 100) -> str:
        """Return the last *tail* lines of a container's logs as a string.

        Raises ``DockerException`` if Docker is unavailable or the
        container cannot be found.
        """
        if self._client is None:
            raise DockerException("Docker daemon is not available")
        try:
            container = self._client.containers.get(container_id)
            raw = container.logs(tail=tail, timestamps=False)
            return raw.decode("utf-8", errors="replace")
        except (DockerException, APIError) as exc:
            logger.error(
                "Failed to get logs for container %s: %s",
                container_id,
                exc,
            )
            raise

    # -- Exec / interactive terminal -----------------------------------------

    def exec_create(
        self, container_id: str, cmd: list[str], user: str = "root"
    ) -> str:
        """Create an exec instance inside *container_id*.

        Opens a PTY-enabled, stdin-attached exec session running *cmd*
        as *user*.

        Returns the exec ID string.

        Raises ``DockerException`` if Docker is unavailable or the call
        fails.
        """
        if self._client is None:
            raise DockerException("Docker daemon is not available")
        try:
            exec_id = self._client.api.exec_create(
                container_id,
                cmd,
                tty=True,
                stdin=True,
                user=user,
            )
            logger.info(
                "Created exec instance in container %s (cmd=%s, user=%s)",
                container_id,
                cmd,
                user,
            )
            # docker-py returns a dict like {"Id": "..."} or a plain string
            if isinstance(exec_id, dict):
                return exec_id["Id"]
            return str(exec_id)
        except (DockerException, APIError) as exc:
            logger.error(
                "Failed to create exec in container %s: %s",
                container_id,
                exc,
            )
            raise

    def exec_start_socket(self, exec_id: str) -> socket.socket:
        """Start an exec session and return the underlying raw socket.

        Launches the exec instance identified by *exec_id* with PTY
        mode.  The docker-py / urllib3 socket wrapper is unwrapped to
        obtain a plain ``socket.socket`` which is set to non-blocking
        mode so it can be driven by an asyncio event loop.

        Returns the raw ``socket.socket``.

        Raises ``DockerException`` if Docker is unavailable or the call
        fails.
        """
        if self._client is None:
            raise DockerException("Docker daemon is not available")
        try:
            sock_wrapper = self._client.api.exec_start(
                exec_id, tty=True, socket=True
            )
            # Unwrap urllib3 / docker-py socket layers to get the raw socket.
            # The wrapper exposes .raw._sock or .raw.raw.raw depending on version.
            raw: socket.socket = sock_wrapper
            for attr in ("raw", "_sock"):
                wrapped = getattr(raw, attr, None)
                if wrapped is not None:
                    raw = wrapped
            raw.setblocking(False)
            logger.info("Started exec socket for exec_id %s", exec_id)
            return raw
        except (DockerException, APIError) as exc:
            logger.error(
                "Failed to start exec socket for exec_id %s: %s",
                exec_id,
                exc,
            )
            raise

    def exec_resize(self, exec_id: str, rows: int, cols: int) -> None:
        """Resize the PTY for exec instance *exec_id*.

        Updates the terminal dimensions to *rows* × *cols*.  Any
        failure is logged as a warning but does not propagate — a
        resize error should never crash the terminal session.

        Raises ``DockerException`` if Docker is unavailable.
        """
        if self._client is None:
            raise DockerException("Docker daemon is not available")
        try:
            self._client.api.exec_resize(exec_id, height=rows, width=cols)
            logger.debug(
                "Resized exec %s to %dx%d", exec_id, cols, rows
            )
        except (DockerException, APIError) as exc:
            logger.warning(
                "Failed to resize exec %s (%dx%d): %s",
                exec_id,
                cols,
                rows,
                exc,
            )
