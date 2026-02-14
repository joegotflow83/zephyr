"""Projects tab UI for Zephyr Desktop.

Displays a table of projects with action buttons and emits signals
for project management operations (add, edit, delete, run).
"""

from PyQt6.QtCore import pyqtSignal
from PyQt6.QtWidgets import (
    QHBoxLayout,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from src.lib.models import ProjectConfig


class ProjectsTab(QWidget):
    """Tab widget showing a table of projects with management actions.

    Signals:
        project_add_requested: Emitted when the Add Project button is clicked.
        project_edit_requested: Emitted with project_id when Edit is clicked.
        project_delete_requested: Emitted with project_id when Delete is clicked.
        project_run_requested: Emitted with project_id when Run is clicked.
    """

    project_add_requested = pyqtSignal()
    project_edit_requested = pyqtSignal(str)
    project_delete_requested = pyqtSignal(str)
    project_run_requested = pyqtSignal(str)

    COLUMNS = ["Name", "Repo URL", "Docker Image", "Status", "Actions"]

    def __init__(self, parent=None):
        super().__init__(parent)
        self._project_ids: list[str] = []
        self._setup_ui()

    def _setup_ui(self):
        layout = QVBoxLayout(self)

        # Add Project button
        self.add_button = QPushButton("Add Project")
        self.add_button.setObjectName("add_project_button")
        self.add_button.clicked.connect(self.project_add_requested.emit)
        layout.addWidget(self.add_button)

        # Projects table
        self.table = QTableWidget()
        self.table.setObjectName("projects_table")
        self.table.setColumnCount(len(self.COLUMNS))
        self.table.setHorizontalHeaderLabels(self.COLUMNS)
        self.table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        self.table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        self.table.horizontalHeader().setStretchLastSection(True)
        layout.addWidget(self.table)

    def refresh(
        self, projects: list[ProjectConfig], statuses: dict[str, str] | None = None
    ):
        """Populate the table with the given projects.

        Args:
            projects: List of ProjectConfig objects to display.
            statuses: Optional mapping of project_id -> status string.
                      If not provided, all projects show "Idle".
        """
        if statuses is None:
            statuses = {}

        self.table.setRowCount(len(projects))
        self._project_ids = []

        for row, project in enumerate(projects):
            self._project_ids.append(project.id)

            self.table.setItem(row, 0, QTableWidgetItem(project.name))
            self.table.setItem(row, 1, QTableWidgetItem(project.repo_url))
            self.table.setItem(row, 2, QTableWidgetItem(project.docker_image))
            self.table.setItem(
                row, 3, QTableWidgetItem(statuses.get(project.id, "Idle"))
            )

            # Action buttons
            actions_widget = QWidget()
            actions_layout = QHBoxLayout(actions_widget)
            actions_layout.setContentsMargins(2, 2, 2, 2)

            edit_btn = QPushButton("Edit")
            edit_btn.setObjectName(f"edit_btn_{project.id}")
            pid = project.id
            edit_btn.clicked.connect(
                lambda checked, p=pid: self.project_edit_requested.emit(p)
            )
            actions_layout.addWidget(edit_btn)

            delete_btn = QPushButton("Delete")
            delete_btn.setObjectName(f"delete_btn_{project.id}")
            delete_btn.clicked.connect(
                lambda checked, p=pid: self.project_delete_requested.emit(p)
            )
            actions_layout.addWidget(delete_btn)

            run_btn = QPushButton("Run")
            run_btn.setObjectName(f"run_btn_{project.id}")
            run_btn.clicked.connect(
                lambda checked, p=pid: self.project_run_requested.emit(p)
            )
            actions_layout.addWidget(run_btn)

            self.table.setCellWidget(row, 4, actions_widget)

    def get_selected_project_id(self) -> str | None:
        """Return the project ID of the currently selected row, or None."""
        rows = self.table.selectionModel().selectedRows()
        if rows and rows[0].row() < len(self._project_ids):
            return self._project_ids[rows[0].row()]
        return None
