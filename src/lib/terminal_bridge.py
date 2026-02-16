"""WebSocket-to-Docker-exec bridge for embedded terminal sessions.

Each terminal session connects an xterm.js UI (via a per-session localhost
WebSocket) to a Docker exec PTY socket.  The bridge runs a dedicated asyncio
event loop on a daemon thread so that Docker I/O never blocks the Qt main
thread.

Thread-safety pattern: follows LogBridge (src/lib/log_bridge.py) — an
internal ``_BridgeEmitter(QObject)`` holds the signals; TerminalBridge
connects to them via QueuedConnection so all signal deliveries land on the
Qt main thread regardless of which asyncio task emits them.

Typical wiring (done in AppController.setup_connections):

    bridge.session_ready.connect(terminal_tab.add_session)
    bridge.session_ended.connect(terminal_tab.close_session)
    terminal_tab.terminal_requested.connect(bridge.open_session)
    terminal_tab.session_close_requested.connect(bridge.close_session)
"""

import asyncio
import logging
import socket
import threading
import uuid
from typing import Optional

from PyQt6.QtCore import QObject, Qt, pyqtSignal, pyqtSlot

logger = logging.getLogger("zephyr.terminal_bridge")

# Import websockets lazily to avoid hard dependency in environments where the
# package is not installed (tests can mock it).
websockets = None  # type: ignore[assignment]
try:
    import websockets  # type: ignore[import-untyped,no-redef]
    import websockets.server  # type: ignore[import-untyped]
    HAS_WEBSOCKETS = True
except ImportError:  # pragma: no cover
    HAS_WEBSOCKETS = False


class _BridgeEmitter(QObject):
    """Internal signal relay that lives on the main thread.

    Asyncio tasks (running on the bridge daemon thread) call the signal
    emit methods, which are thread-safe by Qt's queued-connection mechanism.
    The actual delivery to connected slots happens on the Qt main thread.
    """

    _session_ready = pyqtSignal(str, int, str)   # session_id, ws_port, user
    _session_ended = pyqtSignal(str)              # session_id
    _session_error = pyqtSignal(str, str)         # session_id, error_message


class TerminalBridge(QObject):
    """Bridge between Docker exec PTY sessions and xterm.js WebSocket clients.

    Attributes:
        session_ready: Emitted on the main thread when a new terminal session
            is fully set up.  Arguments: session_id (str), ws_port (int),
            user (str).
        session_ended: Emitted on the main thread when a session closes.
            Argument: session_id (str).
    """

    session_ready = pyqtSignal(str, int, str)   # session_id, ws_port, user
    session_ended = pyqtSignal(str)              # session_id
    session_error = pyqtSignal(str, str)         # session_id, error_message

    def __init__(self, docker_manager, parent: QObject | None = None) -> None:  # type: ignore[type-arg]
        super().__init__(parent)
        self._docker_manager = docker_manager

        self._emitter = _BridgeEmitter()
        self._emitter._session_ready.connect(
            self._on_session_ready, Qt.ConnectionType.QueuedConnection
        )
        self._emitter._session_ended.connect(
            self._on_session_ended, Qt.ConnectionType.QueuedConnection
        )
        self._emitter._session_error.connect(
            self._on_session_error, Qt.ConnectionType.QueuedConnection
        )

        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._thread: Optional[threading.Thread] = None

        # session_id → dict with keys: container_name, tasks, server, sock
        self._sessions: dict[str, dict] = {}
        self._sessions_lock = threading.Lock()

    # ------------------------------------------------------------------
    # Public lifecycle
    # ------------------------------------------------------------------

    def start(self) -> None:
        """Start the asyncio event loop on a daemon thread."""
        if self._thread is not None and self._thread.is_alive():
            return
        self._loop = asyncio.new_event_loop()
        self._thread = threading.Thread(
            target=self._run_loop, daemon=True, name="TerminalBridgeLoop"
        )
        self._thread.start()

    def stop(self) -> None:
        """Cancel all active sessions, stop the asyncio loop, and join the thread."""
        if self._loop is None:
            return
        future = asyncio.run_coroutine_threadsafe(
            self._cancel_all_sessions(), self._loop
        )
        try:
            future.result(timeout=5)
        except Exception as exc:  # pylint: disable=broad-except
            logger.warning("Error while cancelling sessions on stop: %s", exc)

        self._loop.call_soon_threadsafe(self._loop.stop)
        if self._thread is not None:
            self._thread.join(timeout=5)
        self._thread = None
        self._loop = None

    # ------------------------------------------------------------------
    # Session management (called from the Qt main thread)
    # ------------------------------------------------------------------

    def open_session(self, container_id: str, project_name: str) -> None:
        """Request a new terminal session for *container_id*.

        Schedules the async session setup on the bridge loop.  When the
        session is ready, ``session_ready`` is emitted on the main thread.
        If the session cannot be created, ``session_error`` is emitted.

        Args:
            container_id: Docker container identifier.
            project_name: Human-readable project name (stored in session).
        """
        if not HAS_WEBSOCKETS:
            logger.error("Cannot open terminal session: websockets package is not installed")
            self.session_error.emit("", "Cannot open terminal: websockets package is not installed.")
            return
        if self._loop is None:
            logger.warning("open_session called but bridge is not started")
            self.session_error.emit("", "Terminal bridge is not started.")
            return
        session_id = str(uuid.uuid4())
        asyncio.run_coroutine_threadsafe(
            self._open_session_async(session_id, container_id, project_name),
            self._loop,
        )

    def close_session(self, session_id: str) -> None:
        """Close an existing terminal session.

        Schedules the async cleanup on the bridge loop.

        Args:
            session_id: The session identifier returned via ``session_ready``.
        """
        if self._loop is None:
            return
        asyncio.run_coroutine_threadsafe(
            self._close_session_async(session_id), self._loop
        )

    def get_session_container_name(self, session_id: str) -> str:
        """Return the container name associated with *session_id*.

        Args:
            session_id: The session identifier.

        Returns:
            The container name string, or empty string if not found.
        """
        with self._sessions_lock:
            session = self._sessions.get(session_id)
            if session is None:
                return ""
            return session.get("container_name", "")

    # ------------------------------------------------------------------
    # Private — asyncio thread
    # ------------------------------------------------------------------

    def _run_loop(self) -> None:
        """Entry point for the daemon thread; runs the asyncio event loop."""
        asyncio.set_event_loop(self._loop)
        self._loop.run_forever()

    async def _open_session_async(
        self, session_id: str, container_id: str, project_name: str
    ) -> None:
        """Async coroutine that sets up a new Docker exec session."""
        try:
            exec_id: str = self._docker_manager.exec_create(
                container_id, ["/bin/bash"], user="root"
            )
        except Exception as exc:  # pylint: disable=broad-except
            logger.warning(
                "exec_create failed for container %s: %s", container_id, exc
            )
            self._emitter._session_error.emit(
                session_id, f"Failed to create exec session in container: {exc}"
            )
            self._emitter._session_ended.emit(session_id)
            return

        try:
            raw_sock: socket.socket = self._docker_manager.exec_start_socket(exec_id)
        except Exception as exc:  # pylint: disable=broad-except
            logger.warning(
                "exec_start_socket failed for exec %s: %s", exec_id, exc
            )
            self._emitter._session_error.emit(
                session_id, f"Failed to start exec socket: {exc}"
            )
            self._emitter._session_ended.emit(session_id)
            return

        port = self._find_free_port()

        # Store session metadata before serving so close_session can find it.
        with self._sessions_lock:
            self._sessions[session_id] = {
                "container_name": project_name,
                "exec_id": exec_id,
                "sock": raw_sock,
                "tasks": [],
                "server": None,
            }

        try:
            server = await websockets.serve(
                lambda ws: self._handle_session_connect(ws, session_id, raw_sock),
                "127.0.0.1",
                port,
            )
        except Exception as exc:  # pylint: disable=broad-except
            logger.warning(
                "websockets.serve failed for session %s: %s", session_id, exc
            )
            raw_sock.close()
            with self._sessions_lock:
                self._sessions.pop(session_id, None)
            self._emitter._session_error.emit(
                session_id, f"Failed to start WebSocket server: {exc}"
            )
            self._emitter._session_ended.emit(session_id)
            return

        with self._sessions_lock:
            if session_id in self._sessions:
                self._sessions[session_id]["server"] = server

        self._emitter._session_ready.emit(session_id, port, "root")

    async def _close_session_async(self, session_id: str) -> None:
        """Async coroutine that tears down an active session."""
        with self._sessions_lock:
            session = self._sessions.pop(session_id, None)

        if session is None:
            return

        # Cancel all outstanding tasks.
        for task in session.get("tasks", []):
            if not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
                except Exception as exc:  # pylint: disable=broad-except
                    logger.debug("Task cancel error: %s", exc)

        # Stop the WebSocket server.
        srv = session.get("server")
        if srv is not None:
            srv.close()
            try:
                await srv.wait_closed()
            except Exception as exc:  # pylint: disable=broad-except
                logger.debug("Server close error: %s", exc)

        # Close the raw Docker socket.
        sock = session.get("sock")
        if sock is not None:
            try:
                sock.close()
            except Exception:  # pylint: disable=broad-except
                pass

    async def _cancel_all_sessions(self) -> None:
        """Cancel every active session (called from stop())."""
        with self._sessions_lock:
            session_ids = list(self._sessions.keys())
        for session_id in session_ids:
            await self._close_session_async(session_id)

    async def _handle_session_connect(
        self,
        ws: "websockets.server.WebSocketServerProtocol",
        session_id: str,
        raw_sock: socket.socket,
    ) -> None:
        """WebSocket handler — bridges ws↔docker for the lifetime of the connection.

        Two concurrent tasks are created:
        - ws_to_docker: reads messages from the WebSocket, writes to Docker socket
        - docker_to_ws: reads from Docker socket, writes to WebSocket

        Args:
            ws: The connected WebSocket client (xterm.js).
            session_id: Identifies which session this connection belongs to.
            raw_sock: The raw Docker exec PTY socket.
        """
        import json  # local import to avoid import order issues in tests

        loop = asyncio.get_event_loop()

        async def ws_to_docker() -> None:
            try:
                async for message in ws:
                    try:
                        msg = json.loads(message) if isinstance(message, str) else {}
                    except (json.JSONDecodeError, TypeError):
                        continue
                    if msg.get("type") == "data":
                        data = msg.get("data", "")
                        if isinstance(data, str):
                            data = data.encode("utf-8", errors="replace")
                        try:
                            await loop.run_in_executor(None, raw_sock.sendall, data)
                        except Exception as exc:  # pylint: disable=broad-except
                            logger.debug("Socket send error: %s", exc)
                            break
                    elif msg.get("type") == "resize":
                        cols = msg.get("cols", 80)
                        rows = msg.get("rows", 24)
                        try:
                            self._docker_manager.exec_resize(
                                self._get_exec_id(session_id), rows, cols
                            )
                        except Exception as exc:  # pylint: disable=broad-except
                            logger.debug("exec_resize error: %s", exc)
            except Exception as exc:  # pylint: disable=broad-except
                logger.debug("ws_to_docker ended: %s", exc)

        async def docker_to_ws() -> None:
            try:
                while True:
                    data = await loop.run_in_executor(None, self._read_socket, raw_sock)
                    if not data:
                        break
                    try:
                        await ws.send(
                            json.dumps({"type": "data", "data": data.decode("utf-8", errors="replace")})
                        )
                    except Exception as exc:  # pylint: disable=broad-except
                        logger.debug("ws.send error: %s", exc)
                        break
            except Exception as exc:  # pylint: disable=broad-except
                logger.debug("docker_to_ws ended: %s", exc)

        t1 = asyncio.create_task(ws_to_docker())
        t2 = asyncio.create_task(docker_to_ws())

        with self._sessions_lock:
            if session_id in self._sessions:
                self._sessions[session_id]["tasks"].extend([t1, t2])

        try:
            await asyncio.gather(t1, t2, return_exceptions=True)
        finally:
            # One side closed — notify Qt that the session ended.
            self._emitter._session_ended.emit(session_id)

    def _get_exec_id(self, session_id: str) -> str:
        """Return the exec_id for the given session (thread-safe read)."""
        with self._sessions_lock:
            session = self._sessions.get(session_id, {})
            return session.get("exec_id", "")

    @staticmethod
    def _read_socket(sock: socket.socket, bufsize: int = 4096) -> bytes:
        """Blocking read from *sock*; returns empty bytes on EOF/error."""
        try:
            data = sock.recv(bufsize)
            return data
        except Exception:  # pylint: disable=broad-except
            return b""

    @staticmethod
    def _find_free_port() -> int:
        """Return an available localhost port by briefly binding to port 0.

        Returns:
            An integer port number that was free at the time of the call.
        """
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("127.0.0.1", 0))
            return s.getsockname()[1]

    # ------------------------------------------------------------------
    # Qt slots — run on the main thread
    # ------------------------------------------------------------------

    @pyqtSlot(str, int, str)
    def _on_session_ready(self, session_id: str, port: int, user: str) -> None:
        """Forward the internal signal to the public session_ready signal."""
        self.session_ready.emit(session_id, port, user)

    @pyqtSlot(str)
    def _on_session_ended(self, session_id: str) -> None:
        """Forward the internal signal to the public session_ended signal."""
        self.session_ended.emit(session_id)

    @pyqtSlot(str, str)
    def _on_session_error(self, session_id: str, error_message: str) -> None:
        """Forward the internal signal to the public session_error signal."""
        self.session_error.emit(session_id, error_message)
