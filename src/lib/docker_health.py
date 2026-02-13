"""Docker health monitor for Zephyr Desktop.

Polls Docker daemon availability on a background thread and emits Qt
signals when the connection state changes.  This allows the UI to
reactively disable loop-start buttons and show status-bar warnings
when Docker becomes unavailable, and re-enable them on reconnection.

Typical wiring (done in AppController):

    health_monitor = DockerHealthMonitor(docker_manager)
    health_monitor.docker_connected.connect(on_docker_connected)
    health_monitor.docker_disconnected.connect(on_docker_disconnected)
    health_monitor.start()
"""

import logging
import threading

from PyQt6.QtCore import QObject, Qt, pyqtSignal, pyqtSlot

from src.lib.docker_manager import DockerManager

logger = logging.getLogger("zephyr.docker.health")


class _HealthEmitter(QObject):
    """Internal signal relay for cross-thread signal delivery.

    The polling thread calls ``emit_connected()`` or ``emit_disconnected()``
    which emit signals.  Because these are connected to the monitor's slots
    via ``QueuedConnection``, the slots run on the main thread.
    """

    _connected = pyqtSignal()
    _disconnected = pyqtSignal()


class DockerHealthMonitor(QObject):
    """Background monitor that polls Docker daemon availability.

    Emits ``docker_connected`` when Docker becomes reachable after being
    unreachable, and ``docker_disconnected`` when it becomes unreachable
    after being reachable.  Signals are only emitted on *transitions*,
    not on every poll.

    Args:
        docker_manager: The DockerManager instance to poll.
        poll_interval: Seconds between polls (default 30).
        parent: Optional Qt parent object.
    """

    docker_connected = pyqtSignal()
    docker_disconnected = pyqtSignal()

    def __init__(
        self,
        docker_manager: DockerManager,
        poll_interval: float = 30.0,
        parent: QObject | None = None,
    ) -> None:
        super().__init__(parent)
        self._docker_manager = docker_manager
        self._poll_interval = poll_interval
        self._connected = False
        self._running = False
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

        # Internal emitter for thread-safe signal delivery
        self._emitter = _HealthEmitter()
        self._emitter._connected.connect(
            self._on_connected, Qt.ConnectionType.QueuedConnection
        )
        self._emitter._disconnected.connect(
            self._on_disconnected, Qt.ConnectionType.QueuedConnection
        )

    def start(self) -> None:
        """Start the background polling thread.

        Does nothing if already running.
        """
        if self._running:
            return

        # Check initial state synchronously before starting the thread
        self._connected = self._docker_manager.is_docker_available()
        self._stop_event.clear()
        self._running = True

        self._thread = threading.Thread(
            target=self._poll_loop,
            name="zephyr-docker-health",
            daemon=True,
        )
        self._thread.start()
        logger.info(
            "Docker health monitor started (interval=%.1fs, initial=%s)",
            self._poll_interval,
            "connected" if self._connected else "disconnected",
        )

    def stop(self) -> None:
        """Stop the background polling thread.

        Blocks until the thread exits (up to one poll interval).
        """
        if not self._running:
            return

        self._running = False
        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(timeout=self._poll_interval + 1)
            self._thread = None
        logger.info("Docker health monitor stopped")

    def is_connected(self) -> bool:
        """Return the last known Docker connection state."""
        return self._connected

    def _poll_loop(self) -> None:
        """Background loop that checks Docker availability periodically."""
        while not self._stop_event.is_set():
            self._stop_event.wait(self._poll_interval)
            if self._stop_event.is_set():
                break

            try:
                available = self._docker_manager.is_docker_available()
            except Exception:
                available = False

            was_connected = self._connected
            self._connected = available

            if available and not was_connected:
                logger.info("Docker daemon reconnected")
                self._emitter._connected.emit()
            elif not available and was_connected:
                logger.warning("Docker daemon disconnected")
                self._emitter._disconnected.emit()

    @pyqtSlot()
    def _on_connected(self) -> None:
        """Slot invoked on the main thread when Docker reconnects."""
        self.docker_connected.emit()

    @pyqtSlot()
    def _on_disconnected(self) -> None:
        """Slot invoked on the main thread when Docker disconnects."""
        self.docker_disconnected.emit()
