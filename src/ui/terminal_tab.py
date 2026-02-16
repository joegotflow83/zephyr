"""Terminal tab UI for Zephyr Desktop.

Provides an embedded xterm.js terminal for accessing Docker container shells.
Each session opens in its own closable sub-tab with a WebEngine-hosted xterm.js UI.
"""

import logging
import os

from PyQt6.QtCore import QUrl, pyqtSignal
from PyQt6.QtWidgets import (
    QComboBox,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QTabWidget,
    QVBoxLayout,
    QWidget,
)

logger = logging.getLogger("zephyr.ui.terminal")

# Try to import QWebEngineView; may be unavailable in CI environments
try:
    from PyQt6.QtWebEngineWidgets import QWebEngineView

    _WEBENGINE_AVAILABLE = True
except ImportError:  # pragma: no cover
    _WEBENGINE_AVAILABLE = False
    QWebEngineView = None  # type: ignore[assignment,misc]


def _terminal_html_url(port: int, session_id: str) -> QUrl:
    """Build a file:// URL pointing to terminal.html with port/session params."""
    resources_dir = os.path.join(os.path.dirname(__file__), "..", "..", "resources")
    html_path = os.path.abspath(os.path.join(resources_dir, "terminal.html"))
    url_str = f"file://{html_path}?port={port}&session={session_id}"
    return QUrl(url_str)


class TerminalSessionWidget(QWidget):
    """Widget hosting a single terminal session inside a sub-tab.

    Contains a user indicator label (red for root, green for others) and a
    QWebEngineView that loads terminal.html with the given port/session params.

    Args:
        session_id: Unique identifier for this terminal session.
        user: The Unix user name for this session (e.g. ``"root"``).
        port: The localhost WebSocket port the TerminalBridge is listening on.
        parent: Optional parent widget.
    """

    def __init__(self, session_id: str, user: str, port: int, parent=None):
        super().__init__(parent)
        self._session_id = session_id
        self._user = user
        self._port = port
        self._setup_ui()

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # User indicator strip
        self.user_label = QLabel()
        self.user_label.setObjectName("user_label")
        self.user_label.setFixedHeight(24)
        layout.addWidget(self.user_label)

        # Web view (or placeholder when WebEngine unavailable)
        if _WEBENGINE_AVAILABLE and QWebEngineView is not None:
            self.web_view = QWebEngineView()
            self.web_view.setObjectName("terminal_web_view")
            url = _terminal_html_url(self._port, self._session_id)
            self.web_view.load(url)
        else:
            self.web_view = QLabel(  # type: ignore[assignment]
                "WebEngine unavailable — terminal requires PyQt6-WebEngine"
            )
            self.web_view.setObjectName("terminal_web_view")

        layout.addWidget(self.web_view)

        # Apply initial user styling
        self.set_user(self._user)

    def set_user(self, user: str) -> None:
        """Update the user indicator label and call JS theme function.

        Args:
            user: Unix username. ``"root"`` gets a red indicator; others get green.
        """
        self._user = user
        if user == "root":
            self.user_label.setText(f"  User: {user}  (root — elevated)")
            self.user_label.setStyleSheet(
                "background-color: #8b0000; color: white; font-weight: bold;"
            )
        else:
            self.user_label.setText(f"  User: {user}")
            self.user_label.setStyleSheet(
                "background-color: #006400; color: white; font-weight: bold;"
            )

        # Call setUserTheme in JS if WebEngine is available
        if _WEBENGINE_AVAILABLE and isinstance(self.web_view, QWebEngineView):
            js = f'if (typeof setUserTheme === "function") {{ setUserTheme("{user}"); }}'
            self.web_view.page().runJavaScript(js)

    @property
    def session_id(self) -> str:
        """Return the session ID for this widget."""
        return self._session_id


class TerminalTab(QWidget):
    """Tab widget for managing interactive terminal sessions.

    The top bar lets the user pick a running container and open a new terminal.
    Each open session appears as a closable sub-tab containing a
    :class:`TerminalSessionWidget`.

    Signals:
        terminal_requested: Emitted with ``(container_id, project_name)`` when
            the user clicks "Open Terminal".
        session_close_requested: Emitted with ``session_id`` when a session
            sub-tab is closed.
    """

    terminal_requested = pyqtSignal(str, str)  # container_id, project_name
    session_close_requested = pyqtSignal(str)  # session_id

    def __init__(self, parent=None):
        super().__init__(parent)
        # Maps session_id -> sub-tab index
        self._sessions: dict[str, int] = {}
        # Container items: list of (container_id, display_name)
        self._containers: list[tuple[str, str]] = []
        self._setup_ui()

    def _setup_ui(self):
        layout = QVBoxLayout(self)

        # Top bar: container picker + open button
        top_bar = QHBoxLayout()

        self.container_combo = QComboBox()
        self.container_combo.setObjectName("container_combo")
        self.container_combo.setMinimumWidth(260)
        self.container_combo.setPlaceholderText("Select a running container…")
        top_bar.addWidget(self.container_combo)

        self.open_terminal_btn = QPushButton("Open Terminal")
        self.open_terminal_btn.setObjectName("open_terminal_btn")
        self.open_terminal_btn.clicked.connect(self._on_open_terminal_clicked)
        top_bar.addWidget(self.open_terminal_btn)

        top_bar.addStretch()
        layout.addLayout(top_bar)

        # Session sub-tabs
        self.session_tabs = QTabWidget()
        self.session_tabs.setObjectName("session_tabs")
        self.session_tabs.setTabsClosable(True)
        self.session_tabs.tabCloseRequested.connect(self._on_tab_close_requested)
        layout.addWidget(self.session_tabs)

        # No-sessions placeholder shown when the tab widget is empty
        self.no_sessions_label = QLabel(
            "No terminal sessions open.\nSelect a container above and click \"Open Terminal\"."
        )
        self.no_sessions_label.setObjectName("no_sessions_label")
        self.no_sessions_label.setAlignment(
            self.no_sessions_label.alignment()
            | __import__("PyQt6.QtCore", fromlist=["Qt"]).Qt.AlignmentFlag.AlignCenter
        )
        layout.addWidget(self.no_sessions_label)

        self._update_placeholder_visibility()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def refresh(self, containers: list[dict]) -> None:
        """Populate the container combo box with running containers.

        Args:
            containers: List of container dicts, each with at least
                ``"id"`` (full container ID) and ``"name"`` (display name).
                Additional keys are ignored.
        """
        self.container_combo.clear()
        self._containers = []

        for item in containers:
            container_id = item.get("id", "")
            name = item.get("name", container_id)
            display = f"{name} ({container_id[:12]})" if container_id else name
            self._containers.append((container_id, name))
            self.container_combo.addItem(display)

    def add_session(self, session_id: str, user: str, port: int) -> None:
        """Add a new terminal session sub-tab.

        Args:
            session_id: Unique session identifier from :class:`TerminalBridge`.
            user: Unix username for the session (affects indicator colour).
            port: Localhost WebSocket port for this session.
        """
        if session_id in self._sessions:
            logger.warning("add_session called for already-open session %s", session_id)
            return

        widget = TerminalSessionWidget(session_id=session_id, user=user, port=port)
        tab_label = f"Terminal ({user})"
        idx = self.session_tabs.addTab(widget, tab_label)
        self._sessions[session_id] = idx
        # Rebuild index map in case insertions changed order
        self._rebuild_session_index()
        self.session_tabs.setCurrentIndex(self.session_tabs.indexOf(widget))
        self._update_placeholder_visibility()
        logger.debug("Opened terminal session %s on port %d as %s", session_id, port, user)

    def close_session(self, session_id: str) -> None:
        """Remove the terminal session sub-tab for the given session.

        Args:
            session_id: The session to close.
        """
        idx = self._find_tab_index(session_id)
        if idx is None:
            logger.warning("close_session called for unknown session %s", session_id)
            return

        self.session_tabs.removeTab(idx)
        self._sessions.pop(session_id, None)
        self._rebuild_session_index()
        self._update_placeholder_visibility()
        logger.debug("Closed terminal session %s", session_id)

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _on_open_terminal_clicked(self) -> None:
        """Validate selection and emit terminal_requested signal."""
        idx = self.container_combo.currentIndex()
        if idx < 0 or idx >= len(self._containers):
            logger.warning("Open Terminal clicked with no container selected")
            return
        container_id, project_name = self._containers[idx]
        if not container_id:
            logger.warning("Open Terminal clicked — container_id is empty")
            return
        self.terminal_requested.emit(container_id, project_name)

    def _on_tab_close_requested(self, index: int) -> None:
        """Handle the × button on a session sub-tab."""
        widget = self.session_tabs.widget(index)
        if isinstance(widget, TerminalSessionWidget):
            self.session_close_requested.emit(widget.session_id)
            # Actual removal happens via close_session() called by the controller
        else:
            # Fallback: remove directly if not a session widget
            self.session_tabs.removeTab(index)
            self._rebuild_session_index()
            self._update_placeholder_visibility()

    def _find_tab_index(self, session_id: str) -> int | None:
        """Return the current tab index for session_id, or None if not found."""
        for i in range(self.session_tabs.count()):
            widget = self.session_tabs.widget(i)
            if isinstance(widget, TerminalSessionWidget) and widget.session_id == session_id:
                return i
        return None

    def _rebuild_session_index(self) -> None:
        """Rebuild self._sessions mapping after any tab insertions/removals."""
        new_sessions: dict[str, int] = {}
        for i in range(self.session_tabs.count()):
            widget = self.session_tabs.widget(i)
            if isinstance(widget, TerminalSessionWidget):
                new_sessions[widget.session_id] = i
        self._sessions = new_sessions

    def _update_placeholder_visibility(self) -> None:
        """Show/hide the no-sessions placeholder and session tabs appropriately."""
        has_sessions = self.session_tabs.count() > 0
        self.session_tabs.setVisible(has_sessions)
        self.no_sessions_label.setVisible(not has_sessions)
