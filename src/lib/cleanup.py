"""Graceful shutdown and container cleanup for Zephyr Desktop.

Tracks active Docker containers and ensures they are stopped and removed
on application exit, whether triggered by window close, Ctrl-C (SIGINT),
or SIGTERM.
"""

import logging
import signal
import threading
from typing import Callable

logger = logging.getLogger("zephyr.cleanup")


class CleanupManager:
    """Tracks active Docker containers and cleans them up on shutdown.

    Thread-safe: all container tracking methods acquire an internal lock.
    """

    def __init__(self) -> None:
        self._containers: set[str] = set()
        self._lock = threading.Lock()
        self._original_sigint = None
        self._original_sigterm = None

    # -- Container tracking --------------------------------------------------

    def register_container(self, container_id: str) -> None:
        """Add *container_id* to the set of tracked containers."""
        with self._lock:
            self._containers.add(container_id)
            logger.debug("Registered container %s (total: %d)",
                         container_id, len(self._containers))

    def unregister_container(self, container_id: str) -> None:
        """Remove *container_id* from the set of tracked containers."""
        with self._lock:
            self._containers.discard(container_id)
            logger.debug("Unregistered container %s (total: %d)",
                         container_id, len(self._containers))

    @property
    def tracked_containers(self) -> list[str]:
        """Return a snapshot of currently tracked container IDs."""
        with self._lock:
            return list(self._containers)

    @property
    def has_active_containers(self) -> bool:
        """Return True if there are tracked containers."""
        with self._lock:
            return len(self._containers) > 0

    # -- Cleanup -------------------------------------------------------------

    def cleanup_all(self, docker_manager, timeout: int = 30) -> list[str]:
        """Stop and remove all tracked containers.

        Args:
            docker_manager: A ``DockerManager`` instance used to stop/remove
                containers.
            timeout: Seconds to allow for each container stop operation.

        Returns:
            List of container IDs that were successfully cleaned up.
        """
        with self._lock:
            container_ids = list(self._containers)

        if not container_ids:
            logger.info("No containers to clean up")
            return []

        logger.info("Cleaning up %d container(s)...", len(container_ids))
        cleaned: list[str] = []

        for cid in container_ids:
            try:
                logger.info("Stopping container %s (timeout=%ds)...", cid, timeout)
                docker_manager.stop_container(cid, timeout=timeout)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Failed to stop container %s: %s", cid, exc)

            try:
                logger.info("Removing container %s...", cid)
                docker_manager.remove_container(cid, force=True)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Failed to remove container %s: %s", cid, exc)

            cleaned.append(cid)
            with self._lock:
                self._containers.discard(cid)

        logger.info("Cleanup complete: %d container(s) processed", len(cleaned))
        return cleaned

    # -- Signal handlers -----------------------------------------------------

    def install_signal_handlers(self, cleanup_callback: Callable) -> None:
        """Register SIGTERM and SIGINT handlers that invoke *cleanup_callback*.

        The original handlers are saved and restored after *cleanup_callback*
        runs, so the default behaviour (e.g. KeyboardInterrupt) is preserved
        for subsequent signals.
        """
        self._original_sigint = signal.getsignal(signal.SIGINT)
        self._original_sigterm = signal.getsignal(signal.SIGTERM)

        def _handler(signum: int, frame) -> None:
            sig_name = signal.Signals(signum).name
            logger.info("Received %s — running cleanup", sig_name)

            # Restore originals so a second signal terminates immediately
            signal.signal(signal.SIGINT,
                          self._original_sigint or signal.SIG_DFL)
            signal.signal(signal.SIGTERM,
                          self._original_sigterm or signal.SIG_DFL)

            try:
                cleanup_callback()
            except Exception as exc:  # noqa: BLE001
                logger.error("Cleanup callback failed: %s", exc)

            # Re-raise with original handler
            if signum == signal.SIGINT and callable(self._original_sigint):
                self._original_sigint(signum, frame)
            elif signum == signal.SIGTERM and callable(self._original_sigterm):
                self._original_sigterm(signum, frame)

        signal.signal(signal.SIGINT, _handler)
        signal.signal(signal.SIGTERM, _handler)
        logger.info("Signal handlers installed for SIGINT and SIGTERM")
