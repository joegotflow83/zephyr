"""Integration tests for the UI with qtbot.

Tests the full UI flow with mocked backend services: launching MainWindow,
adding projects via dialogs, verifying table population, switching tabs,
checking loop state reflection, and settings propagation.

Why UI integration tests matter:
    Unit tests verify individual widgets in isolation, but can't catch
    wiring issues between the MainWindow, its tabs, the AppController,
    and the backend services. These tests exercise the real signal/slot
    connections and data flow paths that users experience, using qtbot
    for headless Qt event loop simulation and mocked backends to avoid
    Docker/keyring/filesystem side effects.
"""

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from src.lib.app_controller import AppController
from src.lib.config_manager import ConfigManager
from src.lib.credential_manager import CredentialManager
from src.lib.loop_runner import LoopMode, LoopRunner, LoopState, LoopStatus
from src.lib.models import AppSettings, ProjectConfig
from src.lib.project_store import ProjectStore
from src.ui.main_window import MainWindow

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def config_dir(tmp_path):
    """Provide a fresh temp config directory."""
    return tmp_path / "zephyr-config"


@pytest.fixture
def config_manager(config_dir):
    """ConfigManager backed by a temp directory."""
    cm = ConfigManager(config_dir=config_dir)
    cm.ensure_config_dir()
    return cm


@pytest.fixture
def project_store(config_manager):
    """ProjectStore wired to the temp ConfigManager."""
    return ProjectStore(config_manager)


@pytest.fixture
def mock_keyring():
    """Mock keyring to avoid real system keyring access."""
    store = {}
    with patch("src.lib.credential_manager.keyring") as mock_kr:
        mock_kr.set_password = MagicMock(
            side_effect=lambda svc, name, pwd: store.update({(svc, name): pwd})
        )
        mock_kr.get_password = MagicMock(
            side_effect=lambda svc, name: store.get((svc, name))
        )
        mock_kr.delete_password = MagicMock(
            side_effect=lambda svc, name: store.pop((svc, name), None)
        )
        yield mock_kr


@pytest.fixture
def credential_manager(config_manager, mock_keyring):
    """CredentialManager with mocked keyring."""
    return CredentialManager(config_manager)


@pytest.fixture
def mock_docker_manager():
    """Fully mocked DockerManager."""
    dm = MagicMock()
    dm.is_docker_available.return_value = True
    dm.get_docker_info.return_value = {"ServerVersion": "24.0.0"}
    dm.is_image_available.return_value = True
    dm.create_container.return_value = "mock-container-id"
    dm.start_container.return_value = None
    dm.stop_container.return_value = None
    dm.remove_container.return_value = None
    dm.get_container_status.return_value = "running"
    dm.list_running_containers.return_value = []
    dm.stream_logs.return_value = MagicMock()  # returns a thread
    dm.get_logs.return_value = ""
    return dm


@pytest.fixture
def mock_loop_runner():
    """Mocked LoopRunner with controllable state."""
    runner = MagicMock(spec=LoopRunner)
    runner.get_all_states.return_value = {}
    runner.get_loop_state.return_value = None
    return runner


@pytest.fixture
def main_window(qtbot):
    """Create and show the MainWindow for testing."""
    window = MainWindow()
    qtbot.addWidget(window)
    window.show()
    qtbot.waitExposed(window)
    return window


@pytest.fixture
def app_controller(
    main_window,
    project_store,
    mock_docker_manager,
    mock_loop_runner,
    credential_manager,
    config_manager,
):
    """AppController wired to real MainWindow and mocked backends."""
    ctrl = AppController(
        main_window=main_window,
        project_store=project_store,
        docker_manager=mock_docker_manager,
        loop_runner=mock_loop_runner,
        credential_manager=credential_manager,
        config_manager=config_manager,
    )
    ctrl.setup_connections()
    ctrl.refresh_all()
    return ctrl


@pytest.fixture
def sample_project():
    """A sample ProjectConfig for testing."""
    return ProjectConfig(
        name="Test Project",
        repo_url="https://github.com/example/test",
        id="proj-001",
        jtbd="Build a test app",
        docker_image="ubuntu:24.04",
    )


@pytest.fixture
def sample_project_b():
    """A second sample ProjectConfig for multi-project tests."""
    return ProjectConfig(
        name="Project Beta",
        repo_url="https://github.com/example/beta",
        id="proj-002",
        jtbd="Run beta tests",
        docker_image="python:3.12",
    )


# ---------------------------------------------------------------------------
# Test Class: MainWindow structure
# ---------------------------------------------------------------------------


class TestMainWindowStructure:
    """Verify the MainWindow has correct tabs, menus, and status bar."""

    def test_window_title(self, main_window):
        assert main_window.windowTitle() == "Zephyr Desktop"

    def test_three_tabs_exist(self, main_window):
        assert main_window.tab_widget.count() == 3

    def test_tab_labels(self, main_window):
        labels = [
            main_window.tab_widget.tabText(i)
            for i in range(main_window.tab_widget.count())
        ]
        assert labels == ["Projects", "Running Loops", "Settings"]

    def test_projects_tab_is_first(self, main_window):
        assert main_window.tab_widget.currentIndex() == 0

    def test_menu_actions_exist(self, main_window):
        assert main_window.import_action is not None
        assert main_window.export_action is not None
        assert main_window.quit_action is not None
        assert main_window.about_action is not None

    def test_docker_status_label_exists(self, main_window):
        assert main_window.docker_status_label is not None
        assert "Docker" in main_window.docker_status_label.text()

    def test_set_docker_status_connected(self, main_window):
        main_window.set_docker_status(True)
        assert main_window.docker_status_label.text() == "Docker: Connected"

    def test_set_docker_status_disconnected(self, main_window):
        main_window.set_docker_status(False)
        assert main_window.docker_status_label.text() == "Docker: Disconnected"

    def test_minimum_size(self, main_window):
        assert main_window.minimumWidth() == 900
        assert main_window.minimumHeight() == 600


# ---------------------------------------------------------------------------
# Test Class: Projects tab with controller wiring
# ---------------------------------------------------------------------------


class TestProjectsTabIntegration:
    """Test project management through the wired UI-controller pipeline."""

    def test_initial_projects_table_empty(self, app_controller, main_window):
        table = main_window.projects_tab.table
        assert table.rowCount() == 0

    def test_add_project_appears_in_table(
        self, app_controller, main_window, project_store, sample_project
    ):
        """Adding a project through the store and refreshing shows it in the table."""
        project_store.add_project(sample_project)
        app_controller.refresh_all()

        table = main_window.projects_tab.table
        assert table.rowCount() == 1
        assert table.item(0, 0).text() == "Test Project"
        assert table.item(0, 1).text() == "https://github.com/example/test"
        assert table.item(0, 2).text() == "ubuntu:24.04"
        assert table.item(0, 3).text() == "Idle"

    def test_multiple_projects_in_table(
        self,
        app_controller,
        main_window,
        project_store,
        sample_project,
        sample_project_b,
    ):
        project_store.add_project(sample_project)
        project_store.add_project(sample_project_b)
        app_controller.refresh_all()

        table = main_window.projects_tab.table
        assert table.rowCount() == 2
        names = {table.item(r, 0).text() for r in range(2)}
        assert names == {"Test Project", "Project Beta"}

    def test_project_status_reflects_loop_state(
        self,
        app_controller,
        main_window,
        project_store,
        sample_project,
        mock_loop_runner,
    ):
        """When a loop is running, the projects table shows its status."""
        project_store.add_project(sample_project)
        mock_loop_runner.get_all_states.return_value = {
            "proj-001": LoopState(
                project_id="proj-001",
                status=LoopStatus.RUNNING,
                mode=LoopMode.CONTINUOUS,
            )
        }
        app_controller.refresh_all()

        table = main_window.projects_tab.table
        assert table.item(0, 3).text() == "Running"

    def test_edit_project_persists(
        self,
        app_controller,
        main_window,
        project_store,
        sample_project,
    ):
        """Editing a project through the store and refreshing updates the table."""
        project_store.add_project(sample_project)
        app_controller.refresh_all()
        assert main_window.projects_tab.table.item(0, 0).text() == "Test Project"

        sample_project.name = "Updated Project"
        project_store.update_project(sample_project)
        app_controller.refresh_all()
        assert main_window.projects_tab.table.item(0, 0).text() == "Updated Project"

    def test_delete_project_removes_from_table(
        self,
        app_controller,
        main_window,
        project_store,
        sample_project,
    ):
        project_store.add_project(sample_project)
        app_controller.refresh_all()
        assert main_window.projects_tab.table.rowCount() == 1

        project_store.remove_project(sample_project.id)
        app_controller.refresh_all()
        assert main_window.projects_tab.table.rowCount() == 0

    def test_add_button_emits_signal(self, qtbot, main_window):
        """Clicking Add Project button emits project_add_requested signal.

        Uses a bare MainWindow (no controller) to avoid modal dialogs.
        """
        received = []
        main_window.projects_tab.project_add_requested.connect(
            lambda: received.append(True)
        )
        main_window.projects_tab.add_button.click()
        assert len(received) == 1

    def test_edit_button_emits_signal(
        self,
        qtbot,
        main_window,
        sample_project,
    ):
        """Clicking Edit on a project row emits project_edit_requested."""
        main_window.projects_tab.refresh([sample_project])

        received = []
        main_window.projects_tab.project_edit_requested.connect(
            lambda pid: received.append(pid)
        )

        from PyQt6.QtWidgets import QPushButton

        edit_btn = main_window.projects_tab.table.cellWidget(0, 4).findChild(
            QPushButton, f"edit_btn_{sample_project.id}"
        )
        edit_btn.click()
        assert received == [sample_project.id]

    def test_delete_button_emits_signal(
        self,
        qtbot,
        main_window,
        sample_project,
    ):
        """Clicking Delete on a project row emits project_delete_requested."""
        main_window.projects_tab.refresh([sample_project])

        received = []
        main_window.projects_tab.project_delete_requested.connect(
            lambda pid: received.append(pid)
        )

        from PyQt6.QtWidgets import QPushButton

        delete_btn = main_window.projects_tab.table.cellWidget(0, 4).findChild(
            QPushButton, f"delete_btn_{sample_project.id}"
        )
        delete_btn.click()
        assert received == [sample_project.id]

    def test_run_button_emits_signal(
        self,
        qtbot,
        main_window,
        sample_project,
    ):
        """Clicking Run on a project row emits project_run_requested."""
        main_window.projects_tab.refresh([sample_project])

        received = []
        main_window.projects_tab.project_run_requested.connect(
            lambda pid: received.append(pid)
        )

        from PyQt6.QtWidgets import QPushButton

        run_btn = main_window.projects_tab.table.cellWidget(0, 4).findChild(
            QPushButton, f"run_btn_{sample_project.id}"
        )
        run_btn.click()
        assert received == [sample_project.id]

    def test_project_table_columns(self, main_window):
        table = main_window.projects_tab.table
        headers = [
            table.horizontalHeaderItem(c).text() for c in range(table.columnCount())
        ]
        assert headers == ["Name", "Repo URL", "Docker Image", "Status", "Actions"]


# ---------------------------------------------------------------------------
# Test Class: Loops tab with controller wiring
# ---------------------------------------------------------------------------


class TestLoopsTabIntegration:
    """Test loop state display and log viewer through the wired pipeline."""

    def test_initial_loops_table_empty(self, app_controller, main_window):
        assert main_window.loops_tab.table.rowCount() == 0

    def test_loop_states_populate_table(
        self,
        app_controller,
        main_window,
        project_store,
        sample_project,
        mock_loop_runner,
    ):
        """Loop states from the runner appear in the loops table."""
        project_store.add_project(sample_project)
        mock_loop_runner.get_all_states.return_value = {
            "proj-001": LoopState(
                project_id="proj-001",
                status=LoopStatus.RUNNING,
                mode=LoopMode.CONTINUOUS,
                iteration=3,
                started_at="2025-01-01T00:00:00+00:00",
            )
        }
        app_controller.refresh_all()

        table = main_window.loops_tab.table
        assert table.rowCount() == 1
        assert table.item(0, 0).text() == "Test Project"
        assert table.item(0, 1).text() == "running"
        assert table.item(0, 2).text() == "continuous"
        assert table.item(0, 3).text() == "3"

    def test_multiple_loop_states(
        self,
        app_controller,
        main_window,
        project_store,
        sample_project,
        sample_project_b,
        mock_loop_runner,
    ):
        project_store.add_project(sample_project)
        project_store.add_project(sample_project_b)
        mock_loop_runner.get_all_states.return_value = {
            "proj-001": LoopState(
                project_id="proj-001",
                status=LoopStatus.RUNNING,
                mode=LoopMode.CONTINUOUS,
            ),
            "proj-002": LoopState(
                project_id="proj-002",
                status=LoopStatus.COMPLETED,
                mode=LoopMode.SINGLE,
                iteration=1,
            ),
        }
        app_controller.refresh_all()

        table = main_window.loops_tab.table
        assert table.rowCount() == 2

    def test_loop_start_button_disabled_when_running(
        self,
        app_controller,
        main_window,
        project_store,
        sample_project,
        mock_loop_runner,
    ):
        project_store.add_project(sample_project)
        mock_loop_runner.get_all_states.return_value = {
            "proj-001": LoopState(
                project_id="proj-001",
                status=LoopStatus.RUNNING,
                mode=LoopMode.CONTINUOUS,
            )
        }
        app_controller.refresh_all()

        from PyQt6.QtWidgets import QPushButton

        start_btn = main_window.loops_tab.table.cellWidget(0, 5).findChild(
            QPushButton, "start_btn_proj-001"
        )
        assert start_btn is not None
        assert not start_btn.isEnabled()

    def test_loop_stop_button_enabled_when_running(
        self,
        app_controller,
        main_window,
        project_store,
        sample_project,
        mock_loop_runner,
    ):
        project_store.add_project(sample_project)
        mock_loop_runner.get_all_states.return_value = {
            "proj-001": LoopState(
                project_id="proj-001",
                status=LoopStatus.RUNNING,
                mode=LoopMode.CONTINUOUS,
            )
        }
        app_controller.refresh_all()

        from PyQt6.QtWidgets import QPushButton

        stop_btn = main_window.loops_tab.table.cellWidget(0, 5).findChild(
            QPushButton, "stop_btn_proj-001"
        )
        assert stop_btn is not None
        assert stop_btn.isEnabled()

    def test_loop_stop_button_disabled_when_completed(
        self,
        app_controller,
        main_window,
        project_store,
        sample_project,
        mock_loop_runner,
    ):
        project_store.add_project(sample_project)
        mock_loop_runner.get_all_states.return_value = {
            "proj-001": LoopState(
                project_id="proj-001",
                status=LoopStatus.COMPLETED,
                mode=LoopMode.SINGLE,
            )
        }
        app_controller.refresh_all()

        from PyQt6.QtWidgets import QPushButton

        stop_btn = main_window.loops_tab.table.cellWidget(0, 5).findChild(
            QPushButton, "stop_btn_proj-001"
        )
        assert not stop_btn.isEnabled()

    def test_log_append_shows_in_viewer_when_selected(
        self,
        qtbot,
        app_controller,
        main_window,
        project_store,
        sample_project,
        mock_loop_runner,
    ):
        """Appending logs for the selected project shows in the log viewer."""
        project_store.add_project(sample_project)
        mock_loop_runner.get_all_states.return_value = {
            "proj-001": LoopState(
                project_id="proj-001",
                status=LoopStatus.RUNNING,
                mode=LoopMode.CONTINUOUS,
            )
        }
        app_controller.refresh_all()

        # Select the first row
        main_window.loops_tab.table.selectRow(0)
        qtbot.wait(50)

        # Append log lines
        main_window.loops_tab.append_log("proj-001", "Starting iteration 1...")
        main_window.loops_tab.append_log("proj-001", "Build complete.")

        text = main_window.loops_tab.log_viewer.toPlainText()
        assert "Starting iteration 1..." in text
        assert "Build complete." in text

    def test_log_not_shown_for_unselected_project(
        self,
        qtbot,
        app_controller,
        main_window,
        project_store,
        sample_project,
        sample_project_b,
        mock_loop_runner,
    ):
        """Logs for non-selected projects are buffered but not displayed."""
        project_store.add_project(sample_project)
        project_store.add_project(sample_project_b)
        mock_loop_runner.get_all_states.return_value = {
            "proj-001": LoopState(
                project_id="proj-001",
                status=LoopStatus.RUNNING,
                mode=LoopMode.CONTINUOUS,
            ),
            "proj-002": LoopState(
                project_id="proj-002",
                status=LoopStatus.RUNNING,
                mode=LoopMode.CONTINUOUS,
            ),
        }
        app_controller.refresh_all()

        # Select proj-001
        main_window.loops_tab.table.selectRow(0)
        qtbot.wait(50)

        # Append log to proj-002 (not selected)
        main_window.loops_tab.append_log("proj-002", "Beta log line")

        text = main_window.loops_tab.log_viewer.toPlainText()
        assert "Beta log line" not in text

        # Now select proj-002 — buffered logs should appear
        main_window.loops_tab.table.selectRow(1)
        qtbot.wait(50)

        text = main_window.loops_tab.log_viewer.toPlainText()
        assert "Beta log line" in text

    def test_clear_log_clears_buffer_and_viewer(
        self,
        qtbot,
        app_controller,
        main_window,
        project_store,
        sample_project,
        mock_loop_runner,
    ):
        project_store.add_project(sample_project)
        mock_loop_runner.get_all_states.return_value = {
            "proj-001": LoopState(
                project_id="proj-001",
                status=LoopStatus.RUNNING,
                mode=LoopMode.CONTINUOUS,
            )
        }
        app_controller.refresh_all()

        main_window.loops_tab.table.selectRow(0)
        qtbot.wait(50)

        main_window.loops_tab.append_log("proj-001", "Some log line")
        assert "Some log line" in main_window.loops_tab.log_viewer.toPlainText()

        main_window.loops_tab.clear_log("proj-001")
        assert main_window.loops_tab.log_viewer.toPlainText() == ""

    def test_loops_table_columns(self, main_window):
        table = main_window.loops_tab.table
        headers = [
            table.horizontalHeaderItem(c).text() for c in range(table.columnCount())
        ]
        assert headers == [
            "Project",
            "Status",
            "Mode",
            "Iteration",
            "Started",
            "Actions",
        ]


# ---------------------------------------------------------------------------
# Test Class: Settings tab with controller wiring
# ---------------------------------------------------------------------------


class TestSettingsTabIntegration:
    """Test settings display and persistence through the wired pipeline."""

    def test_default_settings_loaded(self, app_controller, main_window):
        settings_tab = main_window.settings_tab
        assert settings_tab.max_containers_spin.value() == 5
        assert settings_tab.notification_checkbox.isChecked() is True
        assert settings_tab.log_level_combo.currentText() == "INFO"

    def test_settings_loaded_from_config(
        self,
        app_controller,
        main_window,
        config_manager,
    ):
        """Settings saved to config are loaded into the UI."""
        settings = AppSettings(
            max_concurrent_containers=3,
            notification_enabled=False,
            log_level="DEBUG",
        )
        config_manager.save_json("settings.json", settings.to_dict())
        app_controller.refresh_all()

        st = main_window.settings_tab
        assert st.max_containers_spin.value() == 3
        assert st.notification_checkbox.isChecked() is False
        assert st.log_level_combo.currentText() == "DEBUG"

    def test_settings_change_persists_to_config(
        self,
        qtbot,
        app_controller,
        main_window,
        config_manager,
    ):
        """Changing a setting in the UI triggers persistence to config file."""
        st = main_window.settings_tab

        # Change the max containers setting
        with qtbot.waitSignal(st.settings_changed, timeout=1000):
            st.max_containers_spin.setValue(7)

        # Verify it was persisted
        data = config_manager.load_json("settings.json")
        assert data["max_concurrent_containers"] == 7

    def test_notification_toggle_persists(
        self,
        qtbot,
        app_controller,
        main_window,
        config_manager,
    ):
        st = main_window.settings_tab

        with qtbot.waitSignal(st.settings_changed, timeout=1000):
            st.notification_checkbox.setChecked(False)

        data = config_manager.load_json("settings.json")
        assert data["notification_enabled"] is False

    def test_log_level_change_persists(
        self,
        qtbot,
        app_controller,
        main_window,
        config_manager,
    ):
        st = main_window.settings_tab

        with qtbot.waitSignal(st.settings_changed, timeout=1000):
            st.log_level_combo.setCurrentText("WARNING")

        data = config_manager.load_json("settings.json")
        assert data["log_level"] == "WARNING"

    def test_docker_status_in_settings(self, app_controller, main_window):
        """Docker status is reflected in the settings tab."""
        st = main_window.settings_tab
        assert st.docker_status_label.text() == "Connected"

    def test_docker_disconnected_in_settings(
        self,
        app_controller,
        main_window,
        mock_docker_manager,
    ):
        mock_docker_manager.is_docker_available.return_value = False
        app_controller.refresh_all()

        st = main_window.settings_tab
        assert st.docker_status_label.text() == "Disconnected"

    def test_spin_box_range(self, main_window):
        spin = main_window.settings_tab.max_containers_spin
        assert spin.minimum() == 1
        assert spin.maximum() == 10

    def test_credential_buttons_exist(self, main_window):
        st = main_window.settings_tab
        for service in ("anthropic", "openai", "github"):
            btn = st.findChild(
                type(main_window.projects_tab.add_button),
                f"update_key_{service}",
            )
            assert btn is not None, f"Missing update key button for {service}"

    def test_credential_update_signal(self, qtbot, main_window):
        """Clicking Update Key for a service emits credential_update_requested.

        Uses bare MainWindow (no controller) to avoid modal credential dialog.
        """
        from PyQt6.QtWidgets import QPushButton

        st = main_window.settings_tab
        btn = st.findChild(QPushButton, "update_key_anthropic")

        received = []
        st.credential_update_requested.connect(lambda svc: received.append(svc))
        btn.click()
        assert received == ["anthropic"]

    def test_about_label_present(self, main_window):
        st = main_window.settings_tab
        from src.lib._version import __version__

        assert f"v{__version__}" in st.about_label.text()


# ---------------------------------------------------------------------------
# Test Class: Tab switching
# ---------------------------------------------------------------------------


class TestTabSwitching:
    """Verify tab switching behavior and that data persists across tabs."""

    def test_switch_to_loops_tab(self, qtbot, app_controller, main_window):
        main_window.tab_widget.setCurrentIndex(1)
        assert main_window.tab_widget.currentIndex() == 1
        assert main_window.tab_widget.currentWidget() is main_window.loops_tab

    def test_switch_to_settings_tab(self, qtbot, app_controller, main_window):
        main_window.tab_widget.setCurrentIndex(2)
        assert main_window.tab_widget.currentIndex() == 2
        assert main_window.tab_widget.currentWidget() is main_window.settings_tab

    def test_switch_back_to_projects(self, qtbot, app_controller, main_window):
        main_window.tab_widget.setCurrentIndex(2)
        main_window.tab_widget.setCurrentIndex(0)
        assert main_window.tab_widget.currentIndex() == 0
        assert main_window.tab_widget.currentWidget() is main_window.projects_tab

    def test_projects_persist_after_tab_switch(
        self,
        qtbot,
        app_controller,
        main_window,
        project_store,
        sample_project,
    ):
        """Project data remains visible after switching tabs back and forth."""
        project_store.add_project(sample_project)
        app_controller.refresh_all()

        # Switch to settings and back
        main_window.tab_widget.setCurrentIndex(2)
        main_window.tab_widget.setCurrentIndex(0)

        table = main_window.projects_tab.table
        assert table.rowCount() == 1
        assert table.item(0, 0).text() == "Test Project"

    def test_loop_data_persists_after_tab_switch(
        self,
        qtbot,
        app_controller,
        main_window,
        project_store,
        sample_project,
        mock_loop_runner,
    ):
        """Loop states remain visible after switching tabs."""
        project_store.add_project(sample_project)
        mock_loop_runner.get_all_states.return_value = {
            "proj-001": LoopState(
                project_id="proj-001",
                status=LoopStatus.RUNNING,
                mode=LoopMode.CONTINUOUS,
                iteration=5,
            )
        }
        app_controller.refresh_all()

        # Switch away and back
        main_window.tab_widget.setCurrentIndex(0)
        main_window.tab_widget.setCurrentIndex(1)

        table = main_window.loops_tab.table
        assert table.rowCount() == 1
        assert table.item(0, 3).text() == "5"

    def test_settings_persist_after_tab_switch(
        self,
        qtbot,
        app_controller,
        main_window,
    ):
        """Settings values remain after switching tabs."""
        st = main_window.settings_tab
        st._updating = True
        st.max_containers_spin.setValue(8)
        st._updating = False

        main_window.tab_widget.setCurrentIndex(0)
        main_window.tab_widget.setCurrentIndex(2)

        assert st.max_containers_spin.value() == 8


# ---------------------------------------------------------------------------
# Test Class: Controller signal wiring
# ---------------------------------------------------------------------------


class TestControllerWiring:
    """Verify AppController connects signals to the correct handlers."""

    def test_run_button_triggers_start_loop(
        self,
        qtbot,
        app_controller,
        main_window,
        project_store,
        sample_project,
        mock_loop_runner,
    ):
        """Clicking Run in projects tab calls loop_runner.start_loop.

        The Run button triggers handle_start_loop which calls the mocked
        loop runner directly (no modal dialog), so this test is safe.
        """
        project_store.add_project(sample_project)
        app_controller.refresh_all()

        from PyQt6.QtWidgets import QPushButton

        run_btn = main_window.projects_tab.table.cellWidget(0, 4).findChild(
            QPushButton, f"run_btn_{sample_project.id}"
        )
        run_btn.click()

        mock_loop_runner.start_loop.assert_called_once_with(
            sample_project.id, LoopMode.CONTINUOUS
        )

    def test_stop_button_triggers_stop_loop(
        self,
        qtbot,
        app_controller,
        main_window,
        project_store,
        sample_project,
        mock_loop_runner,
    ):
        """Clicking Stop in loops tab calls loop_runner.stop_loop."""
        project_store.add_project(sample_project)
        mock_loop_runner.get_all_states.return_value = {
            "proj-001": LoopState(
                project_id="proj-001",
                status=LoopStatus.RUNNING,
                mode=LoopMode.CONTINUOUS,
            )
        }
        app_controller.refresh_all()

        from PyQt6.QtWidgets import QPushButton

        stop_btn = main_window.loops_tab.table.cellWidget(0, 5).findChild(
            QPushButton, "stop_btn_proj-001"
        )
        stop_btn.click()

        mock_loop_runner.stop_loop.assert_called_once_with("proj-001")

    def test_add_project_handler_opens_dialog(
        self,
        qtbot,
        app_controller,
        main_window,
        project_store,
    ):
        """handle_add_project opens ProjectDialog; accepting it adds the project.

        We mock ProjectDialog to avoid a real modal blocking the test.
        """
        mock_project = ProjectConfig(
            name="Dialog Project",
            repo_url="https://github.com/example/dialog",
            id="proj-dialog",
        )

        with patch("src.lib.app_controller.ProjectDialog") as MockDialog:
            from PyQt6.QtWidgets import QDialog

            instance = MockDialog.return_value
            instance.exec.return_value = QDialog.DialogCode.Accepted
            instance.get_project.return_value = mock_project

            app_controller.handle_add_project()

        projects = project_store.list_projects()
        assert len(projects) == 1
        assert projects[0].name == "Dialog Project"

    def test_delete_project_handler_with_confirmation(
        self,
        qtbot,
        app_controller,
        main_window,
        project_store,
        sample_project,
    ):
        """handle_delete_project removes the project when user confirms.

        We mock QMessageBox.question to simulate user clicking Yes.
        """
        project_store.add_project(sample_project)
        app_controller.refresh_all()
        assert len(project_store.list_projects()) == 1

        from PyQt6.QtWidgets import QMessageBox

        with patch.object(
            QMessageBox, "question", return_value=QMessageBox.StandardButton.Yes
        ):
            app_controller.handle_delete_project(sample_project.id)

        assert len(project_store.list_projects()) == 0

    def test_settings_change_calls_save(
        self,
        qtbot,
        app_controller,
        main_window,
        config_manager,
    ):
        """Changing settings triggers config save via the controller."""
        st = main_window.settings_tab

        with qtbot.waitSignal(st.settings_changed, timeout=1000):
            st.max_containers_spin.setValue(2)

        data = config_manager.load_json("settings.json")
        assert data is not None
        assert data["max_concurrent_containers"] == 2

    def test_refresh_all_updates_docker_status_in_main_window(
        self,
        app_controller,
        main_window,
        mock_docker_manager,
    ):
        mock_docker_manager.is_docker_available.return_value = True
        app_controller.refresh_all()
        assert main_window.docker_status_label.text() == "Docker: Connected"

    def test_refresh_all_updates_docker_status_in_settings(
        self,
        app_controller,
        main_window,
        mock_docker_manager,
    ):
        mock_docker_manager.is_docker_available.return_value = True
        app_controller.refresh_all()
        assert main_window.settings_tab.docker_status_label.text() == "Connected"


# ---------------------------------------------------------------------------
# Test Class: Full workflow end-to-end
# ---------------------------------------------------------------------------


class TestFullWorkflow:
    """End-to-end UI workflow: add project, check loops, change settings."""

    def test_add_project_then_view_loop_state(
        self,
        qtbot,
        app_controller,
        main_window,
        project_store,
        sample_project,
        mock_loop_runner,
    ):
        """Full flow: add project -> start loop -> verify in loops tab."""
        # 1. Add project
        project_store.add_project(sample_project)
        app_controller.refresh_all()

        # Verify in projects tab
        assert main_window.projects_tab.table.rowCount() == 1

        # 2. Simulate loop start
        mock_loop_runner.get_all_states.return_value = {
            "proj-001": LoopState(
                project_id="proj-001",
                status=LoopStatus.RUNNING,
                mode=LoopMode.CONTINUOUS,
                iteration=0,
            )
        }
        app_controller.refresh_all()

        # 3. Switch to loops tab and verify
        main_window.tab_widget.setCurrentIndex(1)
        table = main_window.loops_tab.table
        assert table.rowCount() == 1
        assert table.item(0, 0).text() == "Test Project"
        assert table.item(0, 1).text() == "running"

        # 4. Project status should also show Running
        main_window.tab_widget.setCurrentIndex(0)
        assert main_window.projects_tab.table.item(0, 3).text() == "Running"

    def test_add_project_run_stop_complete_lifecycle(
        self,
        qtbot,
        app_controller,
        main_window,
        project_store,
        sample_project,
        mock_loop_runner,
    ):
        """Full lifecycle: add -> run -> verify running -> stop -> verify stopped."""
        project_store.add_project(sample_project)

        # Phase 1: Running
        mock_loop_runner.get_all_states.return_value = {
            "proj-001": LoopState(
                project_id="proj-001",
                status=LoopStatus.RUNNING,
                mode=LoopMode.CONTINUOUS,
                iteration=2,
            )
        }
        app_controller.refresh_all()

        main_window.tab_widget.setCurrentIndex(1)
        assert main_window.loops_tab.table.item(0, 1).text() == "running"

        # Phase 2: Stopped
        mock_loop_runner.get_all_states.return_value = {
            "proj-001": LoopState(
                project_id="proj-001",
                status=LoopStatus.STOPPED,
                mode=LoopMode.CONTINUOUS,
                iteration=2,
            )
        }
        app_controller.refresh_all()
        assert main_window.loops_tab.table.item(0, 1).text() == "stopped"

    def test_multi_project_multi_tab_workflow(
        self,
        qtbot,
        app_controller,
        main_window,
        project_store,
        sample_project,
        sample_project_b,
        mock_loop_runner,
    ):
        """Two projects with different loop states across all tabs."""
        project_store.add_project(sample_project)
        project_store.add_project(sample_project_b)

        mock_loop_runner.get_all_states.return_value = {
            "proj-001": LoopState(
                project_id="proj-001",
                status=LoopStatus.RUNNING,
                mode=LoopMode.CONTINUOUS,
            ),
            "proj-002": LoopState(
                project_id="proj-002",
                status=LoopStatus.FAILED,
                mode=LoopMode.SINGLE,
                error="Container crashed",
            ),
        }
        app_controller.refresh_all()

        # Projects tab shows 2 projects with statuses
        main_window.tab_widget.setCurrentIndex(0)
        ptable = main_window.projects_tab.table
        assert ptable.rowCount() == 2

        statuses = {ptable.item(r, 3).text() for r in range(2)}
        assert "Running" in statuses
        assert "Failed" in statuses

        # Loops tab shows 2 loops
        main_window.tab_widget.setCurrentIndex(1)
        ltable = main_window.loops_tab.table
        assert ltable.rowCount() == 2

    def test_settings_change_while_loop_running(
        self,
        qtbot,
        app_controller,
        main_window,
        project_store,
        sample_project,
        mock_loop_runner,
        config_manager,
    ):
        """Changing settings while a loop is running works correctly."""
        project_store.add_project(sample_project)
        mock_loop_runner.get_all_states.return_value = {
            "proj-001": LoopState(
                project_id="proj-001",
                status=LoopStatus.RUNNING,
                mode=LoopMode.CONTINUOUS,
            )
        }
        app_controller.refresh_all()

        # Switch to settings and change a value
        main_window.tab_widget.setCurrentIndex(2)
        st = main_window.settings_tab

        with qtbot.waitSignal(st.settings_changed, timeout=1000):
            st.log_level_combo.setCurrentText("ERROR")

        data = config_manager.load_json("settings.json")
        assert data["log_level"] == "ERROR"

        # Loop should still be shown as running
        main_window.tab_widget.setCurrentIndex(1)
        assert main_window.loops_tab.table.item(0, 1).text() == "running"

    def test_log_viewing_across_projects(
        self,
        qtbot,
        app_controller,
        main_window,
        project_store,
        sample_project,
        sample_project_b,
        mock_loop_runner,
    ):
        """Switching between projects in loops tab shows correct logs."""
        project_store.add_project(sample_project)
        project_store.add_project(sample_project_b)
        mock_loop_runner.get_all_states.return_value = {
            "proj-001": LoopState(
                project_id="proj-001",
                status=LoopStatus.RUNNING,
                mode=LoopMode.CONTINUOUS,
            ),
            "proj-002": LoopState(
                project_id="proj-002",
                status=LoopStatus.RUNNING,
                mode=LoopMode.CONTINUOUS,
            ),
        }
        app_controller.refresh_all()

        # Add logs for both projects
        main_window.loops_tab.append_log("proj-001", "Alpha log 1")
        main_window.loops_tab.append_log("proj-001", "Alpha log 2")
        main_window.loops_tab.append_log("proj-002", "Beta log 1")

        # Select proj-001
        main_window.loops_tab.table.selectRow(0)
        qtbot.wait(50)
        text = main_window.loops_tab.log_viewer.toPlainText()
        assert "Alpha log 1" in text
        assert "Alpha log 2" in text
        assert "Beta log 1" not in text

        # Select proj-002
        main_window.loops_tab.table.selectRow(1)
        qtbot.wait(50)
        text = main_window.loops_tab.log_viewer.toPlainText()
        assert "Beta log 1" in text
        assert "Alpha log 1" not in text
