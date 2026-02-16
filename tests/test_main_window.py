"""Tests for the main window with tab structure, menu bar, and status bar."""

import pytest
from PyQt6.QtWidgets import QMainWindow, QMenuBar, QStatusBar, QTabWidget

from src.ui.main_window import MainWindow


class TestMainWindowBasics:
    """Basic properties of the main window."""

    def test_inherits_qmainwindow(self, qtbot):
        window = MainWindow()
        qtbot.addWidget(window)
        assert isinstance(window, QMainWindow)

    def test_window_title(self, qtbot):
        window = MainWindow()
        qtbot.addWidget(window)
        assert window.windowTitle() == "Zephyr Desktop"

    def test_minimum_size(self, qtbot):
        window = MainWindow()
        qtbot.addWidget(window)
        assert window.minimumWidth() == 900
        assert window.minimumHeight() == 600


class TestTabWidget:
    """Tab widget structure tests."""

    def test_central_widget_is_tab_widget(self, qtbot):
        window = MainWindow()
        qtbot.addWidget(window)
        assert isinstance(window.centralWidget(), QTabWidget)

    def test_has_four_tabs(self, qtbot):
        window = MainWindow()
        qtbot.addWidget(window)
        assert window.tab_widget.count() == 4

    def test_tab_labels(self, qtbot):
        window = MainWindow()
        qtbot.addWidget(window)
        assert window.tab_widget.tabText(0) == "Projects"
        assert window.tab_widget.tabText(1) == "Running Loops"
        assert window.tab_widget.tabText(2) == "Settings"
        assert window.tab_widget.tabText(3) == "Terminal"

    def test_tab_widgets_accessible(self, qtbot):
        window = MainWindow()
        qtbot.addWidget(window)
        assert window.projects_tab is not None
        assert window.loops_tab is not None
        assert window.settings_tab is not None
        assert window.terminal_tab is not None

    def test_tab_widget_matches_central(self, qtbot):
        window = MainWindow()
        qtbot.addWidget(window)
        assert window.tab_widget is window.centralWidget()


class TestMenuBar:
    """Menu bar structure tests."""

    def test_menu_bar_exists(self, qtbot):
        window = MainWindow()
        qtbot.addWidget(window)
        assert window.menuBar() is not None

    def test_file_menu_exists(self, qtbot):
        window = MainWindow()
        qtbot.addWidget(window)
        menu_bar = window.menuBar()
        file_menu = None
        for action in menu_bar.actions():
            if action.text().replace("&", "") == "File":
                file_menu = action.menu()
                break
        assert file_menu is not None

    def test_help_menu_exists(self, qtbot):
        window = MainWindow()
        qtbot.addWidget(window)
        menu_bar = window.menuBar()
        help_menu = None
        for action in menu_bar.actions():
            if action.text().replace("&", "") == "Help":
                help_menu = action.menu()
                break
        assert help_menu is not None

    def test_file_menu_has_import_action(self, qtbot):
        window = MainWindow()
        qtbot.addWidget(window)
        assert window.import_action is not None
        assert "Import" in window.import_action.text()

    def test_file_menu_has_export_action(self, qtbot):
        window = MainWindow()
        qtbot.addWidget(window)
        assert window.export_action is not None
        assert "Export" in window.export_action.text()

    def test_file_menu_has_quit_action(self, qtbot):
        window = MainWindow()
        qtbot.addWidget(window)
        assert window.quit_action is not None
        assert "Quit" in window.quit_action.text()

    def test_help_menu_has_about_action(self, qtbot):
        window = MainWindow()
        qtbot.addWidget(window)
        assert window.about_action is not None
        assert "About" in window.about_action.text()

    def test_import_action_shortcut(self, qtbot):
        window = MainWindow()
        qtbot.addWidget(window)
        assert window.import_action.shortcut().toString() == "Ctrl+I"

    def test_export_action_shortcut(self, qtbot):
        window = MainWindow()
        qtbot.addWidget(window)
        assert window.export_action.shortcut().toString() == "Ctrl+E"

    def test_quit_action_shortcut(self, qtbot):
        window = MainWindow()
        qtbot.addWidget(window)
        assert window.quit_action.shortcut().toString() == "Ctrl+Q"

    def test_file_menu_action_count(self, qtbot):
        """File menu should have Import, Export, separator, Quit."""
        window = MainWindow()
        qtbot.addWidget(window)
        menu_bar = window.menuBar()
        file_menu = None
        for action in menu_bar.actions():
            if action.text().replace("&", "") == "File":
                file_menu = action.menu()
                break
        # 3 actions + 1 separator = 4 items
        assert len(file_menu.actions()) == 4


class TestStatusBar:
    """Status bar tests."""

    def test_status_bar_exists(self, qtbot):
        window = MainWindow()
        qtbot.addWidget(window)
        assert window.statusBar() is not None

    def test_docker_status_label_exists(self, qtbot):
        window = MainWindow()
        qtbot.addWidget(window)
        assert window.docker_status_label is not None

    def test_docker_status_initial_text(self, qtbot):
        window = MainWindow()
        qtbot.addWidget(window)
        assert "Docker" in window.docker_status_label.text()

    def test_set_docker_connected(self, qtbot):
        window = MainWindow()
        qtbot.addWidget(window)
        window.set_docker_status(True)
        assert "Connected" in window.docker_status_label.text()

    def test_set_docker_disconnected(self, qtbot):
        window = MainWindow()
        qtbot.addWidget(window)
        window.set_docker_status(False)
        assert "Disconnected" in window.docker_status_label.text()

    def test_docker_label_object_name(self, qtbot):
        window = MainWindow()
        qtbot.addWidget(window)
        assert window.docker_status_label.objectName() == "docker_status_label"
