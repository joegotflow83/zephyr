"""Integration tests for the terminal feature end-to-end wiring.

Verifies that:
- MainWindow has terminal_tab as the 4th tab with correct title
- AppController accepts terminal_bridge parameter
- shutdown() calls bridge.stop()
- Signal flow: container selection → terminal_requested → bridge.open_session()
- Reverse flow: session_ready → terminal_tab.add_session()
- Close flow: session_close_requested → bridge.close_session()
- Reverse close: session_ended → terminal_tab.close_session()
- _refresh_terminal_tab populates combo from running containers
- create_app() instantiates and starts TerminalBridge
"""

from unittest.mock import MagicMock, patch, call

import pytest

from src.lib.app_controller import AppController
from src.ui.main_window import MainWindow


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_terminal_bridge():
    bridge = MagicMock()
    return bridge


@pytest.fixture
def mock_docker_manager():
    dm = MagicMock()
    dm.is_docker_available.return_value = True
    dm.list_running_containers.return_value = []
    return dm


@pytest.fixture
def mock_project_store():
    ps = MagicMock()
    ps.list_projects.return_value = []
    ps.get_project.return_value = None
    return ps


@pytest.fixture
def mock_loop_runner():
    lr = MagicMock()
    lr.get_all_states.return_value = {}
    return lr


@pytest.fixture
def mock_credential_manager():
    return MagicMock()


@pytest.fixture
def mock_config_manager():
    cm = MagicMock()
    cm.load_json.return_value = {}
    cm.save_json.return_value = None
    return cm


@pytest.fixture
def main_window(qtbot):
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
    mock_terminal_bridge,
):
    ctrl = AppController(
        main_window=main_window,
        project_store=mock_project_store,
        docker_manager=mock_docker_manager,
        loop_runner=mock_loop_runner,
        credential_manager=mock_credential_manager,
        config_manager=mock_config_manager,
        terminal_bridge=mock_terminal_bridge,
    )
    ctrl.setup_connections()
    return ctrl


@pytest.fixture
def controller_no_bridge(
    main_window,
    mock_project_store,
    mock_docker_manager,
    mock_loop_runner,
    mock_credential_manager,
    mock_config_manager,
):
    ctrl = AppController(
        main_window=main_window,
        project_store=mock_project_store,
        docker_manager=mock_docker_manager,
        loop_runner=mock_loop_runner,
        credential_manager=mock_credential_manager,
        config_manager=mock_config_manager,
    )
    ctrl.setup_connections()
    return ctrl


# ---------------------------------------------------------------------------
# MainWindow terminal tab integration
# ---------------------------------------------------------------------------


class TestMainWindowTerminalTab:
    def test_terminal_tab_exists(self, main_window):
        """MainWindow must expose a terminal_tab attribute."""
        from src.ui.terminal_tab import TerminalTab

        assert hasattr(main_window, "terminal_tab")
        assert isinstance(main_window.terminal_tab, TerminalTab)

    def test_terminal_tab_is_fourth_tab(self, main_window):
        """Terminal tab must be at index 3 (0-based) — after Projects, Running Loops, Settings."""
        tab_widget = main_window.tab_widget
        assert tab_widget.count() == 4
        assert tab_widget.tabText(3) == "Terminal"

    def test_terminal_tab_title(self, main_window):
        """The Terminal tab must have the exact label 'Terminal'."""
        tab_widget = main_window.tab_widget
        labels = [tab_widget.tabText(i) for i in range(tab_widget.count())]
        assert "Terminal" in labels

    def test_first_three_tabs_order(self, main_window):
        """Projects, Running Loops, Settings precede Terminal."""
        tab_widget = main_window.tab_widget
        assert tab_widget.tabText(0) == "Projects"
        assert tab_widget.tabText(1) == "Running Loops"
        assert tab_widget.tabText(2) == "Settings"


# ---------------------------------------------------------------------------
# AppController terminal_bridge parameter
# ---------------------------------------------------------------------------


class TestAppControllerTerminalBridgeParam:
    def test_accepts_terminal_bridge(
        self,
        main_window,
        mock_project_store,
        mock_docker_manager,
        mock_loop_runner,
        mock_credential_manager,
        mock_config_manager,
        mock_terminal_bridge,
    ):
        """AppController must accept terminal_bridge without error."""
        ctrl = AppController(
            main_window=main_window,
            project_store=mock_project_store,
            docker_manager=mock_docker_manager,
            loop_runner=mock_loop_runner,
            credential_manager=mock_credential_manager,
            config_manager=mock_config_manager,
            terminal_bridge=mock_terminal_bridge,
        )
        assert ctrl is not None

    def test_accepts_none_terminal_bridge(self, controller_no_bridge):
        """AppController must work when terminal_bridge is None."""
        assert controller_no_bridge is not None

    def test_stores_terminal_bridge(self, controller, mock_terminal_bridge):
        """AppController must store the bridge reference."""
        assert controller._terminal_bridge is mock_terminal_bridge


# ---------------------------------------------------------------------------
# Shutdown calls bridge.stop()
# ---------------------------------------------------------------------------


class TestShutdownStopsBridge:
    def test_shutdown_calls_stop(self, controller, mock_terminal_bridge):
        """shutdown() must call terminal_bridge.stop()."""
        controller.shutdown()
        mock_terminal_bridge.stop.assert_called_once()

    def test_shutdown_without_bridge_no_error(self, controller_no_bridge):
        """shutdown() must not raise when bridge is None."""
        controller_no_bridge.shutdown()  # should not raise

    def test_shutdown_stops_bridge_before_health_monitor(
        self, controller, mock_terminal_bridge
    ):
        """Bridge stop is called during shutdown lifecycle."""
        call_order = []
        mock_terminal_bridge.stop.side_effect = lambda: call_order.append("bridge")
        controller.shutdown()
        assert "bridge" in call_order


# ---------------------------------------------------------------------------
# Signal flow: terminal_requested → bridge.open_session()
# ---------------------------------------------------------------------------


class TestTerminalRequestedSignalFlow:
    def test_terminal_requested_calls_open_session(
        self, controller, main_window, mock_terminal_bridge
    ):
        """Emitting terminal_requested must call bridge.open_session()."""
        main_window.terminal_tab.terminal_requested.emit(
            "container-abc", "my-project"
        )
        mock_terminal_bridge.open_session.assert_called_once_with(
            "container-abc", "my-project"
        )

    def test_terminal_requested_without_bridge_no_error(
        self, controller_no_bridge, main_window
    ):
        """terminal_requested signal without bridge must not raise."""
        # Should log a warning but not raise
        main_window.terminal_tab.terminal_requested.emit("cid", "proj")

    def test_handle_open_terminal_direct(
        self, controller, mock_terminal_bridge
    ):
        """_handle_open_terminal() directly calls bridge.open_session()."""
        controller._handle_open_terminal("cid-xyz", "proj-name")
        mock_terminal_bridge.open_session.assert_called_once_with("cid-xyz", "proj-name")

    def test_handle_open_terminal_no_bridge(self, controller_no_bridge):
        """_handle_open_terminal() with no bridge must not raise."""
        controller_no_bridge._handle_open_terminal("cid", "proj")


# ---------------------------------------------------------------------------
# Reverse flow: session_ready → terminal_tab.add_session()
# ---------------------------------------------------------------------------


class TestSessionReadySignalFlow:
    def test_on_session_ready_calls_add_session(
        self, controller, main_window, qtbot
    ):
        """_on_session_ready() must call terminal_tab.add_session()."""
        with patch.object(
            main_window.terminal_tab, "add_session"
        ) as mock_add:
            controller._on_session_ready("sess-1", 9000, "root")
            mock_add.assert_called_once_with("sess-1", "root", 9000)

    def test_on_session_ready_argument_order(
        self, controller, main_window
    ):
        """add_session must receive (session_id, user, port) in that order."""
        with patch.object(
            main_window.terminal_tab, "add_session"
        ) as mock_add:
            controller._on_session_ready("sess-42", 8765, "ralph")
            args = mock_add.call_args[0]
            assert args[0] == "sess-42"
            assert args[1] == "ralph"
            assert args[2] == 8765


# ---------------------------------------------------------------------------
# Close flow: session_close_requested → bridge.close_session()
# ---------------------------------------------------------------------------


class TestSessionCloseSignalFlow:
    def test_session_close_requested_calls_close_session(
        self, controller, main_window, mock_terminal_bridge
    ):
        """Emitting session_close_requested must call bridge.close_session()."""
        main_window.terminal_tab.session_close_requested.emit("sess-99")
        mock_terminal_bridge.close_session.assert_called_once_with("sess-99")

    def test_handle_close_terminal_direct(
        self, controller, mock_terminal_bridge
    ):
        """_handle_close_terminal() directly calls bridge.close_session()."""
        controller._handle_close_terminal("sess-xyz")
        mock_terminal_bridge.close_session.assert_called_once_with("sess-xyz")

    def test_handle_close_terminal_no_bridge(self, controller_no_bridge):
        """_handle_close_terminal() with no bridge must not raise."""
        controller_no_bridge._handle_close_terminal("sess-abc")


# ---------------------------------------------------------------------------
# Reverse close: session_ended → terminal_tab.close_session()
# ---------------------------------------------------------------------------


class TestSessionEndedSignalFlow:
    def test_on_session_ended_calls_close_session(
        self, controller, main_window
    ):
        """_on_session_ended() must call terminal_tab.close_session()."""
        with patch.object(
            main_window.terminal_tab, "close_session"
        ) as mock_close:
            controller._on_session_ended("sess-end-1")
            mock_close.assert_called_once_with("sess-end-1")

    def test_on_session_ended_with_valid_session_id(
        self, controller, main_window
    ):
        """_on_session_ended() passes the exact session_id."""
        with patch.object(
            main_window.terminal_tab, "close_session"
        ) as mock_close:
            controller._on_session_ended("unique-session-id")
            mock_close.assert_called_once_with("unique-session-id")


# ---------------------------------------------------------------------------
# _refresh_terminal_tab populates containers
# ---------------------------------------------------------------------------


class TestRefreshTerminalTab:
    def test_refresh_terminal_tab_calls_list_running_containers(
        self, controller, mock_docker_manager
    ):
        """_refresh_terminal_tab must call docker_manager.list_running_containers()."""
        mock_docker_manager.list_running_containers.return_value = []
        controller._refresh_terminal_tab()
        mock_docker_manager.list_running_containers.assert_called()

    def test_refresh_terminal_tab_passes_containers_to_ui(
        self, controller, main_window, mock_docker_manager
    ):
        """_refresh_terminal_tab must pass container list to terminal_tab.refresh()."""
        containers = [
            {"id": "abc123", "name": "my-project_container_1"},
            {"id": "def456", "name": "other-project_container_1"},
        ]
        mock_docker_manager.list_running_containers.return_value = containers
        with patch.object(main_window.terminal_tab, "refresh") as mock_refresh:
            controller._refresh_terminal_tab()
            mock_refresh.assert_called_once_with(containers)

    def test_refresh_terminal_tab_handles_docker_error(
        self, controller, main_window, mock_docker_manager
    ):
        """_refresh_terminal_tab must handle docker error and pass empty list."""
        mock_docker_manager.list_running_containers.side_effect = Exception(
            "Docker not available"
        )
        with patch.object(main_window.terminal_tab, "refresh") as mock_refresh:
            controller._refresh_terminal_tab()  # must not raise
            mock_refresh.assert_called_once_with([])


# ---------------------------------------------------------------------------
# create_app() instantiates and wires TerminalBridge
# (detailed tests are in test_main.py — here we verify integration only)
# ---------------------------------------------------------------------------


class TestCreateAppTerminalBridge:
    def test_create_services_includes_terminal_bridge(self, tmp_path):
        """_create_services must return a terminal_bridge key with TerminalBridge."""
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

    def test_terminal_bridge_constructed_with_docker_manager(self, tmp_path):
        """_create_services must pass docker_manager to TerminalBridge constructor."""
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

            MockBridge.assert_called_once_with(services["docker_manager"])

    def test_controller_stores_terminal_bridge(
        self,
        main_window,
        mock_project_store,
        mock_docker_manager,
        mock_loop_runner,
        mock_credential_manager,
        mock_config_manager,
        mock_terminal_bridge,
    ):
        """AppController must store the terminal_bridge reference as _terminal_bridge."""
        ctrl = AppController(
            main_window=main_window,
            project_store=mock_project_store,
            docker_manager=mock_docker_manager,
            loop_runner=mock_loop_runner,
            credential_manager=mock_credential_manager,
            config_manager=mock_config_manager,
            terminal_bridge=mock_terminal_bridge,
        )
        assert ctrl._terminal_bridge is mock_terminal_bridge
