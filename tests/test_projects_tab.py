"""Tests for the Projects tab UI."""

import pytest
from PyQt6.QtCore import Qt
from PyQt6.QtWidgets import (
    QHBoxLayout,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from src.lib.models import ProjectConfig
from src.ui.projects_tab import ProjectsTab


def _make_project(name="Test Project", repo_url="https://github.com/test/repo", **kwargs):
    """Helper to create a ProjectConfig with sensible defaults."""
    return ProjectConfig(name=name, repo_url=repo_url, **kwargs)


class TestProjectsTabStructure:
    """Basic structure and widget existence tests."""

    def test_inherits_qwidget(self, qtbot):
        tab = ProjectsTab()
        qtbot.addWidget(tab)
        assert isinstance(tab, QWidget)

    def test_has_add_button(self, qtbot):
        tab = ProjectsTab()
        qtbot.addWidget(tab)
        assert tab.add_button is not None
        assert isinstance(tab.add_button, QPushButton)
        assert tab.add_button.text() == "Add Project"

    def test_add_button_object_name(self, qtbot):
        tab = ProjectsTab()
        qtbot.addWidget(tab)
        assert tab.add_button.objectName() == "add_project_button"

    def test_has_table(self, qtbot):
        tab = ProjectsTab()
        qtbot.addWidget(tab)
        assert tab.table is not None
        assert isinstance(tab.table, QTableWidget)

    def test_table_object_name(self, qtbot):
        tab = ProjectsTab()
        qtbot.addWidget(tab)
        assert tab.table.objectName() == "projects_table"

    def test_table_column_count(self, qtbot):
        tab = ProjectsTab()
        qtbot.addWidget(tab)
        assert tab.table.columnCount() == 5

    def test_table_column_headers(self, qtbot):
        tab = ProjectsTab()
        qtbot.addWidget(tab)
        headers = []
        for col in range(tab.table.columnCount()):
            headers.append(tab.table.horizontalHeaderItem(col).text())
        assert headers == ["Name", "Repo URL", "Docker Image", "Status", "Actions"]

    def test_table_selection_behavior(self, qtbot):
        tab = ProjectsTab()
        qtbot.addWidget(tab)
        assert tab.table.selectionBehavior() == QTableWidget.SelectionBehavior.SelectRows

    def test_table_not_editable(self, qtbot):
        tab = ProjectsTab()
        qtbot.addWidget(tab)
        assert tab.table.editTriggers() == QTableWidget.EditTrigger.NoEditTriggers

    def test_last_column_stretches(self, qtbot):
        tab = ProjectsTab()
        qtbot.addWidget(tab)
        assert tab.table.horizontalHeader().stretchLastSection()

    def test_layout_is_vbox(self, qtbot):
        tab = ProjectsTab()
        qtbot.addWidget(tab)
        assert isinstance(tab.layout(), QVBoxLayout)

    def test_initial_table_empty(self, qtbot):
        tab = ProjectsTab()
        qtbot.addWidget(tab)
        assert tab.table.rowCount() == 0

    def test_initial_project_ids_empty(self, qtbot):
        tab = ProjectsTab()
        qtbot.addWidget(tab)
        assert tab._project_ids == []


class TestRefresh:
    """Tests for the refresh() method that populates the table."""

    def test_refresh_empty_list(self, qtbot):
        tab = ProjectsTab()
        qtbot.addWidget(tab)
        tab.refresh([])
        assert tab.table.rowCount() == 0

    def test_refresh_single_project(self, qtbot):
        tab = ProjectsTab()
        qtbot.addWidget(tab)
        project = _make_project(name="Alpha", repo_url="https://example.com/alpha")
        tab.refresh([project])
        assert tab.table.rowCount() == 1

    def test_refresh_populates_name(self, qtbot):
        tab = ProjectsTab()
        qtbot.addWidget(tab)
        project = _make_project(name="Alpha")
        tab.refresh([project])
        assert tab.table.item(0, 0).text() == "Alpha"

    def test_refresh_populates_repo_url(self, qtbot):
        tab = ProjectsTab()
        qtbot.addWidget(tab)
        project = _make_project(repo_url="https://example.com/repo")
        tab.refresh([project])
        assert tab.table.item(0, 1).text() == "https://example.com/repo"

    def test_refresh_populates_docker_image(self, qtbot):
        tab = ProjectsTab()
        qtbot.addWidget(tab)
        project = _make_project(docker_image="python:3.12")
        tab.refresh([project])
        assert tab.table.item(0, 2).text() == "python:3.12"

    def test_refresh_default_docker_image(self, qtbot):
        tab = ProjectsTab()
        qtbot.addWidget(tab)
        project = _make_project()
        tab.refresh([project])
        assert tab.table.item(0, 2).text() == "ubuntu:24.04"

    def test_refresh_default_status_idle(self, qtbot):
        tab = ProjectsTab()
        qtbot.addWidget(tab)
        project = _make_project()
        tab.refresh([project])
        assert tab.table.item(0, 3).text() == "Idle"

    def test_refresh_custom_status(self, qtbot):
        tab = ProjectsTab()
        qtbot.addWidget(tab)
        project = _make_project()
        tab.refresh([project], statuses={project.id: "Running"})
        assert tab.table.item(0, 3).text() == "Running"

    def test_refresh_partial_statuses(self, qtbot):
        tab = ProjectsTab()
        qtbot.addWidget(tab)
        p1 = _make_project(name="P1")
        p2 = _make_project(name="P2")
        tab.refresh([p1, p2], statuses={p1.id: "Running"})
        assert tab.table.item(0, 3).text() == "Running"
        assert tab.table.item(1, 3).text() == "Idle"

    def test_refresh_multiple_projects(self, qtbot):
        tab = ProjectsTab()
        qtbot.addWidget(tab)
        projects = [_make_project(name=f"Project {i}") for i in range(5)]
        tab.refresh(projects)
        assert tab.table.rowCount() == 5
        for i, project in enumerate(projects):
            assert tab.table.item(i, 0).text() == project.name

    def test_refresh_tracks_project_ids(self, qtbot):
        tab = ProjectsTab()
        qtbot.addWidget(tab)
        projects = [_make_project(name=f"P{i}") for i in range(3)]
        tab.refresh(projects)
        assert tab._project_ids == [p.id for p in projects]

    def test_refresh_replaces_old_data(self, qtbot):
        tab = ProjectsTab()
        qtbot.addWidget(tab)
        old_projects = [_make_project(name="Old")]
        tab.refresh(old_projects)
        assert tab.table.rowCount() == 1
        assert tab.table.item(0, 0).text() == "Old"

        new_projects = [_make_project(name="New1"), _make_project(name="New2")]
        tab.refresh(new_projects)
        assert tab.table.rowCount() == 2
        assert tab.table.item(0, 0).text() == "New1"
        assert tab.table.item(1, 0).text() == "New2"

    def test_refresh_clears_old_project_ids(self, qtbot):
        tab = ProjectsTab()
        qtbot.addWidget(tab)
        p1 = _make_project(name="P1")
        tab.refresh([p1])
        old_ids = list(tab._project_ids)

        p2 = _make_project(name="P2")
        tab.refresh([p2])
        assert tab._project_ids == [p2.id]
        assert old_ids[0] not in tab._project_ids


class TestActionButtons:
    """Tests for the action buttons in each row."""

    def test_actions_cell_has_widget(self, qtbot):
        tab = ProjectsTab()
        qtbot.addWidget(tab)
        project = _make_project()
        tab.refresh([project])
        actions_widget = tab.table.cellWidget(0, 4)
        assert actions_widget is not None

    def test_action_buttons_exist(self, qtbot):
        tab = ProjectsTab()
        qtbot.addWidget(tab)
        project = _make_project()
        tab.refresh([project])
        actions_widget = tab.table.cellWidget(0, 4)
        buttons = actions_widget.findChildren(QPushButton)
        assert len(buttons) == 3

    def test_action_button_labels(self, qtbot):
        tab = ProjectsTab()
        qtbot.addWidget(tab)
        project = _make_project()
        tab.refresh([project])
        actions_widget = tab.table.cellWidget(0, 4)
        buttons = actions_widget.findChildren(QPushButton)
        labels = [btn.text() for btn in buttons]
        assert "Edit" in labels
        assert "Delete" in labels
        assert "Run" in labels

    def test_edit_button_object_name(self, qtbot):
        tab = ProjectsTab()
        qtbot.addWidget(tab)
        project = _make_project()
        tab.refresh([project])
        edit_btn = tab.table.cellWidget(0, 4).findChild(QPushButton, f"edit_btn_{project.id}")
        assert edit_btn is not None

    def test_delete_button_object_name(self, qtbot):
        tab = ProjectsTab()
        qtbot.addWidget(tab)
        project = _make_project()
        tab.refresh([project])
        delete_btn = tab.table.cellWidget(0, 4).findChild(QPushButton, f"delete_btn_{project.id}")
        assert delete_btn is not None

    def test_run_button_object_name(self, qtbot):
        tab = ProjectsTab()
        qtbot.addWidget(tab)
        project = _make_project()
        tab.refresh([project])
        run_btn = tab.table.cellWidget(0, 4).findChild(QPushButton, f"run_btn_{project.id}")
        assert run_btn is not None

    def test_actions_layout_is_hbox(self, qtbot):
        tab = ProjectsTab()
        qtbot.addWidget(tab)
        project = _make_project()
        tab.refresh([project])
        actions_widget = tab.table.cellWidget(0, 4)
        assert isinstance(actions_widget.layout(), QHBoxLayout)


class TestSignals:
    """Tests for signal emissions."""

    def test_add_button_emits_signal(self, qtbot):
        tab = ProjectsTab()
        qtbot.addWidget(tab)
        with qtbot.waitSignal(tab.project_add_requested, timeout=1000):
            tab.add_button.click()

    def test_edit_button_emits_signal(self, qtbot):
        tab = ProjectsTab()
        qtbot.addWidget(tab)
        project = _make_project()
        tab.refresh([project])
        edit_btn = tab.table.cellWidget(0, 4).findChild(QPushButton, f"edit_btn_{project.id}")
        with qtbot.waitSignal(tab.project_edit_requested, timeout=1000) as blocker:
            edit_btn.click()
        assert blocker.args == [project.id]

    def test_delete_button_emits_signal(self, qtbot):
        tab = ProjectsTab()
        qtbot.addWidget(tab)
        project = _make_project()
        tab.refresh([project])
        delete_btn = tab.table.cellWidget(0, 4).findChild(QPushButton, f"delete_btn_{project.id}")
        with qtbot.waitSignal(tab.project_delete_requested, timeout=1000) as blocker:
            delete_btn.click()
        assert blocker.args == [project.id]

    def test_run_button_emits_signal(self, qtbot):
        tab = ProjectsTab()
        qtbot.addWidget(tab)
        project = _make_project()
        tab.refresh([project])
        run_btn = tab.table.cellWidget(0, 4).findChild(QPushButton, f"run_btn_{project.id}")
        with qtbot.waitSignal(tab.project_run_requested, timeout=1000) as blocker:
            run_btn.click()
        assert blocker.args == [project.id]

    def test_edit_signal_correct_project_id_multiple_rows(self, qtbot):
        tab = ProjectsTab()
        qtbot.addWidget(tab)
        p1 = _make_project(name="P1")
        p2 = _make_project(name="P2")
        p3 = _make_project(name="P3")
        tab.refresh([p1, p2, p3])

        # Click edit on the second row
        edit_btn = tab.table.cellWidget(1, 4).findChild(QPushButton, f"edit_btn_{p2.id}")
        with qtbot.waitSignal(tab.project_edit_requested, timeout=1000) as blocker:
            edit_btn.click()
        assert blocker.args == [p2.id]

    def test_delete_signal_correct_project_id_multiple_rows(self, qtbot):
        tab = ProjectsTab()
        qtbot.addWidget(tab)
        p1 = _make_project(name="P1")
        p2 = _make_project(name="P2")
        tab.refresh([p1, p2])

        # Click delete on the second row
        delete_btn = tab.table.cellWidget(1, 4).findChild(QPushButton, f"delete_btn_{p2.id}")
        with qtbot.waitSignal(tab.project_delete_requested, timeout=1000) as blocker:
            delete_btn.click()
        assert blocker.args == [p2.id]

    def test_run_signal_correct_project_id_multiple_rows(self, qtbot):
        tab = ProjectsTab()
        qtbot.addWidget(tab)
        p1 = _make_project(name="P1")
        p2 = _make_project(name="P2")
        p3 = _make_project(name="P3")
        tab.refresh([p1, p2, p3])

        # Click run on the third row
        run_btn = tab.table.cellWidget(2, 4).findChild(QPushButton, f"run_btn_{p3.id}")
        with qtbot.waitSignal(tab.project_run_requested, timeout=1000) as blocker:
            run_btn.click()
        assert blocker.args == [p3.id]


class TestGetSelectedProjectId:
    """Tests for the get_selected_project_id method."""

    def test_no_selection_returns_none(self, qtbot):
        tab = ProjectsTab()
        qtbot.addWidget(tab)
        tab.refresh([_make_project()])
        assert tab.get_selected_project_id() is None

    def test_selected_row_returns_project_id(self, qtbot):
        tab = ProjectsTab()
        qtbot.addWidget(tab)
        project = _make_project()
        tab.refresh([project])
        tab.table.selectRow(0)
        assert tab.get_selected_project_id() == project.id

    def test_selected_second_row(self, qtbot):
        tab = ProjectsTab()
        qtbot.addWidget(tab)
        p1 = _make_project(name="P1")
        p2 = _make_project(name="P2")
        tab.refresh([p1, p2])
        tab.table.selectRow(1)
        assert tab.get_selected_project_id() == p2.id

    def test_empty_table_returns_none(self, qtbot):
        tab = ProjectsTab()
        qtbot.addWidget(tab)
        assert tab.get_selected_project_id() is None
