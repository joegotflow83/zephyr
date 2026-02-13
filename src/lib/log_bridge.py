"""Real-time log bridge with Qt signals for thread-safe log delivery.

Docker log streaming runs on background daemon threads, but Qt widgets
can only be updated from the main thread.  LogBridge sits between these
two worlds: it provides a plain-Python callback that background threads
call with log lines, and re-emits those lines as a Qt signal that is
delivered on the main thread via a queued connection.

Typical wiring (done in AppController.setup_connections):

    log_bridge.log_received.connect(loops_tab.append_log)

Then when starting a loop:

    callback = log_bridge.create_callback(project_id)
    docker_manager.stream_logs(container_id, callback)
"""

import logging
from typing import Callable

from PyQt6.QtCore import QObject, Qt, pyqtSignal, pyqtSlot

logger = logging.getLogger("zephyr.logbridge")


class _LogEmitter(QObject):
    """Internal signal relay that lives on the main thread.

    Background threads call ``relay(project_id, line)`` which emits
    ``_incoming``.  Because ``_incoming`` is connected to the bridge's
    handler with a ``QueuedConnection``, the handler runs on the main
    thread regardless of which thread called ``relay()``.

    Qt guarantees that emitting a signal connected via QueuedConnection
    from any thread is safe — the arguments are queued and delivered in
    the receiver's event loop.
    """

    _incoming = pyqtSignal(str, str)


class LogBridge(QObject):
    """Thread-safe bridge from background log threads to the Qt main thread.

    Attributes:
        log_received: Signal emitted on the main thread with
            (project_id, line) whenever a log callback fires.
    """

    log_received = pyqtSignal(str, str)

    def __init__(self, parent: QObject | None = None) -> None:
        super().__init__(parent)
        self._emitter = _LogEmitter()
        # QueuedConnection ensures _on_incoming runs on *this* object's
        # thread (the main thread), not on whatever thread emits _incoming.
        self._emitter._incoming.connect(
            self._on_incoming, Qt.ConnectionType.QueuedConnection
        )

    def create_callback(self, project_id: str) -> Callable[[str], None]:
        """Return a callback safe to call from any thread.

        The returned callable accepts a single ``str`` log line.  When
        called, it thread-safely posts a signal emission to the Qt event
        loop so that connected slots execute on the main thread.

        Args:
            project_id: Identifies which project the log lines belong to.

        Returns:
            A closure ``(line: str) -> None`` suitable for passing to
            ``DockerManager.stream_logs()``.
        """
        emitter = self._emitter

        def _on_log(line: str) -> None:
            emitter._incoming.emit(project_id, line)

        return _on_log

    @pyqtSlot(str, str)
    def _on_incoming(self, project_id: str, line: str) -> None:
        """Slot invoked on the main thread to emit ``log_received``."""
        self.log_received.emit(project_id, line)

    @pyqtSlot(str, str)
    def _emit_log(self, project_id: str, line: str) -> None:
        """Direct slot for testing — emits ``log_received`` immediately."""
        self.log_received.emit(project_id, line)
