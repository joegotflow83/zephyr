"""Tests for the main application entry point."""

from unittest.mock import MagicMock, patch

from src.ui.main_window import MainWindow


def test_main_window_instantiation(qtbot):
    """Verify MainWindow can be created and has correct properties."""
    window = MainWindow()
    qtbot.addWidget(window)

    assert window.windowTitle() == "Zephyr Desktop"
    assert window.minimumWidth() == 900
    assert window.minimumHeight() == 600


def test_main_window_is_qmainwindow(qtbot):
    """Verify MainWindow inherits from QMainWindow."""
    from PyQt6.QtWidgets import QMainWindow

    window = MainWindow()
    qtbot.addWidget(window)

    assert isinstance(window, QMainWindow)


# ---------------------------------------------------------------------------
# TerminalBridge integration in main entry point
# ---------------------------------------------------------------------------


class TestTerminalBridgeInMain:
    """Verify TerminalBridge is created, wired, and started in create_app."""

    def test_create_services_includes_terminal_bridge(self, tmp_path):
        """_create_services returns a terminal_bridge instance."""
        from docker.errors import DockerException

        with (
            patch(
                "src.lib.docker_manager.docker.from_env",
                side_effect=DockerException("mock"),
            ),
            patch("src.lib.credential_manager.keyring"),
            patch("src.lib.login_manager.sync_playwright"),
        ):
            from src.main import _create_services

            cm = MagicMock()
            cm.load_json.return_value = {}
            cm.get_config_dir.return_value = tmp_path

            services = _create_services(cm)

            assert "terminal_bridge" in services
            from src.lib.terminal_bridge import TerminalBridge

            assert isinstance(services["terminal_bridge"], TerminalBridge)

    def test_terminal_bridge_passed_to_controller(self, qtbot, tmp_path):
        """create_app passes terminal_bridge to AppController."""
        from docker.errors import DockerException
        from PyQt6.QtWidgets import QApplication

        with (
            patch(
                "src.lib.docker_manager.docker.from_env",
                side_effect=DockerException("mock"),
            ),
            patch("src.lib.credential_manager.keyring"),
            patch("src.lib.login_manager.sync_playwright"),
            patch("src.main.DockerHealthMonitor") as MockHM,
            patch("src.main.ConfigManager") as MockCM,
            patch("src.main.QMessageBox"),
            patch("src.main.TerminalBridge") as MockBridge,
        ):
            mock_cm_instance = MagicMock()
            mock_cm_instance.load_json.return_value = {}
            mock_cm_instance.get_config_dir.return_value = tmp_path
            MockCM.return_value = mock_cm_instance

            mock_bridge_instance = MagicMock()
            MockBridge.return_value = mock_bridge_instance

            existing_app = QApplication.instance()
            with patch("src.main.QApplication", return_value=existing_app):
                from src.main import create_app

                app, window, controller = create_app(argv=["test"])

            qtbot.addWidget(window)

            assert controller._terminal_bridge is mock_bridge_instance

    def test_terminal_bridge_start_called_in_create_app(self, qtbot, tmp_path):
        """create_app calls terminal_bridge.start() after controller setup."""
        from docker.errors import DockerException
        from PyQt6.QtWidgets import QApplication

        with (
            patch(
                "src.lib.docker_manager.docker.from_env",
                side_effect=DockerException("mock"),
            ),
            patch("src.lib.credential_manager.keyring"),
            patch("src.lib.login_manager.sync_playwright"),
            patch("src.main.DockerHealthMonitor"),
            patch("src.main.ConfigManager") as MockCM,
            patch("src.main.QMessageBox"),
            patch("src.main.TerminalBridge") as MockBridge,
        ):
            mock_cm_instance = MagicMock()
            mock_cm_instance.load_json.return_value = {}
            mock_cm_instance.get_config_dir.return_value = tmp_path
            MockCM.return_value = mock_cm_instance

            mock_bridge_instance = MagicMock()
            MockBridge.return_value = mock_bridge_instance

            existing_app = QApplication.instance()
            with patch("src.main.QApplication", return_value=existing_app):
                from src.main import create_app

                create_app(argv=["test"])

            mock_bridge_instance.start.assert_called_once()

    def test_terminal_bridge_uses_docker_manager(self, tmp_path):
        """_create_services creates TerminalBridge with the DockerManager."""
        from docker.errors import DockerException

        with (
            patch(
                "src.lib.docker_manager.docker.from_env",
                side_effect=DockerException("mock"),
            ),
            patch("src.lib.credential_manager.keyring"),
            patch("src.lib.login_manager.sync_playwright"),
            patch("src.main.TerminalBridge") as MockBridge,
        ):
            from src.main import _create_services

            cm = MagicMock()
            cm.load_json.return_value = {}
            cm.get_config_dir.return_value = tmp_path

            services = _create_services(cm)

            # TerminalBridge should be called with the DockerManager instance
            MockBridge.assert_called_once_with(services["docker_manager"])
