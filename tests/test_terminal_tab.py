"""Tests for TerminalTab and TerminalSessionWidget UI components.

Tests verify widget hierarchy, signal emission, container refresh, and
session management without requiring a live Docker daemon or WebEngine.
"""

from unittest.mock import MagicMock, patch

import pytest

from src.ui.terminal_tab import TerminalSessionWidget, TerminalTab


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def terminal_tab(qtbot):
    widget = TerminalTab()
    qtbot.addWidget(widget)
    return widget


@pytest.fixture()
def sample_containers():
    return [
        {"id": "abc123def456", "name": "project_alpha"},
        {"id": "fed987cba654", "name": "project_beta"},
    ]


# ---------------------------------------------------------------------------
# TerminalTab layout tests
# ---------------------------------------------------------------------------


class TestTerminalTabLayout:
    def test_has_container_combo(self, terminal_tab):
        assert terminal_tab.container_combo is not None

    def test_has_open_terminal_button(self, terminal_tab):
        assert terminal_tab.open_terminal_btn is not None
        assert terminal_tab.open_terminal_btn.text() == "Open Terminal"

    def test_has_session_tabs(self, terminal_tab):
        assert terminal_tab.session_tabs is not None

    def test_session_tabs_closable(self, terminal_tab):
        assert terminal_tab.session_tabs.tabsClosable()

    def test_no_sessions_label_visible_initially(self, terminal_tab):
        # Widget must be shown for isVisible() to reflect child visibility
        terminal_tab.show()
        assert terminal_tab.no_sessions_label.isVisible()
        terminal_tab.hide()

    def test_session_tabs_hidden_initially(self, terminal_tab):
        # Hidden child: isHidden() is reliable even without a shown parent
        assert terminal_tab.session_tabs.isHidden()

    def test_object_names(self, terminal_tab):
        assert terminal_tab.container_combo.objectName() == "container_combo"
        assert terminal_tab.open_terminal_btn.objectName() == "open_terminal_btn"
        assert terminal_tab.session_tabs.objectName() == "session_tabs"
        assert terminal_tab.no_sessions_label.objectName() == "no_sessions_label"


# ---------------------------------------------------------------------------
# TerminalTab.refresh() tests
# ---------------------------------------------------------------------------


class TestTerminalTabRefresh:
    def test_refresh_populates_combo(self, terminal_tab, sample_containers):
        terminal_tab.refresh(sample_containers)
        assert terminal_tab.container_combo.count() == 2

    def test_refresh_clears_old_entries(self, terminal_tab, sample_containers):
        terminal_tab.refresh(sample_containers)
        terminal_tab.refresh([{"id": "only_one_id", "name": "only"}])
        assert terminal_tab.container_combo.count() == 1

    def test_refresh_empty_list(self, terminal_tab):
        terminal_tab.refresh([])
        assert terminal_tab.container_combo.count() == 0

    def test_refresh_display_includes_short_id(self, terminal_tab):
        terminal_tab.refresh([{"id": "abc123def456", "name": "myproject"}])
        text = terminal_tab.container_combo.itemText(0)
        assert "abc123def4" in text  # first 12 chars of id
        assert "myproject" in text

    def test_refresh_missing_name_falls_back_to_id(self, terminal_tab):
        terminal_tab.refresh([{"id": "abc123def456"}])
        text = terminal_tab.container_combo.itemText(0)
        assert "abc123def4" in text


# ---------------------------------------------------------------------------
# TerminalTab signal emission tests
# ---------------------------------------------------------------------------


class TestTerminalTabSignals:
    def test_open_terminal_emits_signal(self, qtbot, terminal_tab, sample_containers):
        terminal_tab.refresh(sample_containers)
        terminal_tab.container_combo.setCurrentIndex(0)

        with qtbot.waitSignal(terminal_tab.terminal_requested, timeout=1000) as blocker:
            terminal_tab.open_terminal_btn.click()

        container_id, project_name = blocker.args
        assert container_id == "abc123def456"
        assert project_name == "project_alpha"

    def test_open_terminal_second_item(self, qtbot, terminal_tab, sample_containers):
        terminal_tab.refresh(sample_containers)
        terminal_tab.container_combo.setCurrentIndex(1)

        with qtbot.waitSignal(terminal_tab.terminal_requested, timeout=1000) as blocker:
            terminal_tab.open_terminal_btn.click()

        container_id, project_name = blocker.args
        assert container_id == "fed987cba654"
        assert project_name == "project_beta"

    def test_open_terminal_no_selection_no_signal(self, qtbot, terminal_tab):
        # Empty combo — no signal should fire
        received = []
        terminal_tab.terminal_requested.connect(lambda c, p: received.append((c, p)))
        terminal_tab.open_terminal_btn.click()
        assert received == []

    def test_session_close_requested_emitted(self, qtbot, terminal_tab):
        terminal_tab.add_session("sess-1", "root", 9001)

        with qtbot.waitSignal(terminal_tab.session_close_requested, timeout=1000) as blocker:
            terminal_tab.session_tabs.tabCloseRequested.emit(0)

        assert blocker.args[0] == "sess-1"


# ---------------------------------------------------------------------------
# TerminalTab session management tests
# ---------------------------------------------------------------------------


class TestTerminalTabSessionManagement:
    def test_add_session_creates_tab(self, terminal_tab):
        terminal_tab.add_session("sess-1", "root", 9001)
        assert terminal_tab.session_tabs.count() == 1

    def test_add_session_shows_session_tabs(self, terminal_tab):
        terminal_tab.add_session("sess-1", "root", 9001)
        # After adding a session, session_tabs should not be hidden
        assert not terminal_tab.session_tabs.isHidden()

    def test_add_session_hides_placeholder(self, terminal_tab):
        terminal_tab.add_session("sess-1", "root", 9001)
        assert not terminal_tab.no_sessions_label.isVisible()

    def test_add_multiple_sessions(self, terminal_tab):
        terminal_tab.add_session("sess-1", "root", 9001)
        terminal_tab.add_session("sess-2", "ralph", 9002)
        assert terminal_tab.session_tabs.count() == 2

    def test_add_duplicate_session_ignored(self, terminal_tab):
        terminal_tab.add_session("sess-1", "root", 9001)
        terminal_tab.add_session("sess-1", "root", 9001)  # duplicate
        assert terminal_tab.session_tabs.count() == 1

    def test_close_session_removes_tab(self, terminal_tab):
        terminal_tab.add_session("sess-1", "root", 9001)
        terminal_tab.close_session("sess-1")
        assert terminal_tab.session_tabs.count() == 0

    def test_close_session_shows_placeholder(self, terminal_tab):
        terminal_tab.add_session("sess-1", "root", 9001)
        terminal_tab.close_session("sess-1")
        # After close, placeholder should not be hidden
        assert not terminal_tab.no_sessions_label.isHidden()

    def test_close_session_hides_tabs_widget(self, terminal_tab):
        terminal_tab.add_session("sess-1", "root", 9001)
        terminal_tab.close_session("sess-1")
        assert not terminal_tab.session_tabs.isVisible()

    def test_close_unknown_session_no_error(self, terminal_tab):
        # Should not raise
        terminal_tab.close_session("nonexistent")

    def test_close_one_of_two_sessions(self, terminal_tab):
        terminal_tab.add_session("sess-1", "root", 9001)
        terminal_tab.add_session("sess-2", "ralph", 9002)
        terminal_tab.close_session("sess-1")
        assert terminal_tab.session_tabs.count() == 1

    def test_tab_label_includes_user(self, terminal_tab):
        terminal_tab.add_session("sess-1", "root", 9001)
        label = terminal_tab.session_tabs.tabText(0)
        assert "root" in label


# ---------------------------------------------------------------------------
# TerminalSessionWidget tests
# ---------------------------------------------------------------------------


class TestTerminalSessionWidget:
    def test_root_user_red_label(self, qtbot):
        widget = TerminalSessionWidget("s1", "root", 9001)
        qtbot.addWidget(widget)
        assert "root" in widget.user_label.text()
        style = widget.user_label.styleSheet()
        # Red background for root
        assert "8b0000" in style or "red" in style.lower()

    def test_non_root_user_green_label(self, qtbot):
        widget = TerminalSessionWidget("s1", "ralph", 9001)
        qtbot.addWidget(widget)
        assert "ralph" in widget.user_label.text()
        style = widget.user_label.styleSheet()
        assert "006400" in style or "green" in style.lower()

    def test_set_user_updates_label(self, qtbot):
        widget = TerminalSessionWidget("s1", "ralph", 9001)
        qtbot.addWidget(widget)
        widget.set_user("root")
        assert "root" in widget.user_label.text()

    def test_session_id_property(self, qtbot):
        widget = TerminalSessionWidget("my-session-id", "root", 9001)
        qtbot.addWidget(widget)
        assert widget.session_id == "my-session-id"

    def test_web_view_exists(self, qtbot):
        widget = TerminalSessionWidget("s1", "root", 9001)
        qtbot.addWidget(widget)
        assert widget.web_view is not None

    def test_object_names(self, qtbot):
        widget = TerminalSessionWidget("s1", "root", 9001)
        qtbot.addWidget(widget)
        assert widget.user_label.objectName() == "user_label"
        assert widget.web_view.objectName() == "terminal_web_view"

    def test_set_user_calls_javascript_when_webengine_available(self, qtbot):
        """Verify JS is invoked on the page when WebEngine is available."""
        import src.ui.terminal_tab as tab_mod

        if not tab_mod._WEBENGINE_AVAILABLE:
            pytest.skip("PyQt6-WebEngine not available in this environment")

        widget = TerminalSessionWidget("s1", "root", 9001)
        qtbot.addWidget(widget)

        # Patch the page().runJavaScript on the actual web_view
        mock_run_js = MagicMock()
        widget.web_view.page().runJavaScript = mock_run_js

        widget.set_user("ralph")
        mock_run_js.assert_called_once()
        call_arg = mock_run_js.call_args[0][0]
        assert "setUserTheme" in call_arg
