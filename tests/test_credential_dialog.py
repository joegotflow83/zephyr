"""Tests for the credential input dialog.

Verifies that the CredentialDialog renders correctly, uses password echo mode,
supports login mode toggling, and returns the correct result tuple.
"""

import pytest
from PyQt6.QtWidgets import (
    QCheckBox,
    QDialog,
    QDialogButtonBox,
    QLabel,
    QLineEdit,
)

from src.ui.credential_dialog import CredentialDialog


# ── Helpers ──────────────────────────────────────────────────────────


def _find_child(widget, child_type, object_name):
    """Find a child widget by type and objectName."""
    return widget.findChild(child_type, object_name)


# ── Structure tests ──────────────────────────────────────────────────


class TestCredentialDialogStructure:
    """Basic structure and widget existence tests."""

    def test_inherits_qdialog(self, qtbot):
        dlg = CredentialDialog("anthropic")
        qtbot.addWidget(dlg)
        assert isinstance(dlg, QDialog)

    def test_window_title_contains_service(self, qtbot):
        dlg = CredentialDialog("anthropic")
        qtbot.addWidget(dlg)
        assert "Anthropic" in dlg.windowTitle()

    def test_window_title_capitalizes_service(self, qtbot):
        dlg = CredentialDialog("openai")
        qtbot.addWidget(dlg)
        assert "Openai" in dlg.windowTitle()

    def test_minimum_width(self, qtbot):
        dlg = CredentialDialog("anthropic")
        qtbot.addWidget(dlg)
        assert dlg.minimumWidth() >= 400

    def test_has_service_label(self, qtbot):
        dlg = CredentialDialog("anthropic")
        qtbot.addWidget(dlg)
        label = _find_child(dlg, QLabel, "service_label")
        assert label is not None
        assert "Anthropic" in label.text()

    def test_has_key_edit(self, qtbot):
        dlg = CredentialDialog("anthropic")
        qtbot.addWidget(dlg)
        edit = _find_child(dlg, QLineEdit, "key_edit")
        assert edit is not None

    def test_has_login_mode_checkbox(self, qtbot):
        dlg = CredentialDialog("anthropic")
        qtbot.addWidget(dlg)
        cb = _find_child(dlg, QCheckBox, "login_mode_checkbox")
        assert cb is not None
        assert cb.text() == "Use Login Mode"

    def test_has_login_note(self, qtbot):
        dlg = CredentialDialog("anthropic")
        qtbot.addWidget(dlg)
        note = _find_child(dlg, QLabel, "login_note")
        assert note is not None

    def test_has_button_box(self, qtbot):
        dlg = CredentialDialog("anthropic")
        qtbot.addWidget(dlg)
        bb = _find_child(dlg, QDialogButtonBox, "button_box")
        assert bb is not None


# ── Password echo mode tests ────────────────────────────────────────


class TestPasswordEchoMode:
    """Verify the API key input uses password masking."""

    def test_key_edit_uses_password_echo(self, qtbot):
        dlg = CredentialDialog("anthropic")
        qtbot.addWidget(dlg)
        edit = _find_child(dlg, QLineEdit, "key_edit")
        assert edit.echoMode() == QLineEdit.EchoMode.Password

    def test_key_edit_has_placeholder(self, qtbot):
        dlg = CredentialDialog("anthropic")
        qtbot.addWidget(dlg)
        edit = _find_child(dlg, QLineEdit, "key_edit")
        assert edit.placeholderText() != ""


# ── Login mode toggle tests ─────────────────────────────────────────


class TestLoginModeToggle:
    """Verify login mode checkbox behavior."""

    def test_login_note_hidden_by_default(self, qtbot):
        dlg = CredentialDialog("anthropic")
        qtbot.addWidget(dlg)
        note = _find_child(dlg, QLabel, "login_note")
        assert note.isHidden()

    def test_login_note_visible_when_checked(self, qtbot):
        dlg = CredentialDialog("anthropic")
        qtbot.addWidget(dlg)
        cb = _find_child(dlg, QCheckBox, "login_mode_checkbox")
        note = _find_child(dlg, QLabel, "login_note")
        cb.setChecked(True)
        assert not note.isHidden()

    def test_login_note_hidden_when_unchecked(self, qtbot):
        dlg = CredentialDialog("anthropic")
        qtbot.addWidget(dlg)
        cb = _find_child(dlg, QCheckBox, "login_mode_checkbox")
        note = _find_child(dlg, QLabel, "login_note")
        cb.setChecked(True)
        assert not note.isHidden()
        cb.setChecked(False)
        assert note.isHidden()

    def test_key_edit_disabled_when_login_mode(self, qtbot):
        dlg = CredentialDialog("anthropic")
        qtbot.addWidget(dlg)
        cb = _find_child(dlg, QCheckBox, "login_mode_checkbox")
        edit = _find_child(dlg, QLineEdit, "key_edit")
        assert edit.isEnabled()
        cb.setChecked(True)
        assert not edit.isEnabled()

    def test_key_edit_reenabled_when_login_mode_unchecked(self, qtbot):
        dlg = CredentialDialog("anthropic")
        qtbot.addWidget(dlg)
        cb = _find_child(dlg, QCheckBox, "login_mode_checkbox")
        edit = _find_child(dlg, QLineEdit, "key_edit")
        cb.setChecked(True)
        assert not edit.isEnabled()
        cb.setChecked(False)
        assert edit.isEnabled()

    def test_login_mode_not_checked_by_default(self, qtbot):
        dlg = CredentialDialog("anthropic")
        qtbot.addWidget(dlg)
        cb = _find_child(dlg, QCheckBox, "login_mode_checkbox")
        assert not cb.isChecked()

    def test_login_note_mentions_browser(self, qtbot):
        dlg = CredentialDialog("anthropic")
        qtbot.addWidget(dlg)
        note = _find_child(dlg, QLabel, "login_note")
        assert "browser" in note.text().lower()


# ── get_result tests ─────────────────────────────────────────────────


class TestGetResult:
    """Verify get_result() returns the correct tuple."""

    def test_returns_tuple(self, qtbot):
        dlg = CredentialDialog("anthropic")
        qtbot.addWidget(dlg)
        result = dlg.get_result()
        assert isinstance(result, tuple)
        assert len(result) == 2

    def test_returns_entered_key(self, qtbot):
        dlg = CredentialDialog("anthropic")
        qtbot.addWidget(dlg)
        edit = _find_child(dlg, QLineEdit, "key_edit")
        edit.setText("sk-test-12345")
        key, _ = dlg.get_result()
        assert key == "sk-test-12345"

    def test_returns_empty_key_by_default(self, qtbot):
        dlg = CredentialDialog("anthropic")
        qtbot.addWidget(dlg)
        key, _ = dlg.get_result()
        assert key == ""

    def test_returns_login_mode_false_by_default(self, qtbot):
        dlg = CredentialDialog("anthropic")
        qtbot.addWidget(dlg)
        _, login_mode = dlg.get_result()
        assert login_mode is False

    def test_returns_login_mode_true_when_checked(self, qtbot):
        dlg = CredentialDialog("anthropic")
        qtbot.addWidget(dlg)
        cb = _find_child(dlg, QCheckBox, "login_mode_checkbox")
        cb.setChecked(True)
        _, login_mode = dlg.get_result()
        assert login_mode is True

    def test_returns_key_and_login_mode_together(self, qtbot):
        dlg = CredentialDialog("anthropic")
        qtbot.addWidget(dlg)
        edit = _find_child(dlg, QLineEdit, "key_edit")
        edit.setText("my-secret-key")
        key, login_mode = dlg.get_result()
        assert key == "my-secret-key"
        assert login_mode is False

    def test_returns_key_with_login_mode_checked(self, qtbot):
        dlg = CredentialDialog("anthropic")
        qtbot.addWidget(dlg)
        edit = _find_child(dlg, QLineEdit, "key_edit")
        cb = _find_child(dlg, QCheckBox, "login_mode_checkbox")
        edit.setText("some-key")
        cb.setChecked(True)
        key, login_mode = dlg.get_result()
        assert key == "some-key"
        assert login_mode is True


# ── Service-specific tests ───────────────────────────────────────────


class TestServiceSpecific:
    """Test dialog with different service names."""

    def test_anthropic_service(self, qtbot):
        dlg = CredentialDialog("anthropic")
        qtbot.addWidget(dlg)
        label = _find_child(dlg, QLabel, "service_label")
        assert "Anthropic" in label.text()

    def test_openai_service(self, qtbot):
        dlg = CredentialDialog("openai")
        qtbot.addWidget(dlg)
        label = _find_child(dlg, QLabel, "service_label")
        assert "Openai" in label.text()

    def test_github_service(self, qtbot):
        dlg = CredentialDialog("github")
        qtbot.addWidget(dlg)
        label = _find_child(dlg, QLabel, "service_label")
        assert "Github" in label.text()

    def test_custom_service(self, qtbot):
        dlg = CredentialDialog("custom_svc")
        qtbot.addWidget(dlg)
        label = _find_child(dlg, QLabel, "service_label")
        assert "Custom_svc" in label.text()


# ── Button box tests ─────────────────────────────────────────────────


class TestButtonBox:
    """Verify OK/Cancel button behavior."""

    def test_ok_button_exists(self, qtbot):
        dlg = CredentialDialog("anthropic")
        qtbot.addWidget(dlg)
        bb = _find_child(dlg, QDialogButtonBox, "button_box")
        ok_btn = bb.button(QDialogButtonBox.StandardButton.Ok)
        assert ok_btn is not None

    def test_cancel_button_exists(self, qtbot):
        dlg = CredentialDialog("anthropic")
        qtbot.addWidget(dlg)
        bb = _find_child(dlg, QDialogButtonBox, "button_box")
        cancel_btn = bb.button(QDialogButtonBox.StandardButton.Cancel)
        assert cancel_btn is not None

    def test_ok_accepts_dialog(self, qtbot):
        dlg = CredentialDialog("anthropic")
        qtbot.addWidget(dlg)
        bb = _find_child(dlg, QDialogButtonBox, "button_box")
        ok_btn = bb.button(QDialogButtonBox.StandardButton.Ok)
        with qtbot.waitSignal(dlg.accepted, timeout=1000):
            ok_btn.click()

    def test_cancel_rejects_dialog(self, qtbot):
        dlg = CredentialDialog("anthropic")
        qtbot.addWidget(dlg)
        bb = _find_child(dlg, QDialogButtonBox, "button_box")
        cancel_btn = bb.button(QDialogButtonBox.StandardButton.Cancel)
        with qtbot.waitSignal(dlg.rejected, timeout=1000):
            cancel_btn.click()
