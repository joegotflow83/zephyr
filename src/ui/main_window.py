"""Main window for Zephyr Desktop with tab structure, menu bar, and status bar."""

import logging

from PyQt6.QtGui import QAction, QCloseEvent
from PyQt6.QtWidgets import (
    QLabel,
    QMainWindow,
    QProgressDialog,
    QTabWidget,
)

from src.ui.loops_tab import LoopsTab
from src.ui.projects_tab import ProjectsTab
from src.ui.settings_tab import SettingsTab

logger = logging.getLogger("zephyr.ui")


class MainWindow(QMainWindow):
    """Main application window for Zephyr Desktop.

    Provides a tabbed interface with Projects, Running Loops, and Settings tabs,
    a menu bar with File and Help menus, and a status bar showing Docker status.
    """

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Zephyr Desktop")
        self.setMinimumSize(900, 600)

        self._cleanup_manager = None
        self._docker_manager = None

        self._setup_tabs()
        self._setup_menu_bar()
        self._setup_status_bar()

    def _setup_tabs(self):
        """Create the central tab widget with three tabs."""
        self.tab_widget = QTabWidget()
        self.setCentralWidget(self.tab_widget)

        self.projects_tab = ProjectsTab()
        self.loops_tab = LoopsTab()
        self.settings_tab = SettingsTab()

        self.tab_widget.addTab(self.projects_tab, "Projects")
        self.tab_widget.addTab(self.loops_tab, "Running Loops")
        self.tab_widget.addTab(self.settings_tab, "Settings")

    def _setup_menu_bar(self):
        """Create File and Help menus."""
        menu_bar = self.menuBar()

        # File menu
        file_menu = menu_bar.addMenu("&File")

        self.import_action = QAction("&Import...", self)
        self.import_action.setShortcut("Ctrl+I")
        file_menu.addAction(self.import_action)

        self.export_action = QAction("&Export...", self)
        self.export_action.setShortcut("Ctrl+E")
        file_menu.addAction(self.export_action)

        file_menu.addSeparator()

        self.quit_action = QAction("&Quit", self)
        self.quit_action.setShortcut("Ctrl+Q")
        self.quit_action.triggered.connect(self.close)
        file_menu.addAction(self.quit_action)

        # Help menu
        help_menu = menu_bar.addMenu("&Help")

        self.about_action = QAction("&About", self)
        help_menu.addAction(self.about_action)

    def _setup_status_bar(self):
        """Create the status bar with Docker connection indicator."""
        status_bar = self.statusBar()

        self.docker_status_label = QLabel("Docker: Checking...")
        self.docker_status_label.setObjectName("docker_status_label")
        status_bar.addPermanentWidget(self.docker_status_label)

    def set_docker_status(self, connected: bool):
        """Update the Docker connection status display.

        Args:
            connected: True if Docker daemon is reachable, False otherwise.
        """
        if connected:
            self.docker_status_label.setText("Docker: Connected")
        else:
            self.docker_status_label.setText("Docker: Disconnected")

    # -- Cleanup integration -------------------------------------------------

    def set_cleanup_manager(self, cleanup_manager, docker_manager) -> None:
        """Register the cleanup manager and docker manager for shutdown use.

        Args:
            cleanup_manager: A ``CleanupManager`` instance.
            docker_manager: A ``DockerManager`` instance.
        """
        self._cleanup_manager = cleanup_manager
        self._docker_manager = docker_manager

    def closeEvent(self, event: QCloseEvent) -> None:  # noqa: N802
        """Handle window close by cleaning up active containers first."""
        if (
            self._cleanup_manager is not None
            and self._docker_manager is not None
            and self._cleanup_manager.has_active_containers
        ):
            containers = self._cleanup_manager.tracked_containers
            logger.info("Window closing — cleaning up %d container(s)", len(containers))

            progress = QProgressDialog("Stopping containers...", None, 0, 0, self)
            progress.setWindowTitle("Shutting Down")
            progress.setCancelButton(None)
            progress.setMinimumDuration(0)
            progress.show()

            # Process events so the dialog is visible before blocking cleanup
            from PyQt6.QtWidgets import QApplication

            QApplication.processEvents()

            self._cleanup_manager.cleanup_all(self._docker_manager)
            progress.close()

        super().closeEvent(event)
