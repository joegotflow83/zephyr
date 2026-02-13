"""Running Loops tab UI for Zephyr Desktop.

Displays a table of active/completed loop executions with real-time status,
a log viewer for the selected loop, and action buttons for start/stop control.
"""

from PyQt6.QtCore import Qt, pyqtSignal
from PyQt6.QtGui import QFont
from PyQt6.QtWidgets import (
    QHBoxLayout,
    QPlainTextEdit,
    QPushButton,
    QSplitter,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from src.lib.loop_runner import LoopState, LoopStatus


class LoopsTab(QWidget):
    """Tab widget showing running loops with a log viewer.

    The upper section contains a table of loop states with action buttons.
    The lower section shows a read-only log viewer for the selected loop.

    Signals:
        loop_start_requested: Emitted with project_id when Start is clicked.
        loop_stop_requested: Emitted with project_id when Stop is clicked.
    """

    loop_start_requested = pyqtSignal(str)
    loop_stop_requested = pyqtSignal(str)
    log_export_requested = pyqtSignal(str)  # project_id or "" for all
    log_export_all_requested = pyqtSignal()

    COLUMNS = ["Project", "Status", "Mode", "Iteration", "Started", "Actions"]

    def __init__(self, parent=None):
        super().__init__(parent)
        self._project_ids: list[str] = []
        self._project_names: dict[str, str] = {}
        self._log_buffers: dict[str, list[str]] = {}
        self._selected_project_id: str | None = None
        self._setup_ui()

    def _setup_ui(self):
        layout = QVBoxLayout(self)

        splitter = QSplitter(Qt.Orientation.Vertical)
        splitter.setObjectName("loops_splitter")

        # Upper: loops table
        table_widget = QWidget()
        table_layout = QVBoxLayout(table_widget)
        table_layout.setContentsMargins(0, 0, 0, 0)

        self.table = QTableWidget()
        self.table.setObjectName("loops_table")
        self.table.setColumnCount(len(self.COLUMNS))
        self.table.setHorizontalHeaderLabels(self.COLUMNS)
        self.table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        self.table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        self.table.horizontalHeader().setStretchLastSection(True)
        self.table.selectionModel().selectionChanged.connect(self._on_selection_changed)
        table_layout.addWidget(self.table)

        splitter.addWidget(table_widget)

        # Lower: log viewer
        log_widget = QWidget()
        log_layout = QVBoxLayout(log_widget)
        log_layout.setContentsMargins(0, 0, 0, 0)

        self.log_viewer = QPlainTextEdit()
        self.log_viewer.setObjectName("log_viewer")
        self.log_viewer.setReadOnly(True)
        self.log_viewer.setFont(QFont("monospace", 9))
        self.log_viewer.setPlaceholderText("Select a loop to view its logs...")
        log_layout.addWidget(self.log_viewer)

        # Export buttons row
        export_row = QHBoxLayout()
        self.export_log_btn = QPushButton("Export Selected Log")
        self.export_log_btn.setObjectName("export_log_btn")
        self.export_log_btn.setEnabled(False)
        self.export_log_btn.clicked.connect(self._on_export_log_clicked)
        export_row.addWidget(self.export_log_btn)

        self.export_all_logs_btn = QPushButton("Export All Logs")
        self.export_all_logs_btn.setObjectName("export_all_logs_btn")
        self.export_all_logs_btn.clicked.connect(
            lambda: self.log_export_all_requested.emit()
        )
        export_row.addWidget(self.export_all_logs_btn)
        export_row.addStretch()
        log_layout.addLayout(export_row)

        splitter.addWidget(log_widget)

        # Give the table more space than the log viewer
        splitter.setSizes([300, 200])

        layout.addWidget(splitter)

    def refresh(self, states: dict[str, LoopState], project_names: dict[str, str] | None = None):
        """Update the table with current loop states.

        Args:
            states: Mapping of project_id -> LoopState.
            project_names: Optional mapping of project_id -> display name.
                          If not provided, project IDs are shown.
        """
        if project_names is not None:
            self._project_names = project_names

        self.table.setRowCount(len(states))
        self._project_ids = []

        for row, (project_id, state) in enumerate(states.items()):
            self._project_ids.append(project_id)

            name = self._project_names.get(project_id, project_id)
            self.table.setItem(row, 0, QTableWidgetItem(name))
            self.table.setItem(row, 1, QTableWidgetItem(state.status.value))
            self.table.setItem(row, 2, QTableWidgetItem(state.mode.value))
            self.table.setItem(row, 3, QTableWidgetItem(str(state.iteration)))

            started = state.started_at or ""
            self.table.setItem(row, 4, QTableWidgetItem(started))

            # Action buttons
            actions_widget = QWidget()
            actions_layout = QHBoxLayout(actions_widget)
            actions_layout.setContentsMargins(2, 2, 2, 2)

            pid = project_id

            start_btn = QPushButton("Start")
            start_btn.setObjectName(f"start_btn_{project_id}")
            start_btn.clicked.connect(lambda checked, p=pid: self.loop_start_requested.emit(p))
            # Disable start if loop is already active
            if state.status in (LoopStatus.STARTING, LoopStatus.RUNNING, LoopStatus.PAUSED, LoopStatus.STOPPING):
                start_btn.setEnabled(False)
            actions_layout.addWidget(start_btn)

            stop_btn = QPushButton("Stop")
            stop_btn.setObjectName(f"stop_btn_{project_id}")
            stop_btn.clicked.connect(lambda checked, p=pid: self.loop_stop_requested.emit(p))
            # Disable stop if loop is not active
            if state.status not in (LoopStatus.STARTING, LoopStatus.RUNNING, LoopStatus.PAUSED):
                stop_btn.setEnabled(False)
            actions_layout.addWidget(stop_btn)

            self.table.setCellWidget(row, 5, actions_widget)

    def append_log(self, project_id: str, line: str):
        """Append a log line for the given project.

        If the project is currently selected in the table, the line is
        also appended to the log viewer immediately.

        Args:
            project_id: The project whose log buffer to append to.
            line: The log line text.
        """
        if project_id not in self._log_buffers:
            self._log_buffers[project_id] = []
        self._log_buffers[project_id].append(line)

        if project_id == self._selected_project_id:
            self.log_viewer.appendPlainText(line)

    def clear_log(self, project_id: str):
        """Clear the log buffer for a project.

        Args:
            project_id: The project whose log buffer to clear.
        """
        self._log_buffers.pop(project_id, None)
        if project_id == self._selected_project_id:
            self.log_viewer.clear()

    def get_selected_project_id(self) -> str | None:
        """Return the project ID of the currently selected row, or None."""
        rows = self.table.selectionModel().selectedRows()
        if rows and rows[0].row() < len(self._project_ids):
            return self._project_ids[rows[0].row()]
        return None

    def get_log_content(self, project_id: str) -> str:
        """Return the accumulated log content for a project as a single string."""
        lines = self._log_buffers.get(project_id, [])
        return "\n".join(lines)

    def get_all_log_contents(self) -> dict[str, str]:
        """Return all log buffers as {project_id: joined_text}."""
        return {pid: "\n".join(lines) for pid, lines in self._log_buffers.items()}

    def _on_export_log_clicked(self):
        """Emit export request for the currently selected project."""
        pid = self.get_selected_project_id()
        if pid:
            self.log_export_requested.emit(pid)

    def _on_selection_changed(self):
        """Update the log viewer when a different loop is selected."""
        project_id = self.get_selected_project_id()
        self._selected_project_id = project_id
        self.log_viewer.clear()
        self.export_log_btn.setEnabled(project_id is not None)

        if project_id and project_id in self._log_buffers:
            self.log_viewer.setPlainText("\n".join(self._log_buffers[project_id]))
            # Scroll to bottom
            scrollbar = self.log_viewer.verticalScrollBar()
            scrollbar.setValue(scrollbar.maximum())
