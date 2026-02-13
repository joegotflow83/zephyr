"""Tests for the Running Loops tab UI."""

import pytest
from PyQt6.QtCore import Qt
from PyQt6.QtGui import QFont
from PyQt6.QtWidgets import (
    QHBoxLayout,
    QPlainTextEdit,
    QPushButton,
    QSplitter,
    QTableWidget,
    QVBoxLayout,
    QWidget,
)

from src.lib.loop_runner import LoopMode, LoopState, LoopStatus
from src.ui.loops_tab import LoopsTab


def _make_state(
    project_id="proj-1",
    status=LoopStatus.RUNNING,
    mode=LoopMode.CONTINUOUS,
    iteration=3,
    started_at="2025-01-15T10:00:00+00:00",
    **kwargs,
):
    """Helper to create a LoopState with sensible defaults."""
    return LoopState(
        project_id=project_id,
        status=status,
        mode=mode,
        iteration=iteration,
        started_at=started_at,
        **kwargs,
    )


class TestLoopsTabStructure:
    """Basic structure and widget existence tests."""

    def test_inherits_qwidget(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        assert isinstance(tab, QWidget)

    def test_has_table(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        assert tab.table is not None
        assert isinstance(tab.table, QTableWidget)

    def test_table_object_name(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        assert tab.table.objectName() == "loops_table"

    def test_table_column_count(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        assert tab.table.columnCount() == 6

    def test_table_column_headers(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        headers = []
        for col in range(tab.table.columnCount()):
            headers.append(tab.table.horizontalHeaderItem(col).text())
        assert headers == ["Project", "Status", "Mode", "Iteration", "Started", "Actions"]

    def test_table_selection_behavior(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        assert tab.table.selectionBehavior() == QTableWidget.SelectionBehavior.SelectRows

    def test_table_not_editable(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        assert tab.table.editTriggers() == QTableWidget.EditTrigger.NoEditTriggers

    def test_last_column_stretches(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        assert tab.table.horizontalHeader().stretchLastSection()

    def test_has_log_viewer(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        assert tab.log_viewer is not None
        assert isinstance(tab.log_viewer, QPlainTextEdit)

    def test_log_viewer_object_name(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        assert tab.log_viewer.objectName() == "log_viewer"

    def test_log_viewer_is_readonly(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        assert tab.log_viewer.isReadOnly()

    def test_log_viewer_has_monospace_font(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        font = tab.log_viewer.font()
        assert font.family() == "monospace"

    def test_log_viewer_has_placeholder_text(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        assert "Select a loop" in tab.log_viewer.placeholderText()

    def test_layout_is_vbox(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        assert isinstance(tab.layout(), QVBoxLayout)

    def test_has_splitter(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        splitter = tab.findChild(QSplitter, "loops_splitter")
        assert splitter is not None

    def test_initial_table_empty(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        assert tab.table.rowCount() == 0

    def test_initial_project_ids_empty(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        assert tab._project_ids == []


class TestRefresh:
    """Tests for the refresh() method that populates the table."""

    def test_refresh_empty_dict(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        tab.refresh({})
        assert tab.table.rowCount() == 0

    def test_refresh_single_state(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        state = _make_state(project_id="p1")
        tab.refresh({"p1": state})
        assert tab.table.rowCount() == 1

    def test_refresh_populates_project_name_from_mapping(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        state = _make_state(project_id="p1")
        tab.refresh({"p1": state}, project_names={"p1": "My Project"})
        assert tab.table.item(0, 0).text() == "My Project"

    def test_refresh_falls_back_to_project_id(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        state = _make_state(project_id="p1")
        tab.refresh({"p1": state})
        assert tab.table.item(0, 0).text() == "p1"

    def test_refresh_populates_status(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        state = _make_state(status=LoopStatus.RUNNING)
        tab.refresh({"p1": state})
        assert tab.table.item(0, 1).text() == "running"

    def test_refresh_populates_mode(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        state = _make_state(mode=LoopMode.CONTINUOUS)
        tab.refresh({"p1": state})
        assert tab.table.item(0, 2).text() == "continuous"

    def test_refresh_populates_iteration(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        state = _make_state(iteration=7)
        tab.refresh({"p1": state})
        assert tab.table.item(0, 3).text() == "7"

    def test_refresh_populates_started_at(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        state = _make_state(started_at="2025-01-15T10:00:00+00:00")
        tab.refresh({"p1": state})
        assert tab.table.item(0, 4).text() == "2025-01-15T10:00:00+00:00"

    def test_refresh_empty_started_at(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        state = _make_state(started_at=None)
        tab.refresh({"p1": state})
        assert tab.table.item(0, 4).text() == ""

    def test_refresh_multiple_states(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        states = {
            "p1": _make_state(project_id="p1", iteration=1),
            "p2": _make_state(project_id="p2", iteration=5),
            "p3": _make_state(project_id="p3", iteration=10),
        }
        tab.refresh(states)
        assert tab.table.rowCount() == 3

    def test_refresh_tracks_project_ids(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        states = {
            "p1": _make_state(project_id="p1"),
            "p2": _make_state(project_id="p2"),
        }
        tab.refresh(states)
        assert tab._project_ids == ["p1", "p2"]

    def test_refresh_replaces_old_data(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        tab.refresh({"p1": _make_state(project_id="p1")})
        assert tab.table.rowCount() == 1

        tab.refresh({
            "p2": _make_state(project_id="p2"),
            "p3": _make_state(project_id="p3"),
        })
        assert tab.table.rowCount() == 2
        assert tab._project_ids == ["p2", "p3"]

    def test_refresh_remembers_project_names(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        state = _make_state(project_id="p1")
        tab.refresh({"p1": state}, project_names={"p1": "My Project"})
        # Refresh again without providing names - should remember
        tab.refresh({"p1": state})
        assert tab.table.item(0, 0).text() == "My Project"


class TestActionButtons:
    """Tests for the action buttons in each row."""

    def test_actions_cell_has_widget(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        state = _make_state()
        tab.refresh({"p1": state})
        actions_widget = tab.table.cellWidget(0, 5)
        assert actions_widget is not None

    def test_action_buttons_exist(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        state = _make_state()
        tab.refresh({"p1": state})
        actions_widget = tab.table.cellWidget(0, 5)
        buttons = actions_widget.findChildren(QPushButton)
        assert len(buttons) == 2

    def test_action_button_labels(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        state = _make_state()
        tab.refresh({"p1": state})
        actions_widget = tab.table.cellWidget(0, 5)
        buttons = actions_widget.findChildren(QPushButton)
        labels = [btn.text() for btn in buttons]
        assert "Start" in labels
        assert "Stop" in labels

    def test_start_button_object_name(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        state = _make_state(project_id="p1")
        tab.refresh({"p1": state})
        btn = tab.table.cellWidget(0, 5).findChild(QPushButton, "start_btn_p1")
        assert btn is not None

    def test_stop_button_object_name(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        state = _make_state(project_id="p1")
        tab.refresh({"p1": state})
        btn = tab.table.cellWidget(0, 5).findChild(QPushButton, "stop_btn_p1")
        assert btn is not None

    def test_actions_layout_is_hbox(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        state = _make_state()
        tab.refresh({"p1": state})
        actions_widget = tab.table.cellWidget(0, 5)
        assert isinstance(actions_widget.layout(), QHBoxLayout)

    def test_start_disabled_when_running(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        state = _make_state(status=LoopStatus.RUNNING)
        tab.refresh({"p1": state})
        start_btn = tab.table.cellWidget(0, 5).findChild(QPushButton, "start_btn_p1")
        assert not start_btn.isEnabled()

    def test_stop_enabled_when_running(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        state = _make_state(status=LoopStatus.RUNNING)
        tab.refresh({"p1": state})
        stop_btn = tab.table.cellWidget(0, 5).findChild(QPushButton, "stop_btn_p1")
        assert stop_btn.isEnabled()

    def test_start_disabled_when_starting(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        state = _make_state(status=LoopStatus.STARTING)
        tab.refresh({"p1": state})
        start_btn = tab.table.cellWidget(0, 5).findChild(QPushButton, "start_btn_p1")
        assert not start_btn.isEnabled()

    def test_start_disabled_when_paused(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        state = _make_state(status=LoopStatus.PAUSED)
        tab.refresh({"p1": state})
        start_btn = tab.table.cellWidget(0, 5).findChild(QPushButton, "start_btn_p1")
        assert not start_btn.isEnabled()

    def test_start_disabled_when_stopping(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        state = _make_state(status=LoopStatus.STOPPING)
        tab.refresh({"p1": state})
        start_btn = tab.table.cellWidget(0, 5).findChild(QPushButton, "start_btn_p1")
        assert not start_btn.isEnabled()

    def test_start_enabled_when_stopped(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        state = _make_state(status=LoopStatus.STOPPED)
        tab.refresh({"p1": state})
        start_btn = tab.table.cellWidget(0, 5).findChild(QPushButton, "start_btn_p1")
        assert start_btn.isEnabled()

    def test_start_enabled_when_completed(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        state = _make_state(status=LoopStatus.COMPLETED)
        tab.refresh({"p1": state})
        start_btn = tab.table.cellWidget(0, 5).findChild(QPushButton, "start_btn_p1")
        assert start_btn.isEnabled()

    def test_start_enabled_when_failed(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        state = _make_state(status=LoopStatus.FAILED)
        tab.refresh({"p1": state})
        start_btn = tab.table.cellWidget(0, 5).findChild(QPushButton, "start_btn_p1")
        assert start_btn.isEnabled()

    def test_start_enabled_when_idle(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        state = _make_state(status=LoopStatus.IDLE)
        tab.refresh({"p1": state})
        start_btn = tab.table.cellWidget(0, 5).findChild(QPushButton, "start_btn_p1")
        assert start_btn.isEnabled()

    def test_stop_disabled_when_stopped(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        state = _make_state(status=LoopStatus.STOPPED)
        tab.refresh({"p1": state})
        stop_btn = tab.table.cellWidget(0, 5).findChild(QPushButton, "stop_btn_p1")
        assert not stop_btn.isEnabled()

    def test_stop_disabled_when_idle(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        state = _make_state(status=LoopStatus.IDLE)
        tab.refresh({"p1": state})
        stop_btn = tab.table.cellWidget(0, 5).findChild(QPushButton, "stop_btn_p1")
        assert not stop_btn.isEnabled()

    def test_stop_disabled_when_completed(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        state = _make_state(status=LoopStatus.COMPLETED)
        tab.refresh({"p1": state})
        stop_btn = tab.table.cellWidget(0, 5).findChild(QPushButton, "stop_btn_p1")
        assert not stop_btn.isEnabled()

    def test_stop_disabled_when_failed(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        state = _make_state(status=LoopStatus.FAILED)
        tab.refresh({"p1": state})
        stop_btn = tab.table.cellWidget(0, 5).findChild(QPushButton, "stop_btn_p1")
        assert not stop_btn.isEnabled()

    def test_stop_enabled_when_paused(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        state = _make_state(status=LoopStatus.PAUSED)
        tab.refresh({"p1": state})
        stop_btn = tab.table.cellWidget(0, 5).findChild(QPushButton, "stop_btn_p1")
        assert stop_btn.isEnabled()


class TestSignals:
    """Tests for signal emissions."""

    def test_start_button_emits_signal(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        state = _make_state(project_id="p1", status=LoopStatus.IDLE)
        tab.refresh({"p1": state})
        start_btn = tab.table.cellWidget(0, 5).findChild(QPushButton, "start_btn_p1")
        with qtbot.waitSignal(tab.loop_start_requested, timeout=1000) as blocker:
            start_btn.click()
        assert blocker.args == ["p1"]

    def test_stop_button_emits_signal(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        state = _make_state(project_id="p1", status=LoopStatus.RUNNING)
        tab.refresh({"p1": state})
        stop_btn = tab.table.cellWidget(0, 5).findChild(QPushButton, "stop_btn_p1")
        with qtbot.waitSignal(tab.loop_stop_requested, timeout=1000) as blocker:
            stop_btn.click()
        assert blocker.args == ["p1"]

    def test_start_signal_correct_project_id_multiple_rows(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        states = {
            "p1": _make_state(project_id="p1", status=LoopStatus.RUNNING),
            "p2": _make_state(project_id="p2", status=LoopStatus.IDLE),
        }
        tab.refresh(states)
        start_btn = tab.table.cellWidget(1, 5).findChild(QPushButton, "start_btn_p2")
        with qtbot.waitSignal(tab.loop_start_requested, timeout=1000) as blocker:
            start_btn.click()
        assert blocker.args == ["p2"]

    def test_stop_signal_correct_project_id_multiple_rows(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        states = {
            "p1": _make_state(project_id="p1", status=LoopStatus.RUNNING),
            "p2": _make_state(project_id="p2", status=LoopStatus.RUNNING),
            "p3": _make_state(project_id="p3", status=LoopStatus.RUNNING),
        }
        tab.refresh(states)
        stop_btn = tab.table.cellWidget(2, 5).findChild(QPushButton, "stop_btn_p3")
        with qtbot.waitSignal(tab.loop_stop_requested, timeout=1000) as blocker:
            stop_btn.click()
        assert blocker.args == ["p3"]


class TestGetSelectedProjectId:
    """Tests for the get_selected_project_id method."""

    def test_no_selection_returns_none(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        tab.refresh({"p1": _make_state()})
        assert tab.get_selected_project_id() is None

    def test_selected_row_returns_project_id(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        tab.refresh({"p1": _make_state(project_id="p1")})
        tab.table.selectRow(0)
        assert tab.get_selected_project_id() == "p1"

    def test_selected_second_row(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        states = {
            "p1": _make_state(project_id="p1"),
            "p2": _make_state(project_id="p2"),
        }
        tab.refresh(states)
        tab.table.selectRow(1)
        assert tab.get_selected_project_id() == "p2"

    def test_empty_table_returns_none(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        assert tab.get_selected_project_id() is None


class TestLogViewer:
    """Tests for the log viewer functionality."""

    def test_append_log_stores_in_buffer(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        tab.append_log("p1", "line 1")
        tab.append_log("p1", "line 2")
        assert tab._log_buffers["p1"] == ["line 1", "line 2"]

    def test_append_log_creates_buffer_for_new_project(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        tab.append_log("p1", "hello")
        assert "p1" in tab._log_buffers

    def test_append_log_separate_buffers_per_project(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        tab.append_log("p1", "p1-line")
        tab.append_log("p2", "p2-line")
        assert tab._log_buffers["p1"] == ["p1-line"]
        assert tab._log_buffers["p2"] == ["p2-line"]

    def test_append_log_shows_in_viewer_when_selected(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        state = _make_state(project_id="p1")
        tab.refresh({"p1": state})
        tab.table.selectRow(0)
        tab.append_log("p1", "visible line")
        text = tab.log_viewer.toPlainText()
        assert "visible line" in text

    def test_append_log_not_shown_when_different_project_selected(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        states = {
            "p1": _make_state(project_id="p1"),
            "p2": _make_state(project_id="p2"),
        }
        tab.refresh(states)
        tab.table.selectRow(0)  # Select p1
        tab.append_log("p2", "hidden line")
        text = tab.log_viewer.toPlainText()
        assert "hidden line" not in text

    def test_selecting_row_shows_buffered_logs(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        tab.append_log("p1", "line 1")
        tab.append_log("p1", "line 2")
        state = _make_state(project_id="p1")
        tab.refresh({"p1": state})
        tab.table.selectRow(0)
        text = tab.log_viewer.toPlainText()
        assert "line 1" in text
        assert "line 2" in text

    def test_switching_selection_updates_log_viewer(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        tab.append_log("p1", "p1-log")
        tab.append_log("p2", "p2-log")
        states = {
            "p1": _make_state(project_id="p1"),
            "p2": _make_state(project_id="p2"),
        }
        tab.refresh(states)
        tab.table.selectRow(0)
        assert "p1-log" in tab.log_viewer.toPlainText()

        tab.table.selectRow(1)
        text = tab.log_viewer.toPlainText()
        assert "p2-log" in text
        assert "p1-log" not in text

    def test_clear_log_removes_buffer(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        tab.append_log("p1", "some log")
        tab.clear_log("p1")
        assert "p1" not in tab._log_buffers

    def test_clear_log_clears_viewer_if_selected(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        state = _make_state(project_id="p1")
        tab.refresh({"p1": state})
        tab.table.selectRow(0)
        tab.append_log("p1", "some text")
        assert tab.log_viewer.toPlainText() != ""
        tab.clear_log("p1")
        assert tab.log_viewer.toPlainText() == ""

    def test_clear_log_nonexistent_project_no_error(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        tab.clear_log("nonexistent")  # Should not raise

    def test_deselecting_clears_viewer(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        tab.append_log("p1", "log text")
        state = _make_state(project_id="p1")
        tab.refresh({"p1": state})
        tab.table.selectRow(0)
        assert tab.log_viewer.toPlainText() != ""
        tab.table.clearSelection()
        assert tab.log_viewer.toPlainText() == ""

    def test_append_multiple_lines_preserves_order(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        state = _make_state(project_id="p1")
        tab.refresh({"p1": state})
        tab.table.selectRow(0)
        for i in range(10):
            tab.append_log("p1", f"line {i}")
        text = tab.log_viewer.toPlainText()
        lines = text.strip().split("\n")
        for i in range(10):
            assert lines[i] == f"line {i}"


class TestExportButtons:
    """Tests for the log export buttons and signals."""

    def test_export_log_button_exists(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        assert tab.export_log_btn is not None
        assert tab.export_log_btn.text() == "Export Selected Log"

    def test_export_all_logs_button_exists(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        assert tab.export_all_logs_btn is not None
        assert tab.export_all_logs_btn.text() == "Export All Logs"

    def test_export_log_button_disabled_by_default(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        assert not tab.export_log_btn.isEnabled()

    def test_export_log_button_enabled_when_selected(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        tab.refresh({"p1": _make_state(project_id="p1")})
        tab.table.selectRow(0)
        assert tab.export_log_btn.isEnabled()

    def test_export_log_button_disabled_when_deselected(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        tab.refresh({"p1": _make_state(project_id="p1")})
        tab.table.selectRow(0)
        assert tab.export_log_btn.isEnabled()
        tab.table.clearSelection()
        assert not tab.export_log_btn.isEnabled()

    def test_export_all_logs_button_always_enabled(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        assert tab.export_all_logs_btn.isEnabled()

    def test_export_log_button_emits_signal(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        tab.refresh({"p1": _make_state(project_id="p1")})
        tab.table.selectRow(0)
        with qtbot.waitSignal(tab.log_export_requested, timeout=1000) as blocker:
            tab.export_log_btn.click()
        assert blocker.args == ["p1"]

    def test_export_all_logs_emits_signal(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        with qtbot.waitSignal(tab.log_export_all_requested, timeout=1000):
            tab.export_all_logs_btn.click()

    def test_export_log_button_object_name(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        assert tab.export_log_btn.objectName() == "export_log_btn"

    def test_export_all_logs_button_object_name(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        assert tab.export_all_logs_btn.objectName() == "export_all_logs_btn"


class TestLogContentAccessors:
    """Tests for get_log_content and get_all_log_contents."""

    def test_get_log_content_empty(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        assert tab.get_log_content("nonexistent") == ""

    def test_get_log_content_returns_joined_lines(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        tab.append_log("p1", "line 1")
        tab.append_log("p1", "line 2")
        assert tab.get_log_content("p1") == "line 1\nline 2"

    def test_get_all_log_contents_empty(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        assert tab.get_all_log_contents() == {}

    def test_get_all_log_contents_multiple_projects(self, qtbot):
        tab = LoopsTab()
        qtbot.addWidget(tab)
        tab.append_log("p1", "hello")
        tab.append_log("p2", "world")
        result = tab.get_all_log_contents()
        assert result == {"p1": "hello", "p2": "world"}


class TestMainWindowIntegration:
    """Tests that LoopsTab integrates correctly with MainWindow."""

    def test_main_window_has_loops_tab_instance(self, qtbot):
        from src.ui.main_window import MainWindow
        window = MainWindow()
        qtbot.addWidget(window)
        assert isinstance(window.loops_tab, LoopsTab)

    def test_loops_tab_is_second_tab(self, qtbot):
        from src.ui.main_window import MainWindow
        window = MainWindow()
        qtbot.addWidget(window)
        assert window.tab_widget.widget(1) is window.loops_tab

    def test_loops_tab_label(self, qtbot):
        from src.ui.main_window import MainWindow
        window = MainWindow()
        qtbot.addWidget(window)
        assert window.tab_widget.tabText(1) == "Running Loops"
