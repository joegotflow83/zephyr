"""Loop execution engine for Zephyr Desktop.

Part 1: Data types — LoopMode, LoopStatus, and LoopState.
Part 2: LoopRunner — orchestrates container creation, log streaming,
and lifecycle management for Ralph loops.
"""

import logging
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from src.lib.credential_manager import CredentialManager
    from src.lib.docker_manager import DockerManager
    from src.lib.project_store import ProjectStore

logger = logging.getLogger("zephyr.loop")


class LoopMode(Enum):
    """How a loop should execute.

    SINGLE runs one iteration then stops. CONTINUOUS runs indefinitely
    until explicitly stopped. SCHEDULED runs at cron-like intervals
    managed by LoopScheduler.
    """

    SINGLE = "single"
    CONTINUOUS = "continuous"
    SCHEDULED = "scheduled"


class LoopStatus(Enum):
    """Current lifecycle state of a loop.

    Transitions:
        IDLE -> STARTING -> RUNNING -> COMPLETED | FAILED | STOPPING -> STOPPED
        RUNNING -> PAUSED -> RUNNING  (pause/resume)
        Any -> FAILED  (on unrecoverable error)
    """

    IDLE = "idle"
    STARTING = "starting"
    RUNNING = "running"
    PAUSED = "paused"
    STOPPING = "stopping"
    STOPPED = "stopped"
    FAILED = "failed"
    COMPLETED = "completed"


@dataclass
class LoopState:
    """Runtime state of a single loop execution.

    Tracks the association between a project and its Docker container,
    current iteration count, detected commits, and any error information.

    Attributes:
        project_id: UUID of the project this loop belongs to.
        container_id: Docker container ID, or None if not yet created.
        mode: Execution mode (single, continuous, scheduled).
        status: Current lifecycle status.
        iteration: Number of completed loop iterations.
        started_at: ISO 8601 timestamp when the loop started, or None.
        last_log: Most recent log line from the container.
        commits_detected: Git commit hashes observed in container output.
        error: Error message if status is FAILED, else None.
    """

    project_id: str
    container_id: str | None = None
    mode: LoopMode = LoopMode.SINGLE
    status: LoopStatus = LoopStatus.IDLE
    iteration: int = 0
    started_at: str | None = None
    last_log: str = ""
    commits_detected: list[str] = field(default_factory=list)
    error: str | None = None

    def to_dict(self) -> dict:
        """Serialize to a plain dict suitable for JSON storage."""
        return {
            "project_id": self.project_id,
            "container_id": self.container_id,
            "mode": self.mode.value,
            "status": self.status.value,
            "iteration": self.iteration,
            "started_at": self.started_at,
            "last_log": self.last_log,
            "commits_detected": list(self.commits_detected),
            "error": self.error,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "LoopState":
        """Deserialize from a dict, using defaults for missing optional fields."""
        return cls(
            project_id=data["project_id"],
            container_id=data.get("container_id"),
            mode=LoopMode(data.get("mode", "single")),
            status=LoopStatus(data.get("status", "idle")),
            iteration=data.get("iteration", 0),
            started_at=data.get("started_at"),
            last_log=data.get("last_log", ""),
            commits_detected=list(data.get("commits_detected", [])),
            error=data.get("error"),
        )


# ---------------------------------------------------------------------------
# Service name -> environment variable mapping for credential injection
# ---------------------------------------------------------------------------

_SERVICE_ENV_MAP: dict[str, str] = {
    "anthropic": "ANTHROPIC_API_KEY",
    "openai": "OPENAI_API_KEY",
    "github": "GITHUB_TOKEN",
}


class LoopRunner:
    """Orchestrates Ralph loop execution inside Docker containers.

    Each project loop runs in its own thread.  A semaphore limits
    the number of concurrent loops to ``max_concurrent`` (default 5).

    Args:
        docker_manager: DockerManager for container operations.
        project_store: ProjectStore for project lookups.
        credential_manager: CredentialManager for API key injection.
        max_concurrent: Maximum number of loops running at once.
    """

    def __init__(
        self,
        docker_manager: "DockerManager",
        project_store: "ProjectStore",
        credential_manager: "CredentialManager",
        max_concurrent: int = 5,
    ) -> None:
        self._docker = docker_manager
        self._projects = project_store
        self._credentials = credential_manager
        self._states: dict[str, LoopState] = {}
        self._threads: dict[str, threading.Thread] = {}
        self._semaphore = threading.Semaphore(max_concurrent)
        self._lock = threading.Lock()
        self._on_loop_completed: list = []
        self._on_loop_failed: list = []

    def add_completion_callback(self, callback) -> None:
        """Register a callback invoked when a loop completes.

        The callback receives (project_id: str, iterations: int).
        Called from the loop monitor thread — callers must handle
        thread safety themselves.
        """
        self._on_loop_completed.append(callback)

    def add_failure_callback(self, callback) -> None:
        """Register a callback invoked when a loop fails.

        The callback receives (project_id: str, error: str).
        Called from the loop monitor thread — callers must handle
        thread safety themselves.
        """
        self._on_loop_failed.append(callback)

    # -- Public API ----------------------------------------------------------

    def start_loop(  # pylint: disable=unused-argument
        self,
        project_id: str,
        mode: LoopMode,
        schedule: str | None = None,
    ) -> LoopState:
        """Start a loop for the given project.

        Validates the project exists, checks concurrency limits, creates
        a Docker container with injected API keys, starts it, begins log
        streaming, and returns the initial LoopState.

        Raises:
            ValueError: If the project does not exist or a loop is
                already running for this project.
            RuntimeError: If the max concurrent loop limit is reached.
        """
        # Validate project
        project = self._projects.get_project(project_id)
        if project is None:
            raise ValueError(f"Project '{project_id}' not found")

        with self._lock:
            # Check for already-running loop
            existing = self._states.get(project_id)
            if existing and existing.status in (
                LoopStatus.STARTING,
                LoopStatus.RUNNING,
                LoopStatus.PAUSED,
            ):
                raise ValueError(
                    f"Loop already active for project '{project_id}' "
                    f"(status: {existing.status.value})"
                )

            # Try to acquire semaphore (non-blocking)
            if not self._semaphore.acquire(blocking=False):
                raise RuntimeError(
                    "Maximum concurrent loop limit reached. "
                    "Stop an existing loop before starting a new one."
                )

            # Create initial state
            state = LoopState(
                project_id=project_id,
                mode=mode,
                status=LoopStatus.STARTING,
                started_at=datetime.now(timezone.utc).isoformat(),
            )
            self._states[project_id] = state

        # Build env vars from stored credentials
        env_vars = self._build_env_vars()

        try:
            # Create and start container
            container_id = self._docker.create_container(
                project=project,
                repo_path=project.repo_url,
                env_vars=env_vars,
            )

            with self._lock:
                state.container_id = container_id

            self._docker.start_container(container_id)

            # Start log streaming in a background thread
            self._docker.stream_logs(
                container_id=container_id,
                callback=self._make_log_callback(project_id),
            )

            # Start the loop monitor thread
            thread = threading.Thread(
                target=self._run_loop,
                args=(project_id,),
                name=f"zephyr-loop-{project_id[:12]}",
                daemon=True,
            )

            with self._lock:
                state.status = LoopStatus.RUNNING
                self._threads[project_id] = thread

            thread.start()
            logger.info(
                "Started loop for project %s (mode=%s, container=%s)",
                project_id,
                mode.value,
                container_id,
            )
            return state

        except Exception as exc:
            # On failure, clean up state and release semaphore
            with self._lock:
                state.status = LoopStatus.FAILED
                state.error = str(exc)
            self._semaphore.release()
            logger.error(
                "Failed to start loop for project %s: %s",
                project_id,
                exc,
            )
            for cb in self._on_loop_failed:
                try:
                    cb(project_id, str(exc))
                except Exception:
                    logger.warning("Failure callback error", exc_info=True)
            raise

    def stop_loop(self, project_id: str) -> None:
        """Stop a running loop for the given project.

        Transitions the state to STOPPING, stops the Docker container,
        then marks it STOPPED and releases the concurrency semaphore.

        Raises:
            ValueError: If no active loop exists for the project.
        """
        with self._lock:
            state = self._states.get(project_id)
            if state is None or state.status not in (
                LoopStatus.STARTING,
                LoopStatus.RUNNING,
                LoopStatus.PAUSED,
            ):
                raise ValueError(f"No active loop for project '{project_id}'")
            state.status = LoopStatus.STOPPING

        try:
            if state.container_id:
                self._docker.stop_container(state.container_id)
                self._docker.remove_container(state.container_id, force=True)
        except Exception as exc:
            logger.warning(
                "Error stopping container for project %s: %s",
                project_id,
                exc,
            )

        with self._lock:
            state.status = LoopStatus.STOPPED
            state.container_id = None

        self._semaphore.release()
        logger.info("Stopped loop for project %s", project_id)

    def get_loop_state(self, project_id: str) -> LoopState | None:
        """Return the current LoopState for a project, or None."""
        with self._lock:
            return self._states.get(project_id)

    def get_all_states(self) -> dict[str, LoopState]:
        """Return a copy of all tracked loop states."""
        with self._lock:
            return dict(self._states)

    # -- Internal helpers ----------------------------------------------------

    def _build_env_vars(self) -> dict[str, str]:
        """Collect API keys from CredentialManager into env var dict."""
        env_vars: dict[str, str] = {}
        for service, env_name in _SERVICE_ENV_MAP.items():
            key = self._credentials.get_api_key(service)
            if key:
                env_vars[env_name] = key
        return env_vars

    def _make_log_callback(self, project_id: str):
        """Return a closure that updates the LoopState with each log line."""

        def _on_log(line: str) -> None:
            with self._lock:
                state = self._states.get(project_id)
                if state is not None:
                    state.last_log = line

        return _on_log

    def _run_loop(self, project_id: str) -> None:
        """Monitor thread for a running loop.

        Waits for the container to finish (for SINGLE mode) or runs
        until explicitly stopped (CONTINUOUS/SCHEDULED).  On container
        exit, transitions to COMPLETED or FAILED based on exit code.
        """
        try:
            with self._lock:
                state = self._states.get(project_id)
                if state is None:
                    return
                container_id = state.container_id

            if container_id is None:
                return

            # Poll container status until it exits or loop is stopped
            while True:
                with self._lock:
                    current_state = self._states.get(project_id)
                    if current_state is None:
                        break
                    if current_state.status in (
                        LoopStatus.STOPPING,
                        LoopStatus.STOPPED,
                    ):
                        break

                try:
                    status = self._docker.get_container_status(container_id)
                except Exception as status_exc:
                    with self._lock:
                        s = self._states.get(project_id)
                        if s and s.status not in (
                            LoopStatus.STOPPED,
                            LoopStatus.STOPPING,
                        ):
                            s.status = LoopStatus.FAILED
                            s.error = str(status_exc)
                    self._semaphore.release()
                    logger.error(
                        "Container status check failed for project %s: %s",
                        project_id,
                        status_exc,
                    )
                    for cb in self._on_loop_failed:
                        try:
                            cb(project_id, str(status_exc))
                        except Exception:
                            logger.warning("Failure callback error", exc_info=True)
                    return

                if status == "exited" or status == "dead":
                    with self._lock:
                        if current_state.status == LoopStatus.RUNNING:
                            current_state.iteration += 1
                            current_state.status = LoopStatus.COMPLETED
                    self._semaphore.release()
                    logger.info("Loop completed for project %s", project_id)
                    for cb in self._on_loop_completed:
                        try:
                            cb(project_id, current_state.iteration)
                        except Exception:
                            logger.warning("Completion callback error", exc_info=True)
                    return

                # Brief sleep to avoid busy-waiting
                time.sleep(2)

        except Exception as exc:
            with self._lock:
                state = self._states.get(project_id)
                if state and state.status not in (
                    LoopStatus.STOPPED,
                    LoopStatus.STOPPING,
                ):
                    state.status = LoopStatus.FAILED
                    state.error = str(exc)
            self._semaphore.release()
            logger.error(
                "Loop monitor failed for project %s: %s",
                project_id,
                exc,
            )
            for cb in self._on_loop_failed:
                try:
                    cb(project_id, str(exc))
                except Exception:
                    logger.warning("Failure callback error", exc_info=True)
