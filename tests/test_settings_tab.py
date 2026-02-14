"""Tests for the Settings tab UI.

Verifies that the SettingsTab renders all three sections (Credentials,
Docker, General), that controls are properly constrained, and that
signals fire when settings change or credentials are requested.
"""

import pytest
from PyQt6.QtWidgets import (
    QCheckBox,
    QComboBox,
    QGroupBox,
    QLabel,
    QPushButton,
    QScrollArea,
    QSpinBox,
    QWidget,
)

from src.lib.models import AppSettings
from src.ui.settings_tab import CREDENTIAL_SERVICES, SettingsTab

# ── Helpers ──────────────────────────────────────────────────────────


def _find_child(widget, child_type, object_name):
    """Find a child widget by type and objectName."""
    return widget.findChild(child_type, object_name)


# ── Structure tests ──────────────────────────────────────────────────


class TestSettingsTabStructure:
    """Basic structure and widget existence tests."""

    def test_inherits_qwidget(self, qtbot):
        tab = SettingsTab()
        qtbot.addWidget(tab)
        assert isinstance(tab, QWidget)

    def test_has_scroll_area(self, qtbot):
        tab = SettingsTab()
        qtbot.addWidget(tab)
        scroll = _find_child(tab, QScrollArea, "settings_scroll")
        assert scroll is not None

    def test_has_credentials_group(self, qtbot):
        tab = SettingsTab()
        qtbot.addWidget(tab)
        group = _find_child(tab, QGroupBox, "credentials_group")
        assert group is not None
        assert group.title() == "Credentials"

    def test_has_docker_group(self, qtbot):
        tab = SettingsTab()
        qtbot.addWidget(tab)
        group = _find_child(tab, QGroupBox, "docker_group")
        assert group is not None
        assert group.title() == "Docker"

    def test_has_general_group(self, qtbot):
        tab = SettingsTab()
        qtbot.addWidget(tab)
        group = _find_child(tab, QGroupBox, "general_group")
        assert group is not None
        assert group.title() == "General"


# ── Credentials section ──────────────────────────────────────────────


class TestCredentialsSection:
    """Tests for the credential management UI section."""

    def test_has_update_key_buttons_for_all_services(self, qtbot):
        tab = SettingsTab()
        qtbot.addWidget(tab)
        for service in CREDENTIAL_SERVICES:
            btn = _find_child(tab, QPushButton, f"update_key_{service}")
            assert btn is not None, f"Missing update button for {service}"
            assert btn.text() == "Update Key"

    def test_has_login_mode_toggles_for_all_services(self, qtbot):
        tab = SettingsTab()
        qtbot.addWidget(tab)
        for service in CREDENTIAL_SERVICES:
            toggle = _find_child(tab, QCheckBox, f"login_mode_{service}")
            assert toggle is not None, f"Missing login mode toggle for {service}"
            assert toggle.text() == "Login Mode"

    def test_login_mode_toggles_default_unchecked(self, qtbot):
        tab = SettingsTab()
        qtbot.addWidget(tab)
        for service in CREDENTIAL_SERVICES:
            toggle = _find_child(tab, QCheckBox, f"login_mode_{service}")
            assert not toggle.isChecked()

    def test_credential_services_match_expected(self, qtbot):
        """Ensure we cover anthropic, openai, and github."""
        assert "anthropic" in CREDENTIAL_SERVICES
        assert "openai" in CREDENTIAL_SERVICES
        assert "github" in CREDENTIAL_SERVICES

    def test_update_key_signal_anthropic(self, qtbot):
        tab = SettingsTab()
        qtbot.addWidget(tab)
        btn = _find_child(tab, QPushButton, "update_key_anthropic")
        with qtbot.waitSignal(tab.credential_update_requested, timeout=1000) as blocker:
            btn.click()
        assert blocker.args == ["anthropic"]

    def test_update_key_signal_openai(self, qtbot):
        tab = SettingsTab()
        qtbot.addWidget(tab)
        btn = _find_child(tab, QPushButton, "update_key_openai")
        with qtbot.waitSignal(tab.credential_update_requested, timeout=1000) as blocker:
            btn.click()
        assert blocker.args == ["openai"]

    def test_update_key_signal_github(self, qtbot):
        tab = SettingsTab()
        qtbot.addWidget(tab)
        btn = _find_child(tab, QPushButton, "update_key_github")
        with qtbot.waitSignal(tab.credential_update_requested, timeout=1000) as blocker:
            btn.click()
        assert blocker.args == ["github"]


# ── Docker section ───────────────────────────────────────────────────


class TestDockerSection:
    """Tests for the Docker configuration section."""

    def test_docker_status_label_exists(self, qtbot):
        tab = SettingsTab()
        qtbot.addWidget(tab)
        label = _find_child(tab, QLabel, "docker_status_indicator")
        assert label is not None

    def test_docker_status_default(self, qtbot):
        tab = SettingsTab()
        qtbot.addWidget(tab)
        label = _find_child(tab, QLabel, "docker_status_indicator")
        assert label.text() == "Unknown"

    def test_set_docker_status_connected(self, qtbot):
        tab = SettingsTab()
        qtbot.addWidget(tab)
        tab.set_docker_status(True)
        label = _find_child(tab, QLabel, "docker_status_indicator")
        assert label.text() == "Connected"

    def test_set_docker_status_disconnected(self, qtbot):
        tab = SettingsTab()
        qtbot.addWidget(tab)
        tab.set_docker_status(False)
        label = _find_child(tab, QLabel, "docker_status_indicator")
        assert label.text() == "Disconnected"

    def test_max_containers_spinbox_exists(self, qtbot):
        tab = SettingsTab()
        qtbot.addWidget(tab)
        spin = _find_child(tab, QSpinBox, "max_containers_spin")
        assert spin is not None

    def test_max_containers_default_value(self, qtbot):
        tab = SettingsTab()
        qtbot.addWidget(tab)
        assert tab.max_containers_spin.value() == 5

    def test_max_containers_minimum(self, qtbot):
        tab = SettingsTab()
        qtbot.addWidget(tab)
        assert tab.max_containers_spin.minimum() == 1

    def test_max_containers_maximum(self, qtbot):
        tab = SettingsTab()
        qtbot.addWidget(tab)
        assert tab.max_containers_spin.maximum() == 10

    def test_max_containers_constrained_below_minimum(self, qtbot):
        """Setting below min clamps to minimum."""
        tab = SettingsTab()
        qtbot.addWidget(tab)
        tab.max_containers_spin.setValue(0)
        assert tab.max_containers_spin.value() == 1

    def test_max_containers_constrained_above_maximum(self, qtbot):
        """Setting above max clamps to maximum."""
        tab = SettingsTab()
        qtbot.addWidget(tab)
        tab.max_containers_spin.setValue(99)
        assert tab.max_containers_spin.value() == 10

    def test_max_containers_change_emits_settings_changed(self, qtbot):
        tab = SettingsTab()
        qtbot.addWidget(tab)
        with qtbot.waitSignal(tab.settings_changed, timeout=1000) as blocker:
            tab.max_containers_spin.setValue(3)
        settings = blocker.args[0]
        assert isinstance(settings, AppSettings)
        assert settings.max_concurrent_containers == 3


# ── General section ──────────────────────────────────────────────────


class TestGeneralSection:
    """Tests for the general settings section."""

    def test_notification_checkbox_exists(self, qtbot):
        tab = SettingsTab()
        qtbot.addWidget(tab)
        cb = _find_child(tab, QCheckBox, "notification_checkbox")
        assert cb is not None

    def test_notification_default_checked(self, qtbot):
        tab = SettingsTab()
        qtbot.addWidget(tab)
        assert tab.notification_checkbox.isChecked()

    def test_notification_toggle_emits_settings_changed(self, qtbot):
        tab = SettingsTab()
        qtbot.addWidget(tab)
        with qtbot.waitSignal(tab.settings_changed, timeout=1000) as blocker:
            tab.notification_checkbox.setChecked(False)
        settings = blocker.args[0]
        assert isinstance(settings, AppSettings)
        assert settings.notification_enabled is False

    def test_log_level_combo_exists(self, qtbot):
        tab = SettingsTab()
        qtbot.addWidget(tab)
        combo = _find_child(tab, QComboBox, "log_level_combo")
        assert combo is not None

    def test_log_level_default(self, qtbot):
        tab = SettingsTab()
        qtbot.addWidget(tab)
        assert tab.log_level_combo.currentText() == "INFO"

    def test_log_level_options(self, qtbot):
        tab = SettingsTab()
        qtbot.addWidget(tab)
        items = [
            tab.log_level_combo.itemText(i) for i in range(tab.log_level_combo.count())
        ]
        assert items == ["DEBUG", "INFO", "WARNING", "ERROR"]

    def test_log_level_change_emits_settings_changed(self, qtbot):
        tab = SettingsTab()
        qtbot.addWidget(tab)
        with qtbot.waitSignal(tab.settings_changed, timeout=1000) as blocker:
            tab.log_level_combo.setCurrentText("WARNING")
        settings = blocker.args[0]
        assert isinstance(settings, AppSettings)
        assert settings.log_level == "WARNING"

    def test_about_label_exists(self, qtbot):
        tab = SettingsTab()
        qtbot.addWidget(tab)
        label = _find_child(tab, QLabel, "about_label")
        assert label is not None

    def test_about_label_contains_version(self, qtbot):
        tab = SettingsTab()
        qtbot.addWidget(tab)
        from src.lib._version import __version__

        assert f"v{__version__}" in tab.about_label.text()

    def test_about_label_contains_app_name(self, qtbot):
        tab = SettingsTab()
        qtbot.addWidget(tab)
        assert "Zephyr" in tab.about_label.text()


# ── load_settings / get_settings round-trip ──────────────────────────


class TestSettingsRoundTrip:
    """Tests for loading and retrieving settings."""

    def test_get_settings_returns_app_settings(self, qtbot):
        tab = SettingsTab()
        qtbot.addWidget(tab)
        settings = tab.get_settings()
        assert isinstance(settings, AppSettings)

    def test_get_settings_default_values(self, qtbot):
        tab = SettingsTab()
        qtbot.addWidget(tab)
        settings = tab.get_settings()
        assert settings.max_concurrent_containers == 5
        assert settings.notification_enabled is True
        assert settings.log_level == "INFO"

    def test_load_settings_updates_controls(self, qtbot):
        tab = SettingsTab()
        qtbot.addWidget(tab)
        custom = AppSettings(
            max_concurrent_containers=3,
            notification_enabled=False,
            log_level="ERROR",
        )
        tab.load_settings(custom)
        assert tab.max_containers_spin.value() == 3
        assert tab.notification_checkbox.isChecked() is False
        assert tab.log_level_combo.currentText() == "ERROR"

    def test_load_settings_does_not_emit_signal(self, qtbot):
        """load_settings should suppress settings_changed emission."""
        tab = SettingsTab()
        qtbot.addWidget(tab)
        signals_received = []
        tab.settings_changed.connect(lambda s: signals_received.append(s))
        custom = AppSettings(
            max_concurrent_containers=2,
            notification_enabled=False,
            log_level="DEBUG",
        )
        tab.load_settings(custom)
        assert len(signals_received) == 0

    def test_round_trip(self, qtbot):
        """Load settings then get_settings should return equivalent values."""
        tab = SettingsTab()
        qtbot.addWidget(tab)
        original = AppSettings(
            max_concurrent_containers=7,
            notification_enabled=False,
            log_level="WARNING",
        )
        tab.load_settings(original)
        result = tab.get_settings()
        assert result.max_concurrent_containers == original.max_concurrent_containers
        assert result.notification_enabled == original.notification_enabled
        assert result.log_level == original.log_level

    def test_load_then_modify_emits_signal(self, qtbot):
        """After load_settings completes, changes should emit again."""
        tab = SettingsTab()
        qtbot.addWidget(tab)
        tab.load_settings(AppSettings(max_concurrent_containers=2))
        with qtbot.waitSignal(tab.settings_changed, timeout=1000):
            tab.max_containers_spin.setValue(8)


# ── Multiple changes ─────────────────────────────────────────────────


class TestMultipleChanges:
    """Tests that verify settings_changed fires for each change."""

    def test_multiple_settings_changes(self, qtbot):
        tab = SettingsTab()
        qtbot.addWidget(tab)
        received = []
        tab.settings_changed.connect(lambda s: received.append(s))

        tab.max_containers_spin.setValue(2)
        tab.notification_checkbox.setChecked(False)
        tab.log_level_combo.setCurrentText("DEBUG")

        assert len(received) == 3
        # Last emission should reflect all final values
        final = received[-1]
        assert final.max_concurrent_containers == 2
        assert final.notification_enabled is False
        assert final.log_level == "DEBUG"

    def test_each_change_reflects_current_state(self, qtbot):
        """Each settings_changed emission should be a snapshot of all current values."""
        tab = SettingsTab()
        qtbot.addWidget(tab)
        received = []
        tab.settings_changed.connect(lambda s: received.append(s))

        tab.max_containers_spin.setValue(8)
        # At this point notification is still True and log_level is INFO
        assert received[0].max_concurrent_containers == 8
        assert received[0].notification_enabled is True
        assert received[0].log_level == "INFO"


# ── Updates section tests ─────────────────────────────────────────


class TestUpdatesSection:
    """Tests for the self-update UI section in SettingsTab."""

    def test_updates_group_exists(self, qtbot):
        tab = SettingsTab()
        qtbot.addWidget(tab)
        group = _find_child(tab, QGroupBox, "updates_group")
        assert group is not None

    def test_check_updates_button_exists(self, qtbot):
        tab = SettingsTab()
        qtbot.addWidget(tab)
        btn = _find_child(tab, QPushButton, "check_updates_btn")
        assert btn is not None
        assert btn.text() == "Check for Updates"

    def test_update_app_button_exists(self, qtbot):
        tab = SettingsTab()
        qtbot.addWidget(tab)
        btn = _find_child(tab, QPushButton, "update_app_btn")
        assert btn is not None
        assert btn.text() == "Update App"

    def test_update_app_button_initially_disabled(self, qtbot):
        tab = SettingsTab()
        qtbot.addWidget(tab)
        btn = _find_child(tab, QPushButton, "update_app_btn")
        assert not btn.isEnabled()

    def test_update_status_label_default(self, qtbot):
        tab = SettingsTab()
        qtbot.addWidget(tab)
        label = _find_child(tab, QLabel, "update_status_label")
        assert label is not None
        assert label.text() == "Not checked"

    def test_check_updates_signal_emitted(self, qtbot):
        tab = SettingsTab()
        qtbot.addWidget(tab)
        received = []
        tab.check_updates_requested.connect(lambda: received.append(True))
        tab.check_updates_btn.click()
        assert len(received) == 1

    def test_self_update_signal_emitted(self, qtbot):
        tab = SettingsTab()
        qtbot.addWidget(tab)
        tab.update_app_btn.setEnabled(True)
        received = []
        tab.self_update_requested.connect(lambda: received.append(True))
        tab.update_app_btn.click()
        assert len(received) == 1

    def test_set_update_status_available(self, qtbot):
        tab = SettingsTab()
        qtbot.addWidget(tab)
        tab.set_update_status(True)
        assert tab.update_status_label.text() == "Updates available"
        assert tab.update_app_btn.isEnabled()

    def test_set_update_status_up_to_date(self, qtbot):
        tab = SettingsTab()
        qtbot.addWidget(tab)
        tab.update_app_btn.setEnabled(True)  # was enabled
        tab.set_update_status(False)
        assert tab.update_status_label.text() == "Up to date"
        assert not tab.update_app_btn.isEnabled()
