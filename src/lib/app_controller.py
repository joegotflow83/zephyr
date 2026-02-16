"""Application controller that wires UI signals to backend services.

The AppController is the central coordination layer between the Qt UI
components (MainWindow, tabs, dialogs) and the backend services
(ProjectStore, DockerManager, LoopRunner, CredentialManager, ConfigManager).
It connects signals from UI widgets to handler methods that invoke the
appropriate backend operations and then refresh the UI to reflect new state.
"""

import logging
import threading
from pathlib import Path

from PyQt6.QtCore import Qt
from PyQt6.QtWidgets import (
    QApplication,
    QDialog,
    QFileDialog,
    QMessageBox,
    QProgressDialog,
)

from src.lib._version import __version__
from src.lib.config_manager import ConfigManager
from src.lib.credential_manager import CredentialManager
from src.lib.disk_checker import DiskChecker
from src.lib.docker_health import DockerHealthMonitor
from src.lib.docker_manager import DockerManager
from src.lib.git_manager import GitManager
from src.lib.import_export import export_config, import_config
from src.lib.log_exporter import LogExporter
from src.lib.login_manager import LoginManager
from src.lib.loop_runner import LoopMode, LoopRunner
from src.lib.models import AppSettings
from src.lib.notifier import Notifier
from src.lib.project_store import ProjectStore
from src.lib.self_updater import SelfUpdater
from src.lib.terminal_bridge import TerminalBridge
from src.ui.credential_dialog import CredentialDialog
from src.ui.main_window import MainWindow
from src.ui.project_dialog import ProjectDialog

logger = logging.getLogger("zephyr.controller")


class AppController:
    """Wires UI signals to backend services and keeps the UI in sync.

    Args:
        main_window: The application's MainWindow instance.
        project_store: ProjectStore for CRUD operations on projects.
        docker_manager: DockerManager for Docker operations.
        loop_runner: LoopRunner for loop execution.
        credential_manager: CredentialManager for API key storage.
        config_manager: ConfigManager for config file I/O.
    """

    def __init__(
        self,
        main_window: MainWindow,
        project_store: ProjectStore,
        docker_manager: DockerManager,
        loop_runner: LoopRunner,
        credential_manager: CredentialManager,
        config_manager: ConfigManager,
        notifier: Notifier | None = None,
        docker_health_monitor: DockerHealthMonitor | None = None,
        disk_checker: DiskChecker | None = None,
        login_manager: LoginManager | None = None,
        self_updater: SelfUpdater | None = None,
        git_manager: GitManager | None = None,
        terminal_bridge: TerminalBridge | None = None,
    ) -> None:
        self._window = main_window
        self._project_store = project_store
        self._docker_manager = docker_manager
        self._loop_runner = loop_runner
        self._credential_manager = credential_manager
        self._config_manager = config_manager
        self._notifier = notifier
        self._docker_health_monitor = docker_health_monitor
        self._disk_checker = disk_checker
        self._login_manager = login_manager
        self._self_updater = self_updater
        self._git_manager = git_manager
        self._terminal_bridge = terminal_bridge

    def setup_connections(self) -> None:
        """Connect all UI signals to their handler methods."""
        projects_tab = self._window.projects_tab
        loops_tab = self._window.loops_tab
        settings_tab = self._window.settings_tab

        # Projects tab signals
        projects_tab.project_add_requested.connect(self.handle_add_project)
        projects_tab.project_edit_requested.connect(self.handle_edit_project)
        projects_tab.project_delete_requested.connect(self.handle_delete_project)
        projects_tab.project_run_requested.connect(self.handle_start_loop)

        # Loops tab signals
        loops_tab.loop_start_requested.connect(self.handle_start_loop)
        loops_tab.loop_stop_requested.connect(self.handle_stop_loop)
        loops_tab.log_export_requested.connect(self.handle_export_log)
        loops_tab.log_export_all_requested.connect(self.handle_export_all_logs)

        # Settings tab signals
        settings_tab.credential_update_requested.connect(self.handle_update_credential)
        settings_tab.settings_changed.connect(self.handle_settings_changed)
        settings_tab.check_updates_requested.connect(self.handle_check_updates)
        settings_tab.self_update_requested.connect(self.handle_trigger_update)

        # Menu bar actions
        self._window.import_action.triggered.connect(self.handle_import)
        self._window.export_action.triggered.connect(self.handle_export)
        self._window.about_action.triggered.connect(self.handle_about)

        # Loop lifecycle callbacks for notifications
        if self._notifier is not None:
            self._loop_runner.add_completion_callback(self._on_loop_completed)
            self._loop_runner.add_failure_callback(self._on_loop_failed)

        # Docker health monitor — live status updates
        if self._docker_health_monitor is not None:
            self._docker_health_monitor.docker_connected.connect(
                self._on_docker_connected
            )
            self._docker_health_monitor.docker_disconnected.connect(
                self._on_docker_disconnected
            )

        # Terminal tab signals
        terminal_tab = self._window.terminal_tab
        terminal_tab.terminal_requested.connect(self._handle_open_terminal)
        terminal_tab.session_close_requested.connect(self._handle_close_terminal)

        # Terminal bridge signals (bridge → UI)
        if self._terminal_bridge is not None:
            self._terminal_bridge.session_ready.connect(self._on_session_ready)
            self._terminal_bridge.session_ended.connect(self._on_session_ended)
            self._terminal_bridge.session_error.connect(self._on_session_error)

        # Lazy-refresh terminal tab when the user switches to it
        self._window.tab_widget.currentChanged.connect(self._on_tab_changed)

    def refresh_all(self) -> None:
        """Refresh all tabs from current backend state."""
        self._refresh_projects_tab()
        self._refresh_loops_tab()
        self._refresh_settings()
        self._refresh_docker_status()
        self._refresh_terminal_tab()

    # -- Project handlers ---------------------------------------------------

    def handle_add_project(self) -> None:
        """Open the Add Project dialog and persist the new project."""
        dialog = ProjectDialog(parent=self._window)
        if dialog.exec() == QDialog.DialogCode.Accepted:
            project = dialog.get_project()
            try:
                self._project_store.add_project(project)
                logger.info("Added project: %s (%s)", project.name, project.id)
                self._refresh_projects_tab()
            except ValueError as exc:
                QMessageBox.warning(self._window, "Add Project", str(exc))

    def handle_edit_project(self, project_id: str) -> None:
        """Open the Edit Project dialog and persist changes."""
        project = self._project_store.get_project(project_id)
        if project is None:
            QMessageBox.warning(
                self._window, "Edit Project", f"Project '{project_id}' not found."
            )
            return

        dialog = ProjectDialog(project=project, parent=self._window)
        if dialog.exec() == QDialog.DialogCode.Accepted:
            updated = dialog.get_project()
            try:
                self._project_store.update_project(updated)
                logger.info("Updated project: %s (%s)", updated.name, updated.id)
                self._refresh_projects_tab()
            except KeyError as exc:
                QMessageBox.warning(self._window, "Edit Project", str(exc))

    def handle_delete_project(self, project_id: str) -> None:
        """Confirm and delete a project."""
        project = self._project_store.get_project(project_id)
        name = project.name if project else project_id

        reply = QMessageBox.question(
            self._window,
            "Delete Project",
            f"Are you sure you want to delete '{name}'?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No,
        )
        if reply == QMessageBox.StandardButton.Yes:
            try:
                self._project_store.remove_project(project_id)
                logger.info("Deleted project: %s", project_id)
                self._refresh_projects_tab()
            except KeyError as exc:
                QMessageBox.warning(self._window, "Delete Project", str(exc))

    # -- Loop handlers ------------------------------------------------------

    def handle_start_loop(self, project_id: str) -> None:
        """Start a loop for the given project.

        Pre-start checks run in order:
        1. Git repository validation — warns if the project's repo_url
           points to an invalid or missing Git repository.
        2. Disk space check — warns if disk space is critically low.
        3. Docker image check — if the image is not found locally,
           offers to pull it from the registry.

        All checks are best-effort: exceptions are logged but never
        prevent the loop from starting.
        """
        try:
            # Pre-start git repo validation (best-effort)
            if self._git_manager is not None:
                try:
                    project = self._project_store.get_project(project_id)
                    if project is not None and project.repo_url:
                        repo_path = Path(project.repo_url)
                        if (
                            repo_path.is_absolute()
                            and not self._git_manager.validate_repo(repo_path)
                        ):
                            reply = QMessageBox.question(
                                self._window,
                                "Invalid Git Repository",
                                f"The project path does not appear to be a valid "
                                f"Git repository:\n\n{project.repo_url}\n\n"
                                f"Do you want to start the loop anyway?",
                                QMessageBox.StandardButton.Yes
                                | QMessageBox.StandardButton.No,
                                QMessageBox.StandardButton.No,
                            )
                            if reply != QMessageBox.StandardButton.Yes:
                                return
                except Exception:
                    logger.debug("Git repo validation failed", exc_info=True)

            # Pre-start disk space check (best-effort — failures do not block)
            if self._disk_checker is not None:
                try:
                    warning = self._disk_checker.warn_if_low()
                except Exception:
                    logger.debug("Disk space check failed", exc_info=True)
                    warning = None
                if warning is not None:
                    QMessageBox.warning(self._window, "Low Disk Space", warning)
                    return

            # Pre-start Docker image check (best-effort — failures do not block)
            if self._docker_manager.is_docker_available():
                try:
                    project = self._project_store.get_project(project_id)
                    if project is not None and not self._ensure_image_available(
                        project
                    ):
                        return
                except Exception:
                    logger.debug("Docker image check failed", exc_info=True)

            self._loop_runner.start_loop(project_id, LoopMode.CONTINUOUS)
            logger.info("Started loop for project: %s", project_id)
            self._refresh_loops_tab()
            self._refresh_terminal_tab()
        except (ValueError, RuntimeError) as exc:
            QMessageBox.warning(self._window, "Start Loop", str(exc))
        except Exception as exc:
            logger.error("Failed to start loop for project %s: %s", project_id, exc)
            QMessageBox.critical(
                self._window,
                "Start Loop Failed",
                f"Failed to start loop:\n{exc}",
            )
            self._refresh_loops_tab()
            self._refresh_terminal_tab()

    def handle_stop_loop(self, project_id: str) -> None:
        """Stop the running loop for the given project."""
        try:
            self._loop_runner.stop_loop(project_id)
            logger.info("Stopped loop for project: %s", project_id)
            self._refresh_loops_tab()
            self._refresh_terminal_tab()
        except ValueError as exc:
            QMessageBox.warning(self._window, "Stop Loop", str(exc))

    def _ensure_image_available(self, project) -> bool:
        """Check that the project's Docker image exists locally; offer to pull if not.

        Returns True if the image is available (or was successfully pulled),
        False if the user declined or the pull failed.
        """
        image = project.docker_image
        if not image:
            return True

        if self._docker_manager.is_image_available(image):
            return True

        reply = QMessageBox.question(
            self._window,
            "Docker Image Not Found",
            f"The Docker image '{image}' was not found locally.\n\n"
            f"Would you like to pull it from the registry?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.Yes,
        )
        if reply != QMessageBox.StandardButton.Yes:
            return False

        # Show indeterminate progress dialog while pulling
        progress = QProgressDialog(
            f"Pulling image '{image}'...", "Cancel", 0, 0, self._window
        )
        progress.setWindowTitle("Pulling Docker Image")
        progress.setWindowModality(Qt.WindowModality.WindowModal)
        progress.setMinimumDuration(0)
        progress.setValue(0)

        pull_error = [None]  # mutable container for thread result
        pull_done = threading.Event()

        def _pull():
            try:
                self._docker_manager.pull_image(image)
            except Exception as exc:
                pull_error[0] = exc
            finally:
                pull_done.set()

        thread = threading.Thread(target=_pull, daemon=True)
        thread.start()

        while not pull_done.is_set():
            if progress.wasCanceled():
                progress.close()
                return False
            QApplication.processEvents()
            pull_done.wait(timeout=0.1)

        progress.close()

        if pull_error[0] is not None:
            QMessageBox.critical(
                self._window,
                "Image Pull Failed",
                f"Failed to pull image '{image}':\n{pull_error[0]}",
            )
            return False

        return True

    # -- Credential handlers ------------------------------------------------

    def handle_update_credential(self, service: str) -> None:
        """Open the credential dialog and store the entered key.

        When the user selects login mode, launches a Playwright browser
        window for interactive authentication and stores the resulting
        session cookies via LoginManager.
        """
        dialog = CredentialDialog(service, parent=self._window)
        if dialog.exec() == QDialog.DialogCode.Accepted:
            key_text, use_login_mode = dialog.get_result()
            if use_login_mode:
                self._handle_login_mode(service)
                return
            if key_text:
                try:
                    self._credential_manager.store_api_key(service, key_text)
                    logger.info("Updated credential for: %s", service)
                except ValueError as exc:
                    QMessageBox.warning(self._window, "Credential Error", str(exc))

    def _handle_login_mode(self, service: str) -> None:
        """Launch browser-based login and store the session."""
        if self._login_manager is None:
            QMessageBox.warning(
                self._window,
                "Login Unavailable",
                "Browser-based login is not available.\n"
                "Please install Playwright to use this feature.",
            )
            return

        try:
            session_data = self._login_manager.launch_login(service)
        except Exception as exc:
            logger.error("Login failed for %s: %s", service, exc)
            QMessageBox.warning(
                self._window,
                "Login Failed",
                f"Browser login failed for {service}:\n{exc}",
            )
            return

        if session_data is None:
            QMessageBox.warning(
                self._window,
                "Login Timed Out",
                f"Login for {service} timed out or was cancelled.",
            )
            return

        try:
            self._login_manager.save_session(service, session_data)
            logger.info("Saved login session for: %s", service)
            QMessageBox.information(
                self._window,
                "Login Successful",
                f"Successfully authenticated with {service}.",
            )
        except Exception as exc:
            logger.error("Failed to save session for %s: %s", service, exc)
            QMessageBox.warning(
                self._window,
                "Credential Error",
                f"Failed to save session: {exc}",
            )

    # -- Settings handler ---------------------------------------------------

    def handle_settings_changed(self, settings: AppSettings) -> None:
        """Persist changed settings to the config file."""
        self._config_manager.save_json("settings.json", settings.to_dict())
        logger.info("Settings saved")

    # -- Import/Export handlers ---------------------------------------------

    def handle_import(self) -> None:
        """Open a file dialog, import from the selected zip archive."""
        zip_path, _ = QFileDialog.getOpenFileName(
            self._window,
            "Import Configuration",
            "",
            "Zip Archives (*.zip);;All Files (*)",
        )
        if not zip_path:
            return

        try:
            summary = import_config(self._config_manager, Path(zip_path))
            QMessageBox.information(
                self._window,
                "Import Successful",
                f"Imported {len(summary['files'])} files, "
                f"{summary['projects_count']} projects.",
            )
            self.refresh_all()
        except FileExistsError as exc:
            QMessageBox.warning(self._window, "Import Conflict", str(exc))
        except Exception as exc:
            QMessageBox.critical(
                self._window, "Import Error", f"Failed to import: {exc}"
            )

    def handle_export(self) -> None:
        """Open a file dialog and export configuration to the selected path."""
        output_path, _ = QFileDialog.getSaveFileName(
            self._window,
            "Export Configuration",
            "zephyr-config.zip",
            "Zip Archives (*.zip);;All Files (*)",
        )
        if not output_path:
            return

        try:
            result_path = export_config(self._config_manager, Path(output_path))
            QMessageBox.information(
                self._window,
                "Export Successful",
                f"Configuration exported to:\n{result_path}",
            )
        except Exception as exc:
            QMessageBox.critical(
                self._window, "Export Error", f"Failed to export: {exc}"
            )

    # -- Log export handlers ------------------------------------------------

    def handle_export_log(self, project_id: str) -> None:
        """Export the log for a single loop to a user-chosen directory."""
        log_content = self._window.loops_tab.get_log_content(project_id)
        if not log_content:
            QMessageBox.information(
                self._window,
                "No Log Data",
                "There is no log content for the selected loop.",
            )
            return

        output_dir = QFileDialog.getExistingDirectory(
            self._window,
            "Export Log — Choose Directory",
            str(Path.home()),
        )
        if not output_dir:
            return

        try:
            result_path = LogExporter.export_loop_log(
                project_id, log_content, Path(output_dir)
            )
            QMessageBox.information(
                self._window,
                "Export Successful",
                f"Log exported to:\n{result_path}",
            )
            logger.info("Exported log for %s to %s", project_id, result_path)
        except Exception as exc:
            logger.error("Failed to export log: %s", exc)
            QMessageBox.critical(
                self._window,
                "Export Error",
                f"Failed to export log: {exc}",
            )

    def handle_export_all_logs(self) -> None:
        """Export all loop logs as a zip archive to a user-chosen directory."""
        log_contents = self._window.loops_tab.get_all_log_contents()
        states = self._loop_runner.get_all_states()

        if not log_contents and not states:
            QMessageBox.information(
                self._window,
                "No Log Data",
                "There are no loop logs to export.",
            )
            return

        output_dir = QFileDialog.getExistingDirectory(
            self._window,
            "Export All Logs — Choose Directory",
            str(Path.home()),
        )
        if not output_dir:
            return

        try:
            result_path = LogExporter.export_all_logs(
                states, log_contents, Path(output_dir)
            )
            QMessageBox.information(
                self._window,
                "Export Successful",
                f"Logs exported to:\n{result_path}",
            )
            logger.info("Exported all logs to %s", result_path)
        except Exception as exc:
            logger.error("Failed to export logs: %s", exc)
            QMessageBox.critical(
                self._window,
                "Export Error",
                f"Failed to export logs: {exc}",
            )

    # -- About handler ------------------------------------------------------

    def handle_about(self) -> None:
        """Show the About dialog."""
        QMessageBox.about(
            self._window,
            "About Zephyr Desktop",
            f"Zephyr Desktop v{__version__}\n\n"
            "A desktop application for managing and running\n"
            "Ralph coding loops in Docker containers.",
        )

    # -- Self-update handlers --------------------------------------------------

    def handle_check_updates(self) -> None:
        """Check for upstream updates and update the UI status."""
        if self._self_updater is None:
            QMessageBox.warning(
                self._window,
                "Update Unavailable",
                "Self-update is not available.\n"
                "GitManager or SelfUpdater could not be initialized.",
            )
            return

        try:
            app_repo_path = self._resolve_app_repo_path()
            has_updates = self._self_updater.check_for_updates(app_repo_path)
            self._window.settings_tab.set_update_status(has_updates)
            if has_updates:
                logger.info("Updates available for Zephyr Desktop")
            else:
                logger.info("Zephyr Desktop is up to date")
        except Exception as exc:
            logger.error("Failed to check for updates: %s", exc)
            QMessageBox.warning(
                self._window,
                "Update Check Failed",
                f"Failed to check for updates:\n{exc}",
            )

    def handle_trigger_update(self) -> None:
        """Trigger a self-update Ralph loop on the app's own repository."""
        if self._self_updater is None:
            QMessageBox.warning(
                self._window,
                "Update Unavailable",
                "Self-update is not available.",
            )
            return

        reply = QMessageBox.question(
            self._window,
            "Self-Update",
            "This will start a Ralph loop to update Zephyr Desktop.\n\n"
            "Do you want to proceed?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No,
        )
        if reply != QMessageBox.StandardButton.Yes:
            return

        try:
            app_repo_path = self._resolve_app_repo_path()
            self._self_updater.trigger_self_update(app_repo_path)
            logger.info("Self-update loop started")
            self._refresh_loops_tab()
            QMessageBox.information(
                self._window,
                "Self-Update Started",
                "A self-update loop has been started.\n"
                "Check the Running Loops tab for progress.",
            )
        except (ValueError, RuntimeError) as exc:
            logger.error("Failed to start self-update: %s", exc)
            QMessageBox.warning(
                self._window,
                "Self-Update Failed",
                f"Failed to start self-update:\n{exc}",
            )

    def _resolve_app_repo_path(self) -> Path:
        """Determine the path to the Zephyr app's own git repository.

        Uses the location of the src package as a starting point
        and walks up to find the git root.
        """
        import src

        src_path = Path(src.__file__).resolve().parent
        # Walk up to find .git directory
        candidate = src_path.parent
        while candidate != candidate.parent:
            if (candidate / ".git").exists():
                return candidate
            candidate = candidate.parent
        # Fallback: assume src's parent is the repo root
        return src_path.parent

    # -- Loop lifecycle notification handlers --------------------------------

    def _on_loop_completed(self, project_id: str, iterations: int) -> None:
        """Notify the user when a loop completes successfully."""
        project = self._project_store.get_project(project_id)
        name = project.name if project else project_id
        if self._notifier is not None:
            self._notifier.notify_loop_complete(name, iterations)

    def _on_loop_failed(self, project_id: str, error: str) -> None:
        """Notify the user when a loop fails."""
        project = self._project_store.get_project(project_id)
        name = project.name if project else project_id
        if self._notifier is not None:
            self._notifier.notify_loop_failed(name, error)

    # -- Docker health monitor handlers -------------------------------------

    def _on_docker_connected(self) -> None:
        """Update UI when Docker daemon becomes available."""
        logger.info("Docker daemon connected — updating UI status")
        self._window.set_docker_status(True)
        self._window.settings_tab.set_docker_status(True)
        self._refresh_terminal_tab()

    def _on_docker_disconnected(self) -> None:
        """Update UI when Docker daemon becomes unavailable."""
        logger.warning("Docker daemon disconnected — updating UI status")
        self._window.set_docker_status(False)
        self._window.settings_tab.set_docker_status(False)
        self._refresh_terminal_tab()

    def shutdown(self) -> None:
        """Stop background services managed by the controller."""
        if self._terminal_bridge is not None:
            self._terminal_bridge.stop()
        if self._docker_health_monitor is not None:
            self._docker_health_monitor.stop()

    # -- Tab change handler -------------------------------------------------

    def _on_tab_changed(self, index: int) -> None:
        """Refresh the terminal tab's container list when it becomes active."""
        widget = self._window.tab_widget.widget(index)
        if widget is self._window.terminal_tab:
            self._refresh_terminal_tab()

    # -- Internal refresh helpers -------------------------------------------

    def _refresh_projects_tab(self) -> None:
        """Reload the projects table from the project store."""
        projects = self._project_store.list_projects()

        # Build status map from loop runner states
        all_states = self._loop_runner.get_all_states()
        statuses = {}
        for pid, state in all_states.items():
            statuses[pid] = state.status.value.capitalize()

        self._window.projects_tab.refresh(projects, statuses)

    def _refresh_loops_tab(self) -> None:
        """Reload the loops table from the loop runner."""
        states = self._loop_runner.get_all_states()

        # Build project name map for display
        project_names = {}
        for pid in states:
            project = self._project_store.get_project(pid)
            if project:
                project_names[pid] = project.name
            else:
                project_names[pid] = pid

        self._window.loops_tab.refresh(states, project_names)

    def _refresh_settings(self) -> None:
        """Reload settings from config and populate the settings tab."""
        data = self._config_manager.load_json("settings.json")
        settings = AppSettings.from_dict(data) if data else AppSettings()
        self._window.settings_tab.load_settings(settings)

    def _refresh_docker_status(self) -> None:
        """Check Docker availability and update status indicators."""
        connected = self._docker_manager.is_docker_available()
        self._window.set_docker_status(connected)
        self._window.settings_tab.set_docker_status(connected)

    def _refresh_terminal_tab(self) -> None:
        """Reload the terminal tab's container dropdown from running containers."""
        try:
            containers = self._docker_manager.list_running_containers()
        except Exception:  # pylint: disable=broad-except
            logger.debug("Failed to list running containers for terminal tab", exc_info=True)
            containers = []
        self._window.terminal_tab.refresh(containers)

    # -- Terminal handlers --------------------------------------------------

    def _handle_open_terminal(self, container_id: str, project_name: str) -> None:
        """Request a new terminal session via the terminal bridge."""
        if self._terminal_bridge is None:
            logger.warning("Terminal bridge is not available; cannot open terminal session.")
            return
        self._terminal_bridge.open_session(container_id, project_name)

    def _handle_close_terminal(self, session_id: str) -> None:
        """Close an existing terminal session via the terminal bridge."""
        if self._terminal_bridge is None:
            return
        self._terminal_bridge.close_session(session_id)

    def _on_session_ready(self, session_id: str, port: int, user: str) -> None:
        """Add a new terminal session tab when the bridge reports it's ready."""
        self._window.terminal_tab.add_session(session_id, user, port)

    def _on_session_ended(self, session_id: str) -> None:
        """Remove a terminal session tab when the bridge reports it has ended."""
        self._window.terminal_tab.close_session(session_id)

    def _on_session_error(self, session_id: str, error_message: str) -> None:
        """Show an error dialog when a terminal session fails to open."""
        logger.error("Terminal session error: %s", error_message)
        QMessageBox.warning(
            self._window,
            "Terminal Error",
            f"Failed to open terminal session:\n\n{error_message}",
        )
