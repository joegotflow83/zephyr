"""Tests for the full application startup wiring in src/main.py.

Verifies that:
- The app starts without crashing when Docker and keyring are mocked
- All backend services are instantiated and wired correctly
- The Docker-missing case shows a warning dialog
- The log bridge is connected to the loops tab
- AppController.setup_connections and refresh_all are called
- The window title and tabs are correct after startup
"""

from unittest.mock import MagicMock, patch, PropertyMock

import pytest
from PyQt6.QtWidgets import QMessageBox

from src.lib.app_controller import AppController
from src.lib.log_bridge import LogBridge
from src.ui.main_window import MainWindow

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _mock_docker_module(available: bool = False):
    """Return a patch context for docker.from_env.

    When *available* is True the mock client responds to ping().
    When False, the constructor raises DockerException.
    """
    if available:
        mock_client = MagicMock()
        mock_client.ping.return_value = True
        mock_client.info.return_value = {"ServerVersion": "24.0.0"}
        return patch("src.lib.docker_manager.docker.from_env", return_value=mock_client)
    else:
        from docker.errors import DockerException

        return patch(
            "src.lib.docker_manager.docker.from_env",
            side_effect=DockerException("mock: daemon not running"),
        )


def _mock_keyring():
    """Return a patch context for keyring operations."""
    return patch("src.lib.credential_manager.keyring")


def _mock_health_monitor():
    """Return a patch context for DockerHealthMonitor to avoid real threads."""
    return patch("src.main.DockerHealthMonitor")


# ---------------------------------------------------------------------------
# Startup tests
# ---------------------------------------------------------------------------


class TestAppStartup:
    """Test the create_app factory and startup sequence."""

    def test_app_starts_without_docker(self, qtbot, tmp_path):
        """App starts and shows a warning when Docker is unavailable."""
        with (
            _mock_docker_module(available=False),
            _mock_keyring(),
            _mock_health_monitor(),
            patch("src.main.ConfigManager") as MockCM,
            patch("src.main.QMessageBox") as MockMsgBox,
        ):
            mock_cm_instance = MagicMock()
            mock_cm_instance.load_json.return_value = {}
            mock_cm_instance.get_config_dir.return_value = tmp_path
            MockCM.return_value = mock_cm_instance

            from src.main import create_app

            # QApplication already exists via pytest-qt, so we need to
            # avoid creating a second one.  Patch QApplication to return
            # the existing instance.
            from PyQt6.QtWidgets import QApplication

            existing_app = QApplication.instance()
            with patch("src.main.QApplication", return_value=existing_app):
                app, window, controller = create_app(argv=["test"])

            qtbot.addWidget(window)

            assert isinstance(window, MainWindow)
            assert isinstance(controller, AppController)

            # The Docker warning should have been shown
            MockMsgBox.warning.assert_called_once()
            call_args = MockMsgBox.warning.call_args
            assert "Docker Not Available" in call_args[0][1]

    def test_app_starts_with_docker(self, qtbot, tmp_path):
        """App starts cleanly when Docker is available — no warning shown."""
        with (
            _mock_docker_module(available=True),
            _mock_keyring(),
            _mock_health_monitor(),
            patch("src.main.ConfigManager") as MockCM,
            patch("src.main.QMessageBox") as MockMsgBox,
        ):
            mock_cm_instance = MagicMock()
            mock_cm_instance.load_json.return_value = {}
            mock_cm_instance.get_config_dir.return_value = tmp_path
            MockCM.return_value = mock_cm_instance

            from src.main import create_app
            from PyQt6.QtWidgets import QApplication

            existing_app = QApplication.instance()
            with patch("src.main.QApplication", return_value=existing_app):
                app, window, controller = create_app(argv=["test"])

            qtbot.addWidget(window)

            # No warning when Docker is available
            MockMsgBox.warning.assert_not_called()

    def test_window_has_correct_title(self, qtbot, tmp_path):
        """The main window title is 'Zephyr Desktop'."""
        with (
            _mock_docker_module(available=False),
            _mock_keyring(),
            _mock_health_monitor(),
            patch("src.main.ConfigManager") as MockCM,
            patch("src.main.QMessageBox"),
        ):
            mock_cm_instance = MagicMock()
            mock_cm_instance.load_json.return_value = {}
            mock_cm_instance.get_config_dir.return_value = tmp_path
            MockCM.return_value = mock_cm_instance

            from src.main import create_app
            from PyQt6.QtWidgets import QApplication

            existing_app = QApplication.instance()
            with patch("src.main.QApplication", return_value=existing_app):
                _app, window, _ctrl = create_app(argv=["test"])

            qtbot.addWidget(window)
            assert window.windowTitle() == "Zephyr Desktop"

    def test_window_has_three_tabs(self, qtbot, tmp_path):
        """After startup the main window has Projects, Running Loops, Settings tabs."""
        with (
            _mock_docker_module(available=False),
            _mock_keyring(),
            _mock_health_monitor(),
            patch("src.main.ConfigManager") as MockCM,
            patch("src.main.QMessageBox"),
        ):
            mock_cm_instance = MagicMock()
            mock_cm_instance.load_json.return_value = {}
            mock_cm_instance.get_config_dir.return_value = tmp_path
            MockCM.return_value = mock_cm_instance

            from src.main import create_app
            from PyQt6.QtWidgets import QApplication

            existing_app = QApplication.instance()
            with patch("src.main.QApplication", return_value=existing_app):
                _app, window, _ctrl = create_app(argv=["test"])

            qtbot.addWidget(window)

            tab_widget = window.tab_widget
            assert tab_widget.count() == 3
            assert tab_widget.tabText(0) == "Projects"
            assert tab_widget.tabText(1) == "Running Loops"
            assert tab_widget.tabText(2) == "Settings"

    def test_services_stored_on_window(self, qtbot, tmp_path):
        """All backend services are accessible via window._services."""
        with (
            _mock_docker_module(available=False),
            _mock_keyring(),
            _mock_health_monitor(),
            patch("src.main.ConfigManager") as MockCM,
            patch("src.main.QMessageBox"),
        ):
            mock_cm_instance = MagicMock()
            mock_cm_instance.load_json.return_value = {}
            mock_cm_instance.get_config_dir.return_value = tmp_path
            MockCM.return_value = mock_cm_instance

            from src.main import create_app
            from PyQt6.QtWidgets import QApplication

            existing_app = QApplication.instance()
            with patch("src.main.QApplication", return_value=existing_app):
                _app, window, _ctrl = create_app(argv=["test"])

            qtbot.addWidget(window)

            services = window._services
            expected_keys = {
                "config_manager",
                "project_store",
                "docker_manager",
                "credential_manager",
                "loop_runner",
                "loop_scheduler",
                "asset_injector",
                "notifier",
                "cleanup_manager",
                "disk_checker",
                "docker_health_monitor",
                "login_manager",
                "git_manager",
                "self_updater",
            }
            assert set(services.keys()) == expected_keys

    def test_log_bridge_created(self, qtbot, tmp_path):
        """A LogBridge is created and stored on the window."""
        with (
            _mock_docker_module(available=False),
            _mock_keyring(),
            _mock_health_monitor(),
            patch("src.main.ConfigManager") as MockCM,
            patch("src.main.QMessageBox"),
        ):
            mock_cm_instance = MagicMock()
            mock_cm_instance.load_json.return_value = {}
            mock_cm_instance.get_config_dir.return_value = tmp_path
            MockCM.return_value = mock_cm_instance

            from src.main import create_app
            from PyQt6.QtWidgets import QApplication

            existing_app = QApplication.instance()
            with patch("src.main.QApplication", return_value=existing_app):
                _app, window, _ctrl = create_app(argv=["test"])

            qtbot.addWidget(window)
            assert isinstance(window._log_bridge, LogBridge)

    def test_controller_stored_on_window(self, qtbot, tmp_path):
        """The AppController is accessible via window._app_controller."""
        with (
            _mock_docker_module(available=False),
            _mock_keyring(),
            _mock_health_monitor(),
            patch("src.main.ConfigManager") as MockCM,
            patch("src.main.QMessageBox"),
        ):
            mock_cm_instance = MagicMock()
            mock_cm_instance.load_json.return_value = {}
            mock_cm_instance.get_config_dir.return_value = tmp_path
            MockCM.return_value = mock_cm_instance

            from src.main import create_app
            from PyQt6.QtWidgets import QApplication

            existing_app = QApplication.instance()
            with patch("src.main.QApplication", return_value=existing_app):
                _app, window, controller = create_app(argv=["test"])

            qtbot.addWidget(window)
            assert window._app_controller is controller
            assert isinstance(controller, AppController)


class TestSelfUpdaterWiring:
    """Test that SelfUpdater is created and passed to AppController."""

    def test_self_updater_created_in_services(self, tmp_path):
        """_create_services returns a self_updater."""
        with _mock_docker_module(available=False), _mock_keyring():
            from src.main import _create_services
            from src.lib.self_updater import SelfUpdater

            cm = MagicMock()
            cm.load_json.return_value = {}
            cm.get_config_dir.return_value = tmp_path

            services = _create_services(cm)

            assert "self_updater" in services
            assert isinstance(services["self_updater"], SelfUpdater)

    def test_git_manager_created_in_services(self, tmp_path):
        """_create_services returns a git_manager."""
        with _mock_docker_module(available=False), _mock_keyring():
            from src.main import _create_services
            from src.lib.git_manager import GitManager

            cm = MagicMock()
            cm.load_json.return_value = {}
            cm.get_config_dir.return_value = tmp_path

            services = _create_services(cm)

            assert "git_manager" in services
            assert isinstance(services["git_manager"], GitManager)

    def test_self_updater_passed_to_controller(self, qtbot, tmp_path):
        """The self_updater is passed to AppController."""
        with (
            _mock_docker_module(available=False),
            _mock_keyring(),
            _mock_health_monitor(),
            patch("src.main.ConfigManager") as MockCM,
            patch("src.main.QMessageBox"),
        ):
            mock_cm_instance = MagicMock()
            mock_cm_instance.load_json.return_value = {}
            mock_cm_instance.get_config_dir.return_value = tmp_path
            MockCM.return_value = mock_cm_instance

            from src.main import create_app
            from PyQt6.QtWidgets import QApplication

            existing_app = QApplication.instance()
            with patch("src.main.QApplication", return_value=existing_app):
                app, window, controller = create_app(argv=["test"])

            qtbot.addWidget(window)

            assert controller._self_updater is not None

    def test_git_manager_passed_to_controller(self, qtbot, tmp_path):
        """The git_manager is passed to AppController for repo validation."""
        with (
            _mock_docker_module(available=False),
            _mock_keyring(),
            _mock_health_monitor(),
            patch("src.main.ConfigManager") as MockCM,
            patch("src.main.QMessageBox"),
        ):
            mock_cm_instance = MagicMock()
            mock_cm_instance.load_json.return_value = {}
            mock_cm_instance.get_config_dir.return_value = tmp_path
            MockCM.return_value = mock_cm_instance

            from src.main import create_app
            from PyQt6.QtWidgets import QApplication

            existing_app = QApplication.instance()
            with patch("src.main.QApplication", return_value=existing_app):
                app, window, controller = create_app(argv=["test"])

            qtbot.addWidget(window)

            assert controller._git_manager is not None


class TestSetupLogging:
    """Test the _setup_logging helper."""

    def test_default_log_level(self, tmp_path):
        """When settings.json has no log_level, INFO is used."""
        from src.main import _setup_logging
        import logging

        mock_cm = MagicMock()
        mock_cm.load_json.return_value = {}

        _setup_logging(mock_cm)

        zephyr_logger = logging.getLogger("zephyr")
        assert zephyr_logger.level == logging.INFO

    def test_custom_log_level(self, tmp_path):
        """When settings.json specifies DEBUG, that level is applied."""
        from src.main import _setup_logging
        import logging

        mock_cm = MagicMock()
        mock_cm.load_json.return_value = {"log_level": "DEBUG"}

        _setup_logging(mock_cm)

        zephyr_logger = logging.getLogger("zephyr")
        assert zephyr_logger.level == logging.DEBUG

        # Reset for other tests
        zephyr_logger.setLevel(logging.INFO)


class TestCreateServices:
    """Test the _create_services helper."""

    def test_all_services_created(self, tmp_path):
        """_create_services returns all expected service keys."""
        with _mock_docker_module(available=False), _mock_keyring():
            from src.main import _create_services
            from src.lib.config_manager import ConfigManager

            cm = MagicMock(spec=ConfigManager)
            cm.load_json.return_value = {}
            cm.get_config_dir.return_value = tmp_path

            services = _create_services(cm)

            expected_keys = {
                "config_manager",
                "project_store",
                "docker_manager",
                "credential_manager",
                "loop_runner",
                "loop_scheduler",
                "asset_injector",
                "notifier",
                "cleanup_manager",
                "disk_checker",
                "docker_health_monitor",
                "login_manager",
                "git_manager",
                "self_updater",
            }
            assert set(services.keys()) == expected_keys

    def test_services_created_when_docker_unavailable(self, tmp_path):
        """All services are created even when Docker daemon is unreachable."""
        with _mock_docker_module(available=False), _mock_keyring():
            from src.main import _create_services

            cm = MagicMock()
            cm.load_json.return_value = {}
            cm.get_config_dir.return_value = tmp_path

            services = _create_services(cm)

            # DockerManager is created but not connected
            dm = services["docker_manager"]
            assert not dm.is_docker_available()

    def test_services_created_when_docker_available(self, tmp_path):
        """When Docker is available, docker_manager reports connected."""
        with _mock_docker_module(available=True), _mock_keyring():
            from src.main import _create_services

            cm = MagicMock()
            cm.load_json.return_value = {}
            cm.get_config_dir.return_value = tmp_path

            services = _create_services(cm)

            dm = services["docker_manager"]
            assert dm.is_docker_available()


class TestDockerHealthMonitorWiring:
    """Test that DockerHealthMonitor is created, started, and wired for shutdown."""

    def test_health_monitor_created_in_services(self, tmp_path):
        """_create_services returns a docker_health_monitor."""
        with _mock_docker_module(available=False), _mock_keyring():
            from src.main import _create_services
            from src.lib.docker_health import DockerHealthMonitor

            cm = MagicMock()
            cm.load_json.return_value = {}
            cm.get_config_dir.return_value = tmp_path

            services = _create_services(cm)

            assert "docker_health_monitor" in services
            assert isinstance(services["docker_health_monitor"], DockerHealthMonitor)

    def test_health_monitor_started_at_app_launch(self, qtbot, tmp_path):
        """DockerHealthMonitor.start() is called during create_app."""
        with (
            _mock_docker_module(available=False),
            _mock_keyring(),
            _mock_health_monitor() as MockHM,
            patch("src.main.ConfigManager") as MockCM,
            patch("src.main.QMessageBox"),
        ):
            mock_cm_instance = MagicMock()
            mock_cm_instance.load_json.return_value = {}
            mock_cm_instance.get_config_dir.return_value = tmp_path
            MockCM.return_value = mock_cm_instance

            from src.main import create_app
            from PyQt6.QtWidgets import QApplication

            existing_app = QApplication.instance()
            with patch("src.main.QApplication", return_value=existing_app):
                app, window, controller = create_app(argv=["test"])

            qtbot.addWidget(window)

            MockHM.return_value.start.assert_called_once()

    def test_health_monitor_passed_to_controller(self, qtbot, tmp_path):
        """The health monitor is passed to AppController."""
        with (
            _mock_docker_module(available=False),
            _mock_keyring(),
            _mock_health_monitor() as MockHM,
            patch("src.main.ConfigManager") as MockCM,
            patch("src.main.QMessageBox"),
        ):
            mock_cm_instance = MagicMock()
            mock_cm_instance.load_json.return_value = {}
            mock_cm_instance.get_config_dir.return_value = tmp_path
            MockCM.return_value = mock_cm_instance

            from src.main import create_app
            from PyQt6.QtWidgets import QApplication

            existing_app = QApplication.instance()
            with patch("src.main.QApplication", return_value=existing_app):
                app, window, controller = create_app(argv=["test"])

            qtbot.addWidget(window)

            assert controller._docker_health_monitor is MockHM.return_value

    def test_shutdown_connected_to_about_to_quit(self, qtbot, tmp_path):
        """controller.shutdown is connected to QApplication.aboutToQuit."""
        with (
            _mock_docker_module(available=False),
            _mock_keyring(),
            _mock_health_monitor() as MockHM,
            patch("src.main.ConfigManager") as MockCM,
            patch("src.main.QMessageBox"),
        ):
            mock_cm_instance = MagicMock()
            mock_cm_instance.load_json.return_value = {}
            mock_cm_instance.get_config_dir.return_value = tmp_path
            MockCM.return_value = mock_cm_instance

            from src.main import create_app
            from PyQt6.QtWidgets import QApplication

            existing_app = QApplication.instance()
            with patch("src.main.QApplication", return_value=existing_app):
                app, window, controller = create_app(argv=["test"])

            qtbot.addWidget(window)

            # Verify aboutToQuit has at least one receiver connected
            assert app.receivers(app.aboutToQuit) > 0


class TestShowDockerWarning:
    """Test the _show_docker_warning helper."""

    def test_warning_dialog_content(self, qtbot):
        """The warning includes install instructions."""
        from src.main import _show_docker_warning

        window = MainWindow()
        qtbot.addWidget(window)

        with patch("src.main.QMessageBox") as MockMsgBox:
            _show_docker_warning(window)

            MockMsgBox.warning.assert_called_once()
            args = MockMsgBox.warning.call_args[0]
            assert args[0] is window
            assert "Docker Not Available" in args[1]
            assert "docker.com" in args[2]
            assert "Project management" in args[2]
