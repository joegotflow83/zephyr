"""Tests for the AppController that wires UI signals to backend services.

Verifies that:
- setup_connections wires all expected signals to handler methods
- Handler methods invoke the correct backend service calls
- Handler methods refresh the UI after state changes
- Error conditions are handled gracefully with message boxes
- Import/export operations work through file dialogs
"""

from pathlib import Path
from unittest.mock import MagicMock, patch, call

import pytest
from PyQt6.QtWidgets import QDialog, QMessageBox

from src.lib.app_controller import AppController
from src.lib.loop_runner import LoopMode, LoopState, LoopStatus
from src.lib.models import AppSettings, ProjectConfig

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_config_manager():
    cm = MagicMock()
    cm.load_json.return_value = {}
    cm.save_json.return_value = None
    return cm


@pytest.fixture
def mock_project_store():
    ps = MagicMock()
    ps.list_projects.return_value = []
    ps.get_project.return_value = None
    return ps


@pytest.fixture
def mock_docker_manager():
    dm = MagicMock()
    dm.is_docker_available.return_value = True
    return dm


@pytest.fixture
def mock_loop_runner():
    lr = MagicMock()
    lr.get_all_states.return_value = {}
    return lr


@pytest.fixture
def mock_credential_manager():
    cm = MagicMock()
    return cm


@pytest.fixture
def mock_notifier():
    return MagicMock()


@pytest.fixture
def main_window(qtbot):
    """Create a real MainWindow for signal testing."""
    from src.ui.main_window import MainWindow

    w = MainWindow()
    qtbot.addWidget(w)
    return w


@pytest.fixture
def controller(
    main_window,
    mock_project_store,
    mock_docker_manager,
    mock_loop_runner,
    mock_credential_manager,
    mock_config_manager,
):
    return AppController(
        main_window=main_window,
        project_store=mock_project_store,
        docker_manager=mock_docker_manager,
        loop_runner=mock_loop_runner,
        credential_manager=mock_credential_manager,
        config_manager=mock_config_manager,
    )


def _make_project(name="Test Project", project_id="proj123"):
    return ProjectConfig(
        id=project_id,
        name=name,
        repo_url="https://github.com/test/repo",
        jtbd="Test job",
        created_at="2025-01-01T00:00:00+00:00",
        updated_at="2025-01-01T00:00:00+00:00",
    )


# ---------------------------------------------------------------------------
# setup_connections
# ---------------------------------------------------------------------------


class TestSetupConnections:
    """Verify that setup_connections wires all expected signals.

    PyQt6 bound signals don't expose a .receivers() method, so we verify
    connections by checking that the underlying QObject.receivers() count
    increases for each signal, using the SIGNAL() signature.
    """

    def test_projects_tab_signals_connected(self, controller, main_window):
        tab = main_window.projects_tab
        # Count receivers before
        before_add = tab.receivers(tab.project_add_requested)
        before_edit = tab.receivers(tab.project_edit_requested)
        before_del = tab.receivers(tab.project_delete_requested)
        before_run = tab.receivers(tab.project_run_requested)

        controller.setup_connections()

        assert tab.receivers(tab.project_add_requested) > before_add
        assert tab.receivers(tab.project_edit_requested) > before_edit
        assert tab.receivers(tab.project_delete_requested) > before_del
        assert tab.receivers(tab.project_run_requested) > before_run

    def test_loops_tab_signals_connected(self, controller, main_window):
        tab = main_window.loops_tab
        before_start = tab.receivers(tab.loop_start_requested)
        before_stop = tab.receivers(tab.loop_stop_requested)

        controller.setup_connections()

        assert tab.receivers(tab.loop_start_requested) > before_start
        assert tab.receivers(tab.loop_stop_requested) > before_stop

    def test_settings_tab_signals_connected(self, controller, main_window):
        tab = main_window.settings_tab
        before_cred = tab.receivers(tab.credential_update_requested)
        before_settings = tab.receivers(tab.settings_changed)

        controller.setup_connections()

        assert tab.receivers(tab.credential_update_requested) > before_cred
        assert tab.receivers(tab.settings_changed) > before_settings

    def test_menu_actions_connected(self, controller, main_window):
        before_import = main_window.import_action.receivers(
            main_window.import_action.triggered
        )
        before_export = main_window.export_action.receivers(
            main_window.export_action.triggered
        )
        before_about = main_window.about_action.receivers(
            main_window.about_action.triggered
        )

        controller.setup_connections()

        assert (
            main_window.import_action.receivers(main_window.import_action.triggered)
            > before_import
        )
        assert (
            main_window.export_action.receivers(main_window.export_action.triggered)
            > before_export
        )
        assert (
            main_window.about_action.receivers(main_window.about_action.triggered)
            > before_about
        )


# ---------------------------------------------------------------------------
# refresh_all
# ---------------------------------------------------------------------------


class TestRefreshAll:
    """Verify refresh_all populates all tabs from backend state."""

    def test_refresh_all_calls_backend(
        self,
        controller,
        mock_project_store,
        mock_loop_runner,
        mock_docker_manager,
        mock_config_manager,
    ):
        controller.refresh_all()
        mock_project_store.list_projects.assert_called_once()
        mock_loop_runner.get_all_states.assert_called()
        mock_docker_manager.is_docker_available.assert_called_once()
        mock_config_manager.load_json.assert_called_with("settings.json")

    def test_refresh_projects_tab_populates_table(
        self, controller, mock_project_store, main_window
    ):
        project = _make_project()
        mock_project_store.list_projects.return_value = [project]
        controller.refresh_all()
        assert main_window.projects_tab.table.rowCount() == 1
        assert main_window.projects_tab.table.item(0, 0).text() == "Test Project"

    def test_refresh_loops_tab_populates_table(
        self, controller, mock_loop_runner, mock_project_store, main_window
    ):
        state = LoopState(
            project_id="proj123", status=LoopStatus.RUNNING, mode=LoopMode.CONTINUOUS
        )
        mock_loop_runner.get_all_states.return_value = {"proj123": state}
        project = _make_project()
        mock_project_store.get_project.return_value = project
        controller.refresh_all()
        assert main_window.loops_tab.table.rowCount() == 1

    def test_refresh_docker_status_connected(
        self, controller, mock_docker_manager, main_window
    ):
        mock_docker_manager.is_docker_available.return_value = True
        controller.refresh_all()
        assert "Connected" in main_window.docker_status_label.text()

    def test_refresh_docker_status_disconnected(
        self, controller, mock_docker_manager, main_window
    ):
        mock_docker_manager.is_docker_available.return_value = False
        controller.refresh_all()
        assert "Disconnected" in main_window.docker_status_label.text()

    def test_refresh_settings_loads_defaults(
        self, controller, mock_config_manager, main_window
    ):
        mock_config_manager.load_json.return_value = {}
        controller.refresh_all()
        settings = main_window.settings_tab.get_settings()
        assert settings.max_concurrent_containers == 5
        assert settings.notification_enabled is True
        assert settings.log_level == "INFO"

    def test_refresh_settings_loads_saved(
        self, controller, mock_config_manager, main_window
    ):
        mock_config_manager.load_json.return_value = {
            "max_concurrent_containers": 3,
            "notification_enabled": False,
            "log_level": "DEBUG",
        }
        controller.refresh_all()
        settings = main_window.settings_tab.get_settings()
        assert settings.max_concurrent_containers == 3
        assert settings.notification_enabled is False
        assert settings.log_level == "DEBUG"

    def test_refresh_projects_with_loop_status(
        self, controller, mock_project_store, mock_loop_runner, main_window
    ):
        project = _make_project()
        mock_project_store.list_projects.return_value = [project]
        state = LoopState(project_id="proj123", status=LoopStatus.RUNNING)
        mock_loop_runner.get_all_states.return_value = {"proj123": state}
        controller.refresh_all()
        status_item = main_window.projects_tab.table.item(0, 3)
        assert status_item.text() == "Running"


# ---------------------------------------------------------------------------
# handle_add_project
# ---------------------------------------------------------------------------


class TestHandleAddProject:
    """Verify add project handler opens dialog and persists on accept."""

    @patch("src.lib.app_controller.ProjectDialog")
    def test_add_project_accepted(self, MockDialog, controller, mock_project_store):
        project = _make_project()
        dialog_instance = MockDialog.return_value
        dialog_instance.exec.return_value = QDialog.DialogCode.Accepted
        dialog_instance.get_project.return_value = project

        controller.handle_add_project()

        mock_project_store.add_project.assert_called_once_with(project)
        mock_project_store.list_projects.assert_called()  # refresh

    @patch("src.lib.app_controller.ProjectDialog")
    def test_add_project_cancelled(self, MockDialog, controller, mock_project_store):
        dialog_instance = MockDialog.return_value
        dialog_instance.exec.return_value = QDialog.DialogCode.Rejected

        controller.handle_add_project()

        mock_project_store.add_project.assert_not_called()

    @patch("src.lib.app_controller.QMessageBox")
    @patch("src.lib.app_controller.ProjectDialog")
    def test_add_project_duplicate_shows_warning(
        self, MockDialog, MockMsgBox, controller, mock_project_store
    ):
        project = _make_project()
        dialog_instance = MockDialog.return_value
        dialog_instance.exec.return_value = QDialog.DialogCode.Accepted
        dialog_instance.get_project.return_value = project
        mock_project_store.add_project.side_effect = ValueError("Duplicate ID")

        controller.handle_add_project()

        MockMsgBox.warning.assert_called_once()


# ---------------------------------------------------------------------------
# handle_edit_project
# ---------------------------------------------------------------------------


class TestHandleEditProject:
    """Verify edit project handler fetches, opens dialog, and persists."""

    @patch("src.lib.app_controller.ProjectDialog")
    def test_edit_project_accepted(self, MockDialog, controller, mock_project_store):
        project = _make_project()
        mock_project_store.get_project.return_value = project

        updated = _make_project(name="Updated Name")
        dialog_instance = MockDialog.return_value
        dialog_instance.exec.return_value = QDialog.DialogCode.Accepted
        dialog_instance.get_project.return_value = updated

        controller.handle_edit_project("proj123")

        MockDialog.assert_called_once_with(project=project, parent=controller._window)
        mock_project_store.update_project.assert_called_once_with(updated)

    @patch("src.lib.app_controller.ProjectDialog")
    def test_edit_project_cancelled(self, MockDialog, controller, mock_project_store):
        project = _make_project()
        mock_project_store.get_project.return_value = project
        dialog_instance = MockDialog.return_value
        dialog_instance.exec.return_value = QDialog.DialogCode.Rejected

        controller.handle_edit_project("proj123")

        mock_project_store.update_project.assert_not_called()

    @patch("src.lib.app_controller.QMessageBox")
    def test_edit_project_not_found_shows_warning(
        self, MockMsgBox, controller, mock_project_store
    ):
        mock_project_store.get_project.return_value = None

        controller.handle_edit_project("nonexistent")

        MockMsgBox.warning.assert_called_once()

    @patch("src.lib.app_controller.QMessageBox")
    @patch("src.lib.app_controller.ProjectDialog")
    def test_edit_project_update_error_shows_warning(
        self, MockDialog, MockMsgBox, controller, mock_project_store
    ):
        project = _make_project()
        mock_project_store.get_project.return_value = project
        dialog_instance = MockDialog.return_value
        dialog_instance.exec.return_value = QDialog.DialogCode.Accepted
        dialog_instance.get_project.return_value = project
        mock_project_store.update_project.side_effect = KeyError("Not found")

        controller.handle_edit_project("proj123")

        MockMsgBox.warning.assert_called_once()


# ---------------------------------------------------------------------------
# handle_delete_project
# ---------------------------------------------------------------------------


class TestHandleDeleteProject:
    """Verify delete project handler confirms and removes."""

    @patch("src.lib.app_controller.QMessageBox")
    def test_delete_project_confirmed(self, MockMsgBox, controller, mock_project_store):
        project = _make_project()
        mock_project_store.get_project.return_value = project
        MockMsgBox.StandardButton = QMessageBox.StandardButton
        MockMsgBox.question.return_value = QMessageBox.StandardButton.Yes

        controller.handle_delete_project("proj123")

        mock_project_store.remove_project.assert_called_once_with("proj123")

    @patch("src.lib.app_controller.QMessageBox")
    def test_delete_project_declined(self, MockMsgBox, controller, mock_project_store):
        project = _make_project()
        mock_project_store.get_project.return_value = project
        MockMsgBox.StandardButton = QMessageBox.StandardButton
        MockMsgBox.question.return_value = QMessageBox.StandardButton.No

        controller.handle_delete_project("proj123")

        mock_project_store.remove_project.assert_not_called()

    @patch("src.lib.app_controller.QMessageBox")
    def test_delete_project_not_found_uses_id_as_name(
        self, MockMsgBox, controller, mock_project_store
    ):
        mock_project_store.get_project.return_value = None
        MockMsgBox.StandardButton = QMessageBox.StandardButton
        MockMsgBox.question.return_value = QMessageBox.StandardButton.Yes

        controller.handle_delete_project("unknown_id")

        # Should still try to remove it
        mock_project_store.remove_project.assert_called_once_with("unknown_id")

    @patch("src.lib.app_controller.QMessageBox")
    def test_delete_project_error_shows_warning(
        self, MockMsgBox, controller, mock_project_store
    ):
        mock_project_store.get_project.return_value = _make_project()
        MockMsgBox.StandardButton = QMessageBox.StandardButton
        MockMsgBox.question.return_value = QMessageBox.StandardButton.Yes
        mock_project_store.remove_project.side_effect = KeyError("Not found")

        controller.handle_delete_project("proj123")

        MockMsgBox.warning.assert_called_once()


# ---------------------------------------------------------------------------
# handle_start_loop / handle_stop_loop
# ---------------------------------------------------------------------------


class TestHandleStartLoop:
    """Verify start loop handler invokes LoopRunner.start_loop."""

    def test_start_loop_success(self, controller, mock_loop_runner):
        state = LoopState(project_id="proj123", status=LoopStatus.RUNNING)
        mock_loop_runner.start_loop.return_value = state

        controller.handle_start_loop("proj123")

        mock_loop_runner.start_loop.assert_called_once_with(
            "proj123", LoopMode.CONTINUOUS
        )
        mock_loop_runner.get_all_states.assert_called()  # refresh

    @patch("src.lib.app_controller.QMessageBox")
    def test_start_loop_project_not_found(
        self, MockMsgBox, controller, mock_loop_runner
    ):
        mock_loop_runner.start_loop.side_effect = ValueError("Project not found")

        controller.handle_start_loop("nonexistent")

        MockMsgBox.warning.assert_called_once()

    @patch("src.lib.app_controller.QMessageBox")
    def test_start_loop_max_concurrent(self, MockMsgBox, controller, mock_loop_runner):
        mock_loop_runner.start_loop.side_effect = RuntimeError("Max concurrent reached")

        controller.handle_start_loop("proj123")

        MockMsgBox.warning.assert_called_once()

    @patch("src.lib.app_controller.QMessageBox")
    def test_start_loop_image_not_found(self, MockMsgBox, controller, mock_loop_runner):
        """Docker ImageNotFound (not ValueError/RuntimeError) must not crash the app."""
        mock_loop_runner.start_loop.side_effect = Exception(
            '404 Client Error: Not Found ("No such image: ubuntu:24.04")'
        )

        controller.handle_start_loop("proj123")

        MockMsgBox.critical.assert_called_once()
        args = MockMsgBox.critical.call_args
        assert "No such image" in args[0][2]


class TestHandleStopLoop:
    """Verify stop loop handler invokes LoopRunner.stop_loop."""

    def test_stop_loop_success(self, controller, mock_loop_runner):
        controller.handle_stop_loop("proj123")

        mock_loop_runner.stop_loop.assert_called_once_with("proj123")
        mock_loop_runner.get_all_states.assert_called()  # refresh

    @patch("src.lib.app_controller.QMessageBox")
    def test_stop_loop_no_active_loop(self, MockMsgBox, controller, mock_loop_runner):
        mock_loop_runner.stop_loop.side_effect = ValueError("No active loop")

        controller.handle_stop_loop("proj123")

        MockMsgBox.warning.assert_called_once()


# ---------------------------------------------------------------------------
# handle_update_credential
# ---------------------------------------------------------------------------


class TestHandleUpdateCredential:
    """Verify credential update handler opens dialog and stores key."""

    @patch("src.lib.app_controller.CredentialDialog")
    def test_update_credential_accepted(
        self, MockDialog, controller, mock_credential_manager
    ):
        dialog_instance = MockDialog.return_value
        dialog_instance.exec.return_value = QDialog.DialogCode.Accepted
        dialog_instance.get_result.return_value = ("sk-test-key", False)

        controller.handle_update_credential("anthropic")

        MockDialog.assert_called_once_with("anthropic", parent=controller._window)
        mock_credential_manager.store_api_key.assert_called_once_with(
            "anthropic", "sk-test-key"
        )

    @patch("src.lib.app_controller.CredentialDialog")
    def test_update_credential_cancelled(
        self, MockDialog, controller, mock_credential_manager
    ):
        dialog_instance = MockDialog.return_value
        dialog_instance.exec.return_value = QDialog.DialogCode.Rejected

        controller.handle_update_credential("anthropic")

        mock_credential_manager.store_api_key.assert_not_called()

    @patch("src.lib.app_controller.QMessageBox")
    @patch("src.lib.app_controller.CredentialDialog")
    def test_update_credential_login_mode_no_manager(
        self, MockDialog, MockMsgBox, controller, mock_credential_manager
    ):
        """Login mode without a LoginManager shows an unavailable warning."""
        dialog_instance = MockDialog.return_value
        dialog_instance.exec.return_value = QDialog.DialogCode.Accepted
        dialog_instance.get_result.return_value = ("", True)

        controller.handle_update_credential("anthropic")

        mock_credential_manager.store_api_key.assert_not_called()
        MockMsgBox.warning.assert_called_once()
        assert "Login Unavailable" in MockMsgBox.warning.call_args[0][1]

    @patch("src.lib.app_controller.QMessageBox")
    @patch("src.lib.app_controller.CredentialDialog")
    def test_update_credential_login_mode_success(
        self,
        MockDialog,
        MockMsgBox,
        main_window,
        mock_project_store,
        mock_docker_manager,
        mock_loop_runner,
        mock_credential_manager,
        mock_config_manager,
    ):
        """Login mode with LoginManager launches browser and saves session."""
        mock_login_mgr = MagicMock()
        mock_login_mgr.launch_login.return_value = {
            "service": "anthropic",
            "cookies": [{"name": "tok"}],
        }

        ctrl = AppController(
            main_window=main_window,
            project_store=mock_project_store,
            docker_manager=mock_docker_manager,
            loop_runner=mock_loop_runner,
            credential_manager=mock_credential_manager,
            config_manager=mock_config_manager,
            login_manager=mock_login_mgr,
        )

        dialog_instance = MockDialog.return_value
        dialog_instance.exec.return_value = QDialog.DialogCode.Accepted
        dialog_instance.get_result.return_value = ("", True)

        ctrl.handle_update_credential("anthropic")

        mock_login_mgr.launch_login.assert_called_once_with("anthropic")
        mock_login_mgr.save_session.assert_called_once_with(
            "anthropic", {"service": "anthropic", "cookies": [{"name": "tok"}]}
        )
        MockMsgBox.information.assert_called_once()
        assert "Login Successful" in MockMsgBox.information.call_args[0][1]

    @patch("src.lib.app_controller.QMessageBox")
    @patch("src.lib.app_controller.CredentialDialog")
    def test_update_credential_login_mode_timeout(
        self,
        MockDialog,
        MockMsgBox,
        main_window,
        mock_project_store,
        mock_docker_manager,
        mock_loop_runner,
        mock_credential_manager,
        mock_config_manager,
    ):
        """Login mode returns None on timeout — shows warning."""
        mock_login_mgr = MagicMock()
        mock_login_mgr.launch_login.return_value = None

        ctrl = AppController(
            main_window=main_window,
            project_store=mock_project_store,
            docker_manager=mock_docker_manager,
            loop_runner=mock_loop_runner,
            credential_manager=mock_credential_manager,
            config_manager=mock_config_manager,
            login_manager=mock_login_mgr,
        )

        dialog_instance = MockDialog.return_value
        dialog_instance.exec.return_value = QDialog.DialogCode.Accepted
        dialog_instance.get_result.return_value = ("", True)

        ctrl.handle_update_credential("anthropic")

        mock_login_mgr.launch_login.assert_called_once_with("anthropic")
        mock_login_mgr.save_session.assert_not_called()
        MockMsgBox.warning.assert_called_once()
        assert "Login Timed Out" in MockMsgBox.warning.call_args[0][1]

    @patch("src.lib.app_controller.QMessageBox")
    @patch("src.lib.app_controller.CredentialDialog")
    def test_update_credential_login_mode_launch_error(
        self,
        MockDialog,
        MockMsgBox,
        main_window,
        mock_project_store,
        mock_docker_manager,
        mock_loop_runner,
        mock_credential_manager,
        mock_config_manager,
    ):
        """Login mode catches exceptions from launch_login and shows warning."""
        mock_login_mgr = MagicMock()
        mock_login_mgr.launch_login.side_effect = RuntimeError(
            "Playwright not installed"
        )

        ctrl = AppController(
            main_window=main_window,
            project_store=mock_project_store,
            docker_manager=mock_docker_manager,
            loop_runner=mock_loop_runner,
            credential_manager=mock_credential_manager,
            config_manager=mock_config_manager,
            login_manager=mock_login_mgr,
        )

        dialog_instance = MockDialog.return_value
        dialog_instance.exec.return_value = QDialog.DialogCode.Accepted
        dialog_instance.get_result.return_value = ("", True)

        ctrl.handle_update_credential("anthropic")

        MockMsgBox.warning.assert_called_once()
        assert "Login Failed" in MockMsgBox.warning.call_args[0][1]

    @patch("src.lib.app_controller.QMessageBox")
    @patch("src.lib.app_controller.CredentialDialog")
    def test_update_credential_login_mode_save_error(
        self,
        MockDialog,
        MockMsgBox,
        main_window,
        mock_project_store,
        mock_docker_manager,
        mock_loop_runner,
        mock_credential_manager,
        mock_config_manager,
    ):
        """Login mode catches exceptions from save_session."""
        mock_login_mgr = MagicMock()
        mock_login_mgr.launch_login.return_value = {
            "service": "anthropic",
            "cookies": [],
        }
        mock_login_mgr.save_session.side_effect = ValueError("Storage error")

        ctrl = AppController(
            main_window=main_window,
            project_store=mock_project_store,
            docker_manager=mock_docker_manager,
            loop_runner=mock_loop_runner,
            credential_manager=mock_credential_manager,
            config_manager=mock_config_manager,
            login_manager=mock_login_mgr,
        )

        dialog_instance = MockDialog.return_value
        dialog_instance.exec.return_value = QDialog.DialogCode.Accepted
        dialog_instance.get_result.return_value = ("", True)

        ctrl.handle_update_credential("anthropic")

        MockMsgBox.warning.assert_called_once()
        assert "Credential Error" in MockMsgBox.warning.call_args[0][1]

    @patch("src.lib.app_controller.CredentialDialog")
    def test_update_credential_empty_key_not_stored(
        self, MockDialog, controller, mock_credential_manager
    ):
        dialog_instance = MockDialog.return_value
        dialog_instance.exec.return_value = QDialog.DialogCode.Accepted
        dialog_instance.get_result.return_value = ("", False)

        controller.handle_update_credential("anthropic")

        mock_credential_manager.store_api_key.assert_not_called()

    @patch("src.lib.app_controller.QMessageBox")
    @patch("src.lib.app_controller.CredentialDialog")
    def test_update_credential_invalid_service(
        self, MockDialog, MockMsgBox, controller, mock_credential_manager
    ):
        dialog_instance = MockDialog.return_value
        dialog_instance.exec.return_value = QDialog.DialogCode.Accepted
        dialog_instance.get_result.return_value = ("some-key", False)
        mock_credential_manager.store_api_key.side_effect = ValueError(
            "Unsupported service"
        )

        controller.handle_update_credential("unsupported")

        MockMsgBox.warning.assert_called_once()


# ---------------------------------------------------------------------------
# LoginManager wiring in create_app
# ---------------------------------------------------------------------------


class TestLoginManagerWiring:
    """Verify LoginManager is created and passed to the controller."""

    def test_login_manager_in_services(self, tmp_path):
        """_create_services returns a login_manager."""
        from unittest.mock import patch as _patch
        from docker.errors import DockerException

        with (
            _patch(
                "src.lib.docker_manager.docker.from_env",
                side_effect=DockerException("mock"),
            ),
            _patch("src.lib.credential_manager.keyring"),
            _patch("src.lib.login_manager.sync_playwright"),
        ):
            from src.main import _create_services

            cm = MagicMock()
            cm.load_json.return_value = {}
            cm.get_config_dir.return_value = tmp_path

            services = _create_services(cm)

            assert "login_manager" in services
            from src.lib.login_manager import LoginManager

            assert isinstance(services["login_manager"], LoginManager)

    def test_login_manager_passed_to_controller(self, qtbot, tmp_path):
        """The login manager is passed to AppController."""
        from docker.errors import DockerException

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

            assert controller._login_manager is not None


# ---------------------------------------------------------------------------
# handle_settings_changed
# ---------------------------------------------------------------------------


class TestHandleSettingsChanged:
    """Verify settings handler persists to config file."""

    def test_settings_saved(self, controller, mock_config_manager):
        settings = AppSettings(
            max_concurrent_containers=3, notification_enabled=False, log_level="DEBUG"
        )
        controller.handle_settings_changed(settings)

        mock_config_manager.save_json.assert_called_once_with(
            "settings.json", settings.to_dict()
        )


# ---------------------------------------------------------------------------
# handle_import / handle_export
# ---------------------------------------------------------------------------


class TestHandleImport:
    """Verify import handler opens file dialog and calls import_config."""

    @patch("src.lib.app_controller.import_config")
    @patch("src.lib.app_controller.QFileDialog")
    @patch("src.lib.app_controller.QMessageBox")
    def test_import_success(self, MockMsgBox, MockFileDialog, mock_import, controller):
        MockFileDialog.getOpenFileName.return_value = ("/tmp/config.zip", "")
        mock_import.return_value = {
            "files": ["projects.json"],
            "projects_count": 2,
            "has_settings": True,
        }

        controller.handle_import()

        mock_import.assert_called_once()
        MockMsgBox.information.assert_called_once()

    @patch("src.lib.app_controller.import_config")
    @patch("src.lib.app_controller.QFileDialog")
    def test_import_cancelled(self, MockFileDialog, mock_import, controller):
        MockFileDialog.getOpenFileName.return_value = ("", "")

        controller.handle_import()

        mock_import.assert_not_called()

    @patch("src.lib.app_controller.import_config")
    @patch("src.lib.app_controller.QFileDialog")
    @patch("src.lib.app_controller.QMessageBox")
    def test_import_conflict(self, MockMsgBox, MockFileDialog, mock_import, controller):
        MockFileDialog.getOpenFileName.return_value = ("/tmp/config.zip", "")
        mock_import.side_effect = FileExistsError("Conflict with projects.json")

        controller.handle_import()

        MockMsgBox.warning.assert_called_once()

    @patch("src.lib.app_controller.import_config")
    @patch("src.lib.app_controller.QFileDialog")
    @patch("src.lib.app_controller.QMessageBox")
    def test_import_error(self, MockMsgBox, MockFileDialog, mock_import, controller):
        MockFileDialog.getOpenFileName.return_value = ("/tmp/config.zip", "")
        mock_import.side_effect = Exception("Corrupt file")

        controller.handle_import()

        MockMsgBox.critical.assert_called_once()


class TestHandleExport:
    """Verify export handler opens file dialog and calls export_config."""

    @patch("src.lib.app_controller.export_config")
    @patch("src.lib.app_controller.QFileDialog")
    @patch("src.lib.app_controller.QMessageBox")
    def test_export_success(self, MockMsgBox, MockFileDialog, mock_export, controller):
        MockFileDialog.getSaveFileName.return_value = ("/tmp/out.zip", "")
        mock_export.return_value = Path("/tmp/out.zip")

        controller.handle_export()

        mock_export.assert_called_once()
        MockMsgBox.information.assert_called_once()

    @patch("src.lib.app_controller.export_config")
    @patch("src.lib.app_controller.QFileDialog")
    def test_export_cancelled(self, MockFileDialog, mock_export, controller):
        MockFileDialog.getSaveFileName.return_value = ("", "")

        controller.handle_export()

        mock_export.assert_not_called()

    @patch("src.lib.app_controller.export_config")
    @patch("src.lib.app_controller.QFileDialog")
    @patch("src.lib.app_controller.QMessageBox")
    def test_export_error(self, MockMsgBox, MockFileDialog, mock_export, controller):
        MockFileDialog.getSaveFileName.return_value = ("/tmp/out.zip", "")
        mock_export.side_effect = Exception("Disk full")

        controller.handle_export()

        MockMsgBox.critical.assert_called_once()


# ---------------------------------------------------------------------------
# handle_about
# ---------------------------------------------------------------------------


class TestHandleAbout:
    """Verify about handler shows a message box."""

    @patch("src.lib.app_controller.QMessageBox")
    def test_about_dialog_shown(self, MockMsgBox, controller):
        controller.handle_about()
        MockMsgBox.about.assert_called_once()


# ---------------------------------------------------------------------------
# Signal-driven integration (signals -> handlers)
# ---------------------------------------------------------------------------


class TestSignalIntegration:
    """Verify that emitting UI signals triggers the correct handlers."""

    @patch("src.lib.app_controller.ProjectDialog")
    def test_add_button_triggers_handler(
        self, MockDialog, controller, main_window, mock_project_store
    ):
        dialog_instance = MockDialog.return_value
        dialog_instance.exec.return_value = QDialog.DialogCode.Rejected
        controller.setup_connections()

        main_window.projects_tab.project_add_requested.emit()

        MockDialog.assert_called_once()

    def test_start_loop_signal_triggers_handler(
        self, controller, main_window, mock_loop_runner, qtbot
    ):
        state = LoopState(project_id="p1", status=LoopStatus.RUNNING)
        mock_loop_runner.start_loop.return_value = state
        controller.setup_connections()

        main_window.loops_tab.loop_start_requested.emit("p1")

        mock_loop_runner.start_loop.assert_called_once_with("p1", LoopMode.CONTINUOUS)

    def test_stop_loop_signal_triggers_handler(
        self, controller, main_window, mock_loop_runner, qtbot
    ):
        controller.setup_connections()

        main_window.loops_tab.loop_stop_requested.emit("p1")

        mock_loop_runner.stop_loop.assert_called_once_with("p1")

    @patch("src.lib.app_controller.CredentialDialog")
    def test_credential_signal_triggers_handler(
        self, MockDialog, controller, main_window, mock_credential_manager, qtbot
    ):
        dialog_instance = MockDialog.return_value
        dialog_instance.exec.return_value = QDialog.DialogCode.Rejected
        controller.setup_connections()

        main_window.settings_tab.credential_update_requested.emit("anthropic")

        MockDialog.assert_called_once_with("anthropic", parent=main_window)

    def test_settings_changed_signal_triggers_handler(
        self, controller, main_window, mock_config_manager, qtbot
    ):
        controller.setup_connections()
        settings = AppSettings(max_concurrent_containers=2, log_level="ERROR")

        main_window.settings_tab.settings_changed.emit(settings)

        mock_config_manager.save_json.assert_called_with(
            "settings.json", settings.to_dict()
        )

    @patch("src.lib.app_controller.QMessageBox")
    def test_edit_signal_triggers_handler(
        self, MockMsgBox, controller, main_window, mock_project_store, qtbot
    ):
        mock_project_store.get_project.return_value = None
        controller.setup_connections()

        main_window.projects_tab.project_edit_requested.emit("proj123")

        # Project not found, should show warning
        MockMsgBox.warning.assert_called_once()

    @patch("src.lib.app_controller.QMessageBox")
    def test_delete_signal_triggers_handler(
        self, MockMsgBox, controller, main_window, mock_project_store, qtbot
    ):
        mock_project_store.get_project.return_value = None
        MockMsgBox.StandardButton = QMessageBox.StandardButton
        MockMsgBox.question.return_value = QMessageBox.StandardButton.No
        controller.setup_connections()

        main_window.projects_tab.project_delete_requested.emit("proj123")

        MockMsgBox.question.assert_called_once()


# ---------------------------------------------------------------------------
# Notifier wiring
# ---------------------------------------------------------------------------


class TestNotifierWiring:
    """Verify that the Notifier is wired into the loop lifecycle."""

    @pytest.fixture
    def controller_with_notifier(
        self,
        main_window,
        mock_project_store,
        mock_docker_manager,
        mock_loop_runner,
        mock_credential_manager,
        mock_config_manager,
        mock_notifier,
    ):
        return AppController(
            main_window=main_window,
            project_store=mock_project_store,
            docker_manager=mock_docker_manager,
            loop_runner=mock_loop_runner,
            credential_manager=mock_credential_manager,
            config_manager=mock_config_manager,
            notifier=mock_notifier,
        )

    def test_setup_registers_completion_callback(
        self, controller_with_notifier, mock_loop_runner
    ):
        controller_with_notifier.setup_connections()
        mock_loop_runner.add_completion_callback.assert_called_once()

    def test_setup_registers_failure_callback(
        self, controller_with_notifier, mock_loop_runner
    ):
        controller_with_notifier.setup_connections()
        mock_loop_runner.add_failure_callback.assert_called_once()

    def test_no_callbacks_without_notifier(self, controller, mock_loop_runner):
        """When notifier is None, no callbacks should be registered."""
        controller.setup_connections()
        mock_loop_runner.add_completion_callback.assert_not_called()
        mock_loop_runner.add_failure_callback.assert_not_called()

    def test_on_loop_completed_calls_notifier(
        self, controller_with_notifier, mock_project_store, mock_notifier
    ):
        project = _make_project(name="My Project")
        mock_project_store.get_project.return_value = project

        controller_with_notifier._on_loop_completed("proj123", 3)

        mock_notifier.notify_loop_complete.assert_called_once_with("My Project", 3)

    def test_on_loop_completed_uses_id_when_project_missing(
        self, controller_with_notifier, mock_project_store, mock_notifier
    ):
        mock_project_store.get_project.return_value = None

        controller_with_notifier._on_loop_completed("unknown_id", 1)

        mock_notifier.notify_loop_complete.assert_called_once_with("unknown_id", 1)

    def test_on_loop_failed_calls_notifier(
        self, controller_with_notifier, mock_project_store, mock_notifier
    ):
        project = _make_project(name="Failing Project")
        mock_project_store.get_project.return_value = project

        controller_with_notifier._on_loop_failed("proj123", "Container crashed")

        mock_notifier.notify_loop_failed.assert_called_once_with(
            "Failing Project", "Container crashed"
        )

    def test_on_loop_failed_uses_id_when_project_missing(
        self, controller_with_notifier, mock_project_store, mock_notifier
    ):
        mock_project_store.get_project.return_value = None

        controller_with_notifier._on_loop_failed("unknown_id", "Error msg")

        mock_notifier.notify_loop_failed.assert_called_once_with(
            "unknown_id", "Error msg"
        )

    def test_on_loop_completed_no_notifier_is_safe(
        self, controller, mock_project_store
    ):
        """Calling _on_loop_completed without notifier should not raise."""
        mock_project_store.get_project.return_value = _make_project()
        controller._on_loop_completed("proj123", 1)  # Should not raise

    def test_on_loop_failed_no_notifier_is_safe(self, controller, mock_project_store):
        """Calling _on_loop_failed without notifier should not raise."""
        mock_project_store.get_project.return_value = _make_project()
        controller._on_loop_failed("proj123", "err")  # Should not raise


# ---------------------------------------------------------------------------
# DockerHealthMonitor wiring
# ---------------------------------------------------------------------------


class TestDockerHealthMonitorWiring:
    """Verify that DockerHealthMonitor signals update the UI status."""

    @pytest.fixture
    def mock_health_monitor(self):
        from src.lib.docker_health import DockerHealthMonitor

        monitor = MagicMock(spec=DockerHealthMonitor)
        # Provide real signal-like attributes for connection counting
        monitor.docker_connected = MagicMock()
        monitor.docker_disconnected = MagicMock()
        return monitor

    @pytest.fixture
    def controller_with_health(
        self,
        main_window,
        mock_project_store,
        mock_docker_manager,
        mock_loop_runner,
        mock_credential_manager,
        mock_config_manager,
        mock_health_monitor,
    ):
        return AppController(
            main_window=main_window,
            project_store=mock_project_store,
            docker_manager=mock_docker_manager,
            loop_runner=mock_loop_runner,
            credential_manager=mock_credential_manager,
            config_manager=mock_config_manager,
            docker_health_monitor=mock_health_monitor,
        )

    def test_setup_connects_health_signals(
        self, controller_with_health, mock_health_monitor
    ):
        """setup_connections wires docker_connected and docker_disconnected signals."""
        controller_with_health.setup_connections()
        mock_health_monitor.docker_connected.connect.assert_called_once()
        mock_health_monitor.docker_disconnected.connect.assert_called_once()

    def test_no_health_signals_without_monitor(self, controller):
        """When no health monitor is provided, setup_connections does not fail."""
        controller.setup_connections()  # Should not raise

    def test_on_docker_connected_updates_status_bar(
        self, controller_with_health, main_window
    ):
        """_on_docker_connected sets both status indicators to connected."""
        # Start disconnected
        main_window.set_docker_status(False)
        assert "Disconnected" in main_window.docker_status_label.text()

        controller_with_health._on_docker_connected()

        assert "Connected" in main_window.docker_status_label.text()

    def test_on_docker_disconnected_updates_status_bar(
        self, controller_with_health, main_window
    ):
        """_on_docker_disconnected sets both status indicators to disconnected."""
        # Start connected
        main_window.set_docker_status(True)
        assert "Connected" in main_window.docker_status_label.text()

        controller_with_health._on_docker_disconnected()

        assert "Disconnected" in main_window.docker_status_label.text()

    def test_on_docker_connected_updates_settings_tab(
        self, controller_with_health, main_window
    ):
        """_on_docker_connected updates the settings tab docker status."""
        main_window.settings_tab.set_docker_status(False)
        controller_with_health._on_docker_connected()
        # Settings tab should reflect connected
        assert "Connected" in main_window.settings_tab.docker_status_label.text()

    def test_on_docker_disconnected_updates_settings_tab(
        self, controller_with_health, main_window
    ):
        """_on_docker_disconnected updates the settings tab docker status."""
        main_window.settings_tab.set_docker_status(True)
        controller_with_health._on_docker_disconnected()
        assert "Disconnected" in main_window.settings_tab.docker_status_label.text()

    def test_shutdown_stops_health_monitor(
        self, controller_with_health, mock_health_monitor
    ):
        """shutdown() calls stop() on the health monitor."""
        controller_with_health.shutdown()
        mock_health_monitor.stop.assert_called_once()

    def test_shutdown_without_health_monitor(self, controller):
        """shutdown() is safe when no health monitor is provided."""
        controller.shutdown()  # Should not raise

    def test_health_monitor_stored_on_controller(
        self, controller_with_health, mock_health_monitor
    ):
        """The health monitor is accessible via the controller."""
        assert controller_with_health._docker_health_monitor is mock_health_monitor


# ---------------------------------------------------------------------------
# DiskChecker wiring
# ---------------------------------------------------------------------------


class TestDiskCheckerWiring:
    """Verify that DiskChecker is wired into the loop startup flow.

    When disk space is critically low, handle_start_loop should warn the
    user and refuse to start the loop, preventing Docker container failures
    due to insufficient storage.
    """

    @pytest.fixture
    def mock_disk_checker(self):
        return MagicMock()

    @pytest.fixture
    def controller_with_disk_checker(
        self,
        main_window,
        mock_project_store,
        mock_docker_manager,
        mock_loop_runner,
        mock_credential_manager,
        mock_config_manager,
        mock_disk_checker,
    ):
        return AppController(
            main_window=main_window,
            project_store=mock_project_store,
            docker_manager=mock_docker_manager,
            loop_runner=mock_loop_runner,
            credential_manager=mock_credential_manager,
            config_manager=mock_config_manager,
            disk_checker=mock_disk_checker,
        )

    def test_disk_checker_stored_on_controller(
        self, controller_with_disk_checker, mock_disk_checker
    ):
        """The disk checker is accessible via the controller."""
        assert controller_with_disk_checker._disk_checker is mock_disk_checker

    def test_start_loop_proceeds_when_disk_ok(
        self, controller_with_disk_checker, mock_disk_checker, mock_loop_runner
    ):
        """When warn_if_low returns None, the loop starts normally."""
        mock_disk_checker.warn_if_low.return_value = None
        state = LoopState(project_id="proj123", status=LoopStatus.RUNNING)
        mock_loop_runner.start_loop.return_value = state

        controller_with_disk_checker.handle_start_loop("proj123")

        mock_disk_checker.warn_if_low.assert_called_once()
        mock_loop_runner.start_loop.assert_called_once_with(
            "proj123", LoopMode.CONTINUOUS
        )

    @patch("src.lib.app_controller.QMessageBox")
    def test_start_loop_blocked_when_disk_low(
        self,
        MockMsgBox,
        controller_with_disk_checker,
        mock_disk_checker,
        mock_loop_runner,
    ):
        """When warn_if_low returns a warning, the loop is NOT started."""
        mock_disk_checker.warn_if_low.return_value = (
            "Low disk space warning: only 2.1 GB available"
        )

        controller_with_disk_checker.handle_start_loop("proj123")

        mock_disk_checker.warn_if_low.assert_called_once()
        mock_loop_runner.start_loop.assert_not_called()
        MockMsgBox.warning.assert_called_once()
        # Verify the warning message is passed through
        call_args = MockMsgBox.warning.call_args
        assert "Low Disk Space" in call_args[0][1]  # title
        assert "2.1 GB" in call_args[0][2]  # message body

    def test_start_loop_works_without_disk_checker(self, controller, mock_loop_runner):
        """When disk_checker is None, handle_start_loop skips the check."""
        state = LoopState(project_id="proj123", status=LoopStatus.RUNNING)
        mock_loop_runner.start_loop.return_value = state

        controller.handle_start_loop("proj123")

        mock_loop_runner.start_loop.assert_called_once_with(
            "proj123", LoopMode.CONTINUOUS
        )

    @patch("src.lib.app_controller.QMessageBox")
    def test_start_loop_disk_checker_exception_does_not_block(
        self,
        MockMsgBox,
        controller_with_disk_checker,
        mock_disk_checker,
        mock_loop_runner,
    ):
        """If DiskChecker.warn_if_low raises, the loop still starts.

        DiskChecker failures should not prevent loop execution — the check
        is best-effort.
        """
        mock_disk_checker.warn_if_low.side_effect = OSError("Permission denied")
        state = LoopState(project_id="proj123", status=LoopStatus.RUNNING)
        mock_loop_runner.start_loop.return_value = state

        controller_with_disk_checker.handle_start_loop("proj123")

        mock_loop_runner.start_loop.assert_called_once_with(
            "proj123", LoopMode.CONTINUOUS
        )

    def test_disk_checker_default_is_none(self, controller):
        """Without explicit disk_checker, the attribute is None."""
        assert controller._disk_checker is None


# ---------------------------------------------------------------------------
# Log export handlers
# ---------------------------------------------------------------------------


class TestHandleExportLog:
    """Verify single-loop log export via handle_export_log."""

    @patch("src.lib.app_controller.LogExporter")
    @patch("src.lib.app_controller.QFileDialog")
    @patch("src.lib.app_controller.QMessageBox")
    def test_export_log_success(
        self, MockMsgBox, MockFileDialog, MockExporter, controller, main_window
    ):
        """Exporting a single log writes the file and shows success."""
        main_window.loops_tab.append_log("p1", "line 1")
        main_window.loops_tab.append_log("p1", "line 2")
        MockFileDialog.getExistingDirectory.return_value = "/tmp/export"
        MockExporter.export_loop_log.return_value = Path(
            "/tmp/export/zephyr-p1-20250101T000000Z.log"
        )

        controller.handle_export_log("p1")

        MockExporter.export_loop_log.assert_called_once_with(
            "p1", "line 1\nline 2", Path("/tmp/export")
        )
        MockMsgBox.information.assert_called_once()

    @patch("src.lib.app_controller.QFileDialog")
    @patch("src.lib.app_controller.QMessageBox")
    def test_export_log_no_content(self, MockMsgBox, MockFileDialog, controller):
        """When there's no log content, shows informational message."""
        controller.handle_export_log("p1")

        MockFileDialog.getExistingDirectory.assert_not_called()
        MockMsgBox.information.assert_called_once()
        assert "No Log Data" in MockMsgBox.information.call_args[0][1]

    @patch("src.lib.app_controller.LogExporter")
    @patch("src.lib.app_controller.QFileDialog")
    def test_export_log_cancelled(
        self, MockFileDialog, MockExporter, controller, main_window
    ):
        """When user cancels directory selection, nothing is exported."""
        main_window.loops_tab.append_log("p1", "data")
        MockFileDialog.getExistingDirectory.return_value = ""

        controller.handle_export_log("p1")

        MockExporter.export_loop_log.assert_not_called()

    @patch("src.lib.app_controller.LogExporter")
    @patch("src.lib.app_controller.QFileDialog")
    @patch("src.lib.app_controller.QMessageBox")
    def test_export_log_error(
        self, MockMsgBox, MockFileDialog, MockExporter, controller, main_window
    ):
        """Export errors show a critical dialog."""
        main_window.loops_tab.append_log("p1", "data")
        MockFileDialog.getExistingDirectory.return_value = "/tmp"
        MockExporter.export_loop_log.side_effect = OSError("Permission denied")

        controller.handle_export_log("p1")

        MockMsgBox.critical.assert_called_once()


class TestHandleExportAllLogs:
    """Verify all-logs zip export via handle_export_all_logs."""

    @patch("src.lib.app_controller.LogExporter")
    @patch("src.lib.app_controller.QFileDialog")
    @patch("src.lib.app_controller.QMessageBox")
    def test_export_all_logs_success(
        self,
        MockMsgBox,
        MockFileDialog,
        MockExporter,
        controller,
        main_window,
        mock_loop_runner,
    ):
        """Exporting all logs creates a zip and shows success."""
        main_window.loops_tab.append_log("p1", "log1")
        main_window.loops_tab.append_log("p2", "log2")
        states = {
            "p1": LoopState(project_id="p1", status=LoopStatus.RUNNING),
            "p2": LoopState(project_id="p2", status=LoopStatus.COMPLETED),
        }
        mock_loop_runner.get_all_states.return_value = states
        MockFileDialog.getExistingDirectory.return_value = "/tmp/export"
        MockExporter.export_all_logs.return_value = Path(
            "/tmp/export/zephyr-logs-20250101T000000Z.zip"
        )

        controller.handle_export_all_logs()

        MockExporter.export_all_logs.assert_called_once_with(
            states, {"p1": "log1", "p2": "log2"}, Path("/tmp/export")
        )
        MockMsgBox.information.assert_called_once()

    @patch("src.lib.app_controller.QFileDialog")
    @patch("src.lib.app_controller.QMessageBox")
    def test_export_all_logs_no_data(
        self, MockMsgBox, MockFileDialog, controller, mock_loop_runner
    ):
        """When no logs and no states, shows informational message."""
        mock_loop_runner.get_all_states.return_value = {}

        controller.handle_export_all_logs()

        MockFileDialog.getExistingDirectory.assert_not_called()
        MockMsgBox.information.assert_called_once()
        assert "No Log Data" in MockMsgBox.information.call_args[0][1]

    @patch("src.lib.app_controller.LogExporter")
    @patch("src.lib.app_controller.QFileDialog")
    def test_export_all_logs_cancelled(
        self, MockFileDialog, MockExporter, controller, main_window, mock_loop_runner
    ):
        """When user cancels, nothing is exported."""
        main_window.loops_tab.append_log("p1", "data")
        mock_loop_runner.get_all_states.return_value = {
            "p1": LoopState(project_id="p1", status=LoopStatus.RUNNING),
        }
        MockFileDialog.getExistingDirectory.return_value = ""

        controller.handle_export_all_logs()

        MockExporter.export_all_logs.assert_not_called()

    @patch("src.lib.app_controller.LogExporter")
    @patch("src.lib.app_controller.QFileDialog")
    @patch("src.lib.app_controller.QMessageBox")
    def test_export_all_logs_error(
        self,
        MockMsgBox,
        MockFileDialog,
        MockExporter,
        controller,
        main_window,
        mock_loop_runner,
    ):
        """Export errors show a critical dialog."""
        main_window.loops_tab.append_log("p1", "data")
        mock_loop_runner.get_all_states.return_value = {
            "p1": LoopState(project_id="p1", status=LoopStatus.RUNNING),
        }
        MockFileDialog.getExistingDirectory.return_value = "/tmp"
        MockExporter.export_all_logs.side_effect = OSError("Disk full")

        controller.handle_export_all_logs()

        MockMsgBox.critical.assert_called_once()

    @patch("src.lib.app_controller.LogExporter")
    @patch("src.lib.app_controller.QFileDialog")
    @patch("src.lib.app_controller.QMessageBox")
    def test_export_all_logs_with_states_but_no_log_content(
        self, MockMsgBox, MockFileDialog, MockExporter, controller, mock_loop_runner
    ):
        """States alone (without log content) should still allow export."""
        mock_loop_runner.get_all_states.return_value = {
            "p1": LoopState(project_id="p1", status=LoopStatus.COMPLETED),
        }
        MockFileDialog.getExistingDirectory.return_value = "/tmp/export"
        MockExporter.export_all_logs.return_value = Path("/tmp/export/logs.zip")

        controller.handle_export_all_logs()

        MockExporter.export_all_logs.assert_called_once()


class TestLogExportSignalWiring:
    """Verify log export signals are connected by setup_connections."""

    def test_log_export_signal_connected(self, controller, main_window):
        tab = main_window.loops_tab
        before = tab.receivers(tab.log_export_requested)
        controller.setup_connections()
        assert tab.receivers(tab.log_export_requested) > before

    def test_log_export_all_signal_connected(self, controller, main_window):
        tab = main_window.loops_tab
        before = tab.receivers(tab.log_export_all_requested)
        controller.setup_connections()
        assert tab.receivers(tab.log_export_all_requested) > before


# ---------------------------------------------------------------------------
# SelfUpdater wiring
# ---------------------------------------------------------------------------


class TestSelfUpdateSignalWiring:
    """Verify self-update signals are connected by setup_connections."""

    def test_check_updates_signal_connected(self, controller, main_window):
        tab = main_window.settings_tab
        before = tab.receivers(tab.check_updates_requested)
        controller.setup_connections()
        assert tab.receivers(tab.check_updates_requested) > before

    def test_self_update_signal_connected(self, controller, main_window):
        tab = main_window.settings_tab
        before = tab.receivers(tab.self_update_requested)
        controller.setup_connections()
        assert tab.receivers(tab.self_update_requested) > before


class TestHandleCheckUpdates:
    """Verify handle_check_updates invokes SelfUpdater correctly."""

    @patch("src.lib.app_controller.QMessageBox")
    def test_no_updater_shows_warning(self, MockMsgBox, controller):
        """When self_updater is None, a warning dialog is shown."""
        controller._self_updater = None
        controller.handle_check_updates()
        MockMsgBox.warning.assert_called_once()
        args = MockMsgBox.warning.call_args[0]
        assert "Update Unavailable" in args[1]

    @patch("src.lib.app_controller.QMessageBox")
    def test_updates_available(self, MockMsgBox, controller, main_window):
        """When updates are available, the UI status is updated."""
        mock_updater = MagicMock()
        mock_updater.check_for_updates.return_value = True
        controller._self_updater = mock_updater

        with patch.object(
            controller, "_resolve_app_repo_path", return_value=Path("/app")
        ):
            controller.handle_check_updates()

        mock_updater.check_for_updates.assert_called_once_with(Path("/app"))
        assert (
            main_window.settings_tab.update_status_label.text() == "Updates available"
        )
        assert main_window.settings_tab.update_app_btn.isEnabled()

    @patch("src.lib.app_controller.QMessageBox")
    def test_no_updates_available(self, MockMsgBox, controller, main_window):
        """When no updates, status shows 'Up to date'."""
        mock_updater = MagicMock()
        mock_updater.check_for_updates.return_value = False
        controller._self_updater = mock_updater

        with patch.object(
            controller, "_resolve_app_repo_path", return_value=Path("/app")
        ):
            controller.handle_check_updates()

        assert main_window.settings_tab.update_status_label.text() == "Up to date"
        assert not main_window.settings_tab.update_app_btn.isEnabled()

    @patch("src.lib.app_controller.QMessageBox")
    def test_check_updates_error_shows_warning(self, MockMsgBox, controller):
        """Errors during check are shown in a warning dialog."""
        mock_updater = MagicMock()
        mock_updater.check_for_updates.side_effect = RuntimeError("fetch failed")
        controller._self_updater = mock_updater

        with patch.object(
            controller, "_resolve_app_repo_path", return_value=Path("/app")
        ):
            controller.handle_check_updates()

        MockMsgBox.warning.assert_called_once()
        args = MockMsgBox.warning.call_args[0]
        assert "Update Check Failed" in args[1]
        assert "fetch failed" in args[2]


class TestHandleTriggerUpdate:
    """Verify handle_trigger_update invokes SelfUpdater correctly."""

    @patch("src.lib.app_controller.QMessageBox")
    def test_no_updater_shows_warning(self, MockMsgBox, controller):
        """When self_updater is None, a warning is shown."""
        controller._self_updater = None
        controller.handle_trigger_update()
        MockMsgBox.warning.assert_called_once()

    @patch("src.lib.app_controller.QMessageBox")
    def test_user_declines_confirmation(self, MockMsgBox, controller):
        """When user clicks No on confirmation, update is not started."""
        mock_updater = MagicMock()
        controller._self_updater = mock_updater
        MockMsgBox.question.return_value = QMessageBox.StandardButton.No
        MockMsgBox.StandardButton = QMessageBox.StandardButton

        controller.handle_trigger_update()

        mock_updater.trigger_self_update.assert_not_called()

    @patch("src.lib.app_controller.QMessageBox")
    def test_user_confirms_update(self, MockMsgBox, controller, mock_loop_runner):
        """When user confirms, trigger_self_update is called."""
        mock_updater = MagicMock()
        controller._self_updater = mock_updater
        MockMsgBox.question.return_value = QMessageBox.StandardButton.Yes
        MockMsgBox.StandardButton = QMessageBox.StandardButton

        with patch.object(
            controller, "_resolve_app_repo_path", return_value=Path("/app")
        ):
            controller.handle_trigger_update()

        mock_updater.trigger_self_update.assert_called_once_with(Path("/app"))
        MockMsgBox.information.assert_called_once()
        args = MockMsgBox.information.call_args[0]
        assert "Self-Update Started" in args[1]

    @patch("src.lib.app_controller.QMessageBox")
    def test_trigger_update_error(self, MockMsgBox, controller):
        """Errors from trigger_self_update are shown in a warning."""
        mock_updater = MagicMock()
        mock_updater.trigger_self_update.side_effect = RuntimeError("already running")
        controller._self_updater = mock_updater
        MockMsgBox.question.return_value = QMessageBox.StandardButton.Yes
        MockMsgBox.StandardButton = QMessageBox.StandardButton

        with patch.object(
            controller, "_resolve_app_repo_path", return_value=Path("/app")
        ):
            controller.handle_trigger_update()

        MockMsgBox.warning.assert_called_once()
        args = MockMsgBox.warning.call_args[0]
        assert "Self-Update Failed" in args[1]
        assert "already running" in args[2]

    @patch("src.lib.app_controller.QMessageBox")
    def test_trigger_update_refreshes_loops_tab(
        self, MockMsgBox, controller, mock_loop_runner
    ):
        """After successful update start, loops tab is refreshed."""
        mock_updater = MagicMock()
        controller._self_updater = mock_updater
        MockMsgBox.question.return_value = QMessageBox.StandardButton.Yes
        MockMsgBox.StandardButton = QMessageBox.StandardButton

        with patch.object(
            controller, "_resolve_app_repo_path", return_value=Path("/app")
        ):
            controller.handle_trigger_update()

        mock_loop_runner.get_all_states.assert_called()


class TestResolveAppRepoPath:
    """Verify _resolve_app_repo_path finds the git root."""

    def test_resolve_finds_git_root(self, controller, tmp_path):
        """When .git exists, the correct root is returned."""
        (tmp_path / ".git").mkdir()
        src_dir = tmp_path / "src"
        src_dir.mkdir()
        (src_dir / "__init__.py").write_text("")

        import src as src_module

        original_file = src_module.__file__
        try:
            src_module.__file__ = str(src_dir / "__init__.py")
            result = controller._resolve_app_repo_path()
        finally:
            src_module.__file__ = original_file

        assert result == tmp_path


# ---------------------------------------------------------------------------
# GitManager wiring — repo validation before loop start
# ---------------------------------------------------------------------------


class TestGitManagerWiring:
    """Verify GitManager validates the project repo before starting a loop.

    When a project's repo_url points to an absolute local path, the
    controller asks GitManager.validate_repo before starting the loop.
    If the path is not a valid Git repository, the user is prompted
    to confirm or cancel.  The check is best-effort: exceptions are
    logged but never block the loop.
    """

    @pytest.fixture
    def mock_git_manager(self):
        return MagicMock()

    @pytest.fixture
    def project_with_repo(self, tmp_path):
        return ProjectConfig(name="Test", repo_url=str(tmp_path / "myrepo"))

    @pytest.fixture
    def controller_with_git(
        self,
        main_window,
        mock_project_store,
        mock_docker_manager,
        mock_loop_runner,
        mock_credential_manager,
        mock_config_manager,
        mock_git_manager,
    ):
        return AppController(
            main_window=main_window,
            project_store=mock_project_store,
            docker_manager=mock_docker_manager,
            loop_runner=mock_loop_runner,
            credential_manager=mock_credential_manager,
            config_manager=mock_config_manager,
            git_manager=mock_git_manager,
        )

    def test_git_manager_stored_on_controller(
        self, controller_with_git, mock_git_manager
    ):
        """The git manager is accessible via the controller."""
        assert controller_with_git._git_manager is mock_git_manager

    def test_git_manager_default_is_none(self, controller):
        """Without explicit git_manager, the attribute is None."""
        assert controller._git_manager is None

    def test_start_loop_proceeds_when_repo_valid(
        self,
        controller_with_git,
        mock_git_manager,
        mock_project_store,
        mock_loop_runner,
        project_with_repo,
    ):
        """When validate_repo returns True, the loop starts normally."""
        mock_project_store.get_project.return_value = project_with_repo
        mock_git_manager.validate_repo.return_value = True
        state = LoopState(project_id="proj123", status=LoopStatus.RUNNING)
        mock_loop_runner.start_loop.return_value = state

        controller_with_git.handle_start_loop("proj123")

        mock_git_manager.validate_repo.assert_called_once()
        mock_loop_runner.start_loop.assert_called_once_with(
            "proj123", LoopMode.CONTINUOUS
        )

    @patch("src.lib.app_controller.QMessageBox")
    def test_start_loop_warns_when_repo_invalid_user_declines(
        self,
        MockMsgBox,
        controller_with_git,
        mock_git_manager,
        mock_project_store,
        mock_loop_runner,
        project_with_repo,
    ):
        """When validate_repo returns False and user declines, loop is NOT started."""
        mock_project_store.get_project.return_value = project_with_repo
        mock_git_manager.validate_repo.return_value = False
        MockMsgBox.StandardButton.No = QMessageBox.StandardButton.No
        MockMsgBox.StandardButton.Yes = QMessageBox.StandardButton.Yes
        MockMsgBox.question.return_value = QMessageBox.StandardButton.No

        controller_with_git.handle_start_loop("proj123")

        mock_git_manager.validate_repo.assert_called_once()
        mock_loop_runner.start_loop.assert_not_called()
        MockMsgBox.question.assert_called_once()
        call_args = MockMsgBox.question.call_args
        assert "Invalid Git Repository" in call_args[0][1]

    @patch("src.lib.app_controller.QMessageBox")
    def test_start_loop_proceeds_when_repo_invalid_user_accepts(
        self,
        MockMsgBox,
        controller_with_git,
        mock_git_manager,
        mock_project_store,
        mock_loop_runner,
        project_with_repo,
    ):
        """When validate_repo returns False but user clicks Yes, loop starts."""
        mock_project_store.get_project.return_value = project_with_repo
        mock_git_manager.validate_repo.return_value = False
        MockMsgBox.StandardButton.No = QMessageBox.StandardButton.No
        MockMsgBox.StandardButton.Yes = QMessageBox.StandardButton.Yes
        MockMsgBox.question.return_value = QMessageBox.StandardButton.Yes
        state = LoopState(project_id="proj123", status=LoopStatus.RUNNING)
        mock_loop_runner.start_loop.return_value = state

        controller_with_git.handle_start_loop("proj123")

        mock_loop_runner.start_loop.assert_called_once_with(
            "proj123", LoopMode.CONTINUOUS
        )

    def test_start_loop_skips_git_check_for_url_repos(
        self,
        controller_with_git,
        mock_git_manager,
        mock_project_store,
        mock_loop_runner,
    ):
        """Git validation is skipped for non-absolute paths (e.g. URLs)."""
        project = ProjectConfig(
            name="Test", repo_url="https://github.com/user/repo.git"
        )
        mock_project_store.get_project.return_value = project
        state = LoopState(project_id="proj123", status=LoopStatus.RUNNING)
        mock_loop_runner.start_loop.return_value = state

        controller_with_git.handle_start_loop("proj123")

        mock_git_manager.validate_repo.assert_not_called()
        mock_loop_runner.start_loop.assert_called_once()

    def test_start_loop_skips_git_check_for_empty_repo_url(
        self,
        controller_with_git,
        mock_git_manager,
        mock_project_store,
        mock_loop_runner,
    ):
        """Git validation is skipped when repo_url is empty."""
        project = ProjectConfig(name="Test", repo_url="")
        mock_project_store.get_project.return_value = project
        state = LoopState(project_id="proj123", status=LoopStatus.RUNNING)
        mock_loop_runner.start_loop.return_value = state

        controller_with_git.handle_start_loop("proj123")

        mock_git_manager.validate_repo.assert_not_called()
        mock_loop_runner.start_loop.assert_called_once()

    def test_start_loop_skips_git_check_when_project_not_found(
        self,
        controller_with_git,
        mock_git_manager,
        mock_project_store,
        mock_loop_runner,
    ):
        """Git validation is skipped when project lookup returns None."""
        mock_project_store.get_project.return_value = None
        state = LoopState(project_id="proj123", status=LoopStatus.RUNNING)
        mock_loop_runner.start_loop.return_value = state

        controller_with_git.handle_start_loop("proj123")

        mock_git_manager.validate_repo.assert_not_called()
        mock_loop_runner.start_loop.assert_called_once()

    def test_start_loop_git_exception_does_not_block(
        self,
        controller_with_git,
        mock_git_manager,
        mock_project_store,
        mock_loop_runner,
        project_with_repo,
    ):
        """If GitManager raises, the loop still starts (best-effort).

        Git validation failures should not prevent loop execution — the check
        is purely advisory.
        """
        mock_project_store.get_project.return_value = project_with_repo
        mock_git_manager.validate_repo.side_effect = OSError("Permission denied")
        state = LoopState(project_id="proj123", status=LoopStatus.RUNNING)
        mock_loop_runner.start_loop.return_value = state

        controller_with_git.handle_start_loop("proj123")

        mock_loop_runner.start_loop.assert_called_once_with(
            "proj123", LoopMode.CONTINUOUS
        )

    def test_start_loop_works_without_git_manager(self, controller, mock_loop_runner):
        """When git_manager is None, handle_start_loop skips the check."""
        state = LoopState(project_id="proj123", status=LoopStatus.RUNNING)
        mock_loop_runner.start_loop.return_value = state

        controller.handle_start_loop("proj123")

        mock_loop_runner.start_loop.assert_called_once_with(
            "proj123", LoopMode.CONTINUOUS
        )


# ---------------------------------------------------------------------------
# Docker image pull pre-check
# ---------------------------------------------------------------------------


class TestImagePullPreCheck:
    """Verify that handle_start_loop checks for the Docker image locally
    and offers to pull it when it's missing.
    """

    @pytest.fixture
    def project_with_image(self):
        return ProjectConfig(
            name="Test",
            repo_url="https://github.com/test/repo",
            docker_image="myapp:latest",
        )

    def test_image_already_available_starts_loop(
        self,
        controller,
        mock_docker_manager,
        mock_project_store,
        mock_loop_runner,
        project_with_image,
    ):
        """When the image exists locally, loop starts normally — no pull dialog."""
        mock_docker_manager.is_docker_available.return_value = True
        mock_docker_manager.is_image_available.return_value = True
        mock_project_store.get_project.return_value = project_with_image
        state = LoopState(project_id="proj123", status=LoopStatus.RUNNING)
        mock_loop_runner.start_loop.return_value = state

        controller.handle_start_loop("proj123")

        mock_docker_manager.is_image_available.assert_called_once_with("myapp:latest")
        mock_docker_manager.pull_image.assert_not_called()
        mock_loop_runner.start_loop.assert_called_once_with(
            "proj123", LoopMode.CONTINUOUS
        )

    @patch("src.lib.app_controller.QProgressDialog")
    @patch("src.lib.app_controller.QMessageBox")
    def test_image_missing_user_accepts_pull_succeeds(
        self,
        MockMsgBox,
        MockProgressDialog,
        controller,
        mock_docker_manager,
        mock_project_store,
        mock_loop_runner,
        project_with_image,
    ):
        """Image not available, user accepts pull, pull succeeds — loop starts."""
        mock_docker_manager.is_docker_available.return_value = True
        mock_docker_manager.is_image_available.return_value = False
        mock_project_store.get_project.return_value = project_with_image
        MockMsgBox.StandardButton = QMessageBox.StandardButton
        MockMsgBox.question.return_value = QMessageBox.StandardButton.Yes

        # Progress dialog mock
        progress_instance = MockProgressDialog.return_value
        progress_instance.wasCanceled.return_value = False

        state = LoopState(project_id="proj123", status=LoopStatus.RUNNING)
        mock_loop_runner.start_loop.return_value = state

        controller.handle_start_loop("proj123")

        mock_docker_manager.pull_image.assert_called_once_with("myapp:latest")
        mock_loop_runner.start_loop.assert_called_once_with(
            "proj123", LoopMode.CONTINUOUS
        )

    @patch("src.lib.app_controller.QMessageBox")
    def test_image_missing_user_declines_pull(
        self,
        MockMsgBox,
        controller,
        mock_docker_manager,
        mock_project_store,
        mock_loop_runner,
        project_with_image,
    ):
        """Image not available, user declines pull — loop not started."""
        mock_docker_manager.is_docker_available.return_value = True
        mock_docker_manager.is_image_available.return_value = False
        mock_project_store.get_project.return_value = project_with_image
        MockMsgBox.StandardButton = QMessageBox.StandardButton
        MockMsgBox.question.return_value = QMessageBox.StandardButton.No

        controller.handle_start_loop("proj123")

        mock_docker_manager.pull_image.assert_not_called()
        mock_loop_runner.start_loop.assert_not_called()

    @patch("src.lib.app_controller.QProgressDialog")
    @patch("src.lib.app_controller.QMessageBox")
    def test_image_missing_pull_fails_shows_error(
        self,
        MockMsgBox,
        MockProgressDialog,
        controller,
        mock_docker_manager,
        mock_project_store,
        mock_loop_runner,
        project_with_image,
    ):
        """Image not available, user accepts pull, pull fails — error shown."""
        mock_docker_manager.is_docker_available.return_value = True
        mock_docker_manager.is_image_available.return_value = False
        mock_project_store.get_project.return_value = project_with_image
        MockMsgBox.StandardButton = QMessageBox.StandardButton
        MockMsgBox.question.return_value = QMessageBox.StandardButton.Yes

        progress_instance = MockProgressDialog.return_value
        progress_instance.wasCanceled.return_value = False

        mock_docker_manager.pull_image.side_effect = Exception("Network error")

        controller.handle_start_loop("proj123")

        MockMsgBox.critical.assert_called_once()
        args = MockMsgBox.critical.call_args[0]
        assert "Image Pull Failed" in args[1]
        assert "Network error" in args[2]
        mock_loop_runner.start_loop.assert_not_called()

    def test_image_check_skipped_when_docker_unavailable(
        self,
        controller,
        mock_docker_manager,
        mock_project_store,
        mock_loop_runner,
        project_with_image,
    ):
        """When Docker is unavailable, image check is skipped entirely."""
        mock_docker_manager.is_docker_available.return_value = False
        mock_project_store.get_project.return_value = project_with_image
        state = LoopState(project_id="proj123", status=LoopStatus.RUNNING)
        mock_loop_runner.start_loop.return_value = state

        controller.handle_start_loop("proj123")

        mock_docker_manager.is_image_available.assert_not_called()
        mock_loop_runner.start_loop.assert_called_once_with(
            "proj123", LoopMode.CONTINUOUS
        )

    def test_image_check_exception_does_not_block_loop(
        self,
        controller,
        mock_docker_manager,
        mock_project_store,
        mock_loop_runner,
        project_with_image,
    ):
        """If the image check raises, the loop still starts (best-effort)."""
        mock_docker_manager.is_docker_available.return_value = True
        mock_docker_manager.is_image_available.side_effect = Exception("Unexpected")
        mock_project_store.get_project.return_value = project_with_image
        state = LoopState(project_id="proj123", status=LoopStatus.RUNNING)
        mock_loop_runner.start_loop.return_value = state

        controller.handle_start_loop("proj123")

        mock_loop_runner.start_loop.assert_called_once_with(
            "proj123", LoopMode.CONTINUOUS
        )


# ---------------------------------------------------------------------------
# TerminalBridge wiring
# ---------------------------------------------------------------------------


class TestTerminalBridgeWiring:
    """Verify TerminalBridge is wired into AppController correctly.

    The terminal bridge connects xterm.js terminal sessions to Docker exec
    PTYs.  AppController must:
    - Accept and store the terminal_bridge parameter
    - Wire terminal_tab signals to the bridge in setup_connections()
    - Wire bridge signals back to the UI
    - Call bridge.stop() in shutdown()
    - Populate the terminal_tab container dropdown via _refresh_terminal_tab()
    """

    @pytest.fixture
    def mock_terminal_bridge(self):
        from src.lib.terminal_bridge import TerminalBridge

        bridge = MagicMock(spec=TerminalBridge)
        # Provide real PyQt signal-like mocks for connect() calls
        bridge.session_ready = MagicMock()
        bridge.session_ended = MagicMock()
        return bridge

    @pytest.fixture
    def controller_with_bridge(
        self,
        main_window,
        mock_project_store,
        mock_docker_manager,
        mock_loop_runner,
        mock_credential_manager,
        mock_config_manager,
        mock_terminal_bridge,
    ):
        return AppController(
            main_window=main_window,
            project_store=mock_project_store,
            docker_manager=mock_docker_manager,
            loop_runner=mock_loop_runner,
            credential_manager=mock_credential_manager,
            config_manager=mock_config_manager,
            terminal_bridge=mock_terminal_bridge,
        )

    def test_terminal_bridge_stored_on_controller(
        self, controller_with_bridge, mock_terminal_bridge
    ):
        """The terminal bridge is accessible via the controller."""
        assert controller_with_bridge._terminal_bridge is mock_terminal_bridge

    def test_terminal_bridge_default_is_none(self, controller):
        """Without explicit terminal_bridge, the attribute is None."""
        assert controller._terminal_bridge is None

    def test_setup_connects_bridge_signals(
        self, controller_with_bridge, mock_terminal_bridge
    ):
        """setup_connections wires session_ready and session_ended signals."""
        controller_with_bridge.setup_connections()
        mock_terminal_bridge.session_ready.connect.assert_called_once()
        mock_terminal_bridge.session_ended.connect.assert_called_once()

    def test_setup_no_bridge_signals_without_bridge(self, controller):
        """When no bridge is provided, setup_connections does not fail."""
        controller.setup_connections()  # Should not raise

    def test_terminal_tab_signals_connected(
        self, controller_with_bridge, main_window
    ):
        """setup_connections wires terminal_tab.terminal_requested signal."""
        tab = main_window.terminal_tab
        before = tab.receivers(tab.terminal_requested)
        controller_with_bridge.setup_connections()
        assert tab.receivers(tab.terminal_requested) > before

    def test_terminal_tab_close_signal_connected(
        self, controller_with_bridge, main_window
    ):
        """setup_connections wires terminal_tab.session_close_requested signal."""
        tab = main_window.terminal_tab
        before = tab.receivers(tab.session_close_requested)
        controller_with_bridge.setup_connections()
        assert tab.receivers(tab.session_close_requested) > before

    def test_handle_open_terminal_calls_bridge(
        self, controller_with_bridge, mock_terminal_bridge
    ):
        """_handle_open_terminal delegates to bridge.open_session."""
        controller_with_bridge._handle_open_terminal("container123", "MyProject")
        mock_terminal_bridge.open_session.assert_called_once_with(
            "container123", "MyProject"
        )

    def test_handle_open_terminal_no_bridge_does_not_raise(self, controller):
        """_handle_open_terminal is safe when no bridge is configured."""
        controller._handle_open_terminal("c1", "p1")  # Should not raise

    def test_handle_close_terminal_calls_bridge(
        self, controller_with_bridge, mock_terminal_bridge
    ):
        """_handle_close_terminal delegates to bridge.close_session."""
        controller_with_bridge._handle_close_terminal("session-abc")
        mock_terminal_bridge.close_session.assert_called_once_with("session-abc")

    def test_handle_close_terminal_no_bridge_does_not_raise(self, controller):
        """_handle_close_terminal is safe when no bridge is configured."""
        controller._handle_close_terminal("s1")  # Should not raise

    def test_on_session_ready_adds_tab(
        self, controller_with_bridge, main_window, qtbot
    ):
        """_on_session_ready adds a session to the terminal tab."""
        before = main_window.terminal_tab.session_tabs.count()
        controller_with_bridge._on_session_ready("sess-1", 9001, "root")
        assert main_window.terminal_tab.session_tabs.count() > before

    def test_on_session_ended_removes_tab(
        self, controller_with_bridge, main_window, qtbot
    ):
        """_on_session_ended removes a session tab from the terminal tab."""
        controller_with_bridge._on_session_ready("sess-2", 9002, "root")
        before = main_window.terminal_tab.session_tabs.count()
        controller_with_bridge._on_session_ended("sess-2")
        assert main_window.terminal_tab.session_tabs.count() < before

    def test_shutdown_stops_bridge(
        self, controller_with_bridge, mock_terminal_bridge
    ):
        """shutdown() calls stop() on the terminal bridge."""
        controller_with_bridge.shutdown()
        mock_terminal_bridge.stop.assert_called_once()

    def test_shutdown_without_bridge(self, controller):
        """shutdown() is safe when no terminal bridge is provided."""
        controller.shutdown()  # Should not raise

    def test_refresh_terminal_tab_populates_containers(
        self, controller_with_bridge, mock_docker_manager, main_window
    ):
        """_refresh_terminal_tab passes running containers to terminal_tab."""
        containers = [
            {"id": "abc123", "name": "my-container"},
            {"id": "def456", "name": "other-container"},
        ]
        mock_docker_manager.list_running_containers.return_value = containers

        controller_with_bridge._refresh_terminal_tab()

        # Verify combo box has entries for both containers
        combo = main_window.terminal_tab.container_combo
        assert combo.count() == 2

    def test_refresh_terminal_tab_handles_exception(
        self, controller_with_bridge, mock_docker_manager
    ):
        """_refresh_terminal_tab does not crash when Docker call raises."""
        mock_docker_manager.list_running_containers.side_effect = Exception("Docker error")
        controller_with_bridge._refresh_terminal_tab()  # Should not raise

    def test_refresh_all_includes_terminal_tab(
        self, controller_with_bridge, mock_docker_manager
    ):
        """refresh_all() also calls _refresh_terminal_tab."""
        mock_docker_manager.list_running_containers.return_value = []
        controller_with_bridge.refresh_all()
        mock_docker_manager.list_running_containers.assert_called_once()
