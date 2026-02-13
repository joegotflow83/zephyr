"""Tests for the main application entry point."""

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
