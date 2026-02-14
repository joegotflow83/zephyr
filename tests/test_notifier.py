"""Tests for the desktop notification service (src/lib/notifier.py).

Verifies that Notifier:
- Calls plyer.notification.notify when enabled
- Suppresses notifications when disabled
- Catches and logs platform errors without raising
- Provides convenience methods for loop-complete and loop-failed events
- Passes correct arguments including optional icon_path
"""

import logging
from unittest.mock import MagicMock, patch

import pytest

from src.lib.models import AppSettings
from src.lib.notifier import Notifier

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def enabled_settings():
    """AppSettings with notifications enabled."""
    return AppSettings(notification_enabled=True)


@pytest.fixture
def disabled_settings():
    """AppSettings with notifications disabled."""
    return AppSettings(notification_enabled=False)


@pytest.fixture
def notifier(enabled_settings):
    """Notifier with notifications enabled."""
    return Notifier(enabled_settings)


@pytest.fixture
def disabled_notifier(disabled_settings):
    """Notifier with notifications disabled."""
    return Notifier(disabled_settings)


# ---------------------------------------------------------------------------
# Basic notify() tests
# ---------------------------------------------------------------------------


class TestNotifyBasic:
    """Tests for the core notify() method."""

    @patch("src.lib.notifier.notification")
    def test_notify_calls_plyer_when_enabled(self, mock_notification, notifier):
        """notify() should call plyer.notification.notify when enabled."""
        notifier.notify("Title", "Message")
        mock_notification.notify.assert_called_once_with(
            title="Title",
            message="Message",
            app_name="Zephyr Desktop",
            timeout=10,
        )

    @patch("src.lib.notifier.notification")
    def test_notify_suppressed_when_disabled(
        self, mock_notification, disabled_notifier
    ):
        """notify() should not call plyer when notifications are disabled."""
        disabled_notifier.notify("Title", "Message")
        mock_notification.notify.assert_not_called()

    @patch("src.lib.notifier.notification")
    def test_notify_with_icon_path(self, mock_notification, notifier):
        """notify() should pass app_icon when icon_path is provided."""
        notifier.notify("Title", "Message", icon_path="/path/to/icon.png")
        mock_notification.notify.assert_called_once_with(
            title="Title",
            message="Message",
            app_name="Zephyr Desktop",
            timeout=10,
            app_icon="/path/to/icon.png",
        )

    @patch("src.lib.notifier.notification")
    def test_notify_without_icon_path(self, mock_notification, notifier):
        """notify() should not include app_icon when icon_path is None."""
        notifier.notify("Title", "Message", icon_path=None)
        call_kwargs = mock_notification.notify.call_args[1]
        assert "app_icon" not in call_kwargs

    @patch("src.lib.notifier.notification")
    def test_notify_empty_strings(self, mock_notification, notifier):
        """notify() should work with empty title and message strings."""
        notifier.notify("", "")
        mock_notification.notify.assert_called_once()


# ---------------------------------------------------------------------------
# Error handling tests
# ---------------------------------------------------------------------------


class TestNotifyErrorHandling:
    """Tests that notify() catches all exceptions gracefully."""

    @patch("src.lib.notifier.notification")
    def test_notify_catches_runtime_error(self, mock_notification, notifier):
        """notify() should catch RuntimeError from plyer."""
        mock_notification.notify.side_effect = RuntimeError("No notification backend")
        # Should not raise
        notifier.notify("Title", "Message")

    @patch("src.lib.notifier.notification")
    def test_notify_catches_import_error(self, mock_notification, notifier):
        """notify() should catch ImportError if plyer is broken."""
        mock_notification.notify.side_effect = ImportError("No module named 'dbus'")
        notifier.notify("Title", "Message")

    @patch("src.lib.notifier.notification")
    def test_notify_catches_os_error(self, mock_notification, notifier):
        """notify() should catch OSError from platform issues."""
        mock_notification.notify.side_effect = OSError("Permission denied")
        notifier.notify("Title", "Message")

    @patch("src.lib.notifier.notification")
    def test_notify_catches_generic_exception(self, mock_notification, notifier):
        """notify() should catch any Exception subclass."""
        mock_notification.notify.side_effect = Exception("Unexpected")
        notifier.notify("Title", "Message")

    @patch("src.lib.notifier.notification")
    def test_notify_logs_warning_on_failure(self, mock_notification, notifier, caplog):
        """notify() should log a warning when plyer raises."""
        mock_notification.notify.side_effect = RuntimeError("fail")
        with caplog.at_level(logging.WARNING, logger="zephyr.notifier"):
            notifier.notify("Title", "Message")
        assert "Failed to send notification" in caplog.text
        assert "Title" in caplog.text

    @patch("src.lib.notifier.notification")
    def test_notify_logs_info_on_success(self, mock_notification, notifier, caplog):
        """notify() should log info when notification succeeds."""
        with caplog.at_level(logging.INFO, logger="zephyr.notifier"):
            notifier.notify("Title", "Message")
        assert "Notification sent" in caplog.text

    @patch("src.lib.notifier.notification")
    def test_disabled_logs_debug(self, mock_notification, disabled_notifier, caplog):
        """notify() should log debug when notifications are disabled."""
        with caplog.at_level(logging.DEBUG, logger="zephyr.notifier"):
            disabled_notifier.notify("Title", "Message")
        assert "suppressed" in caplog.text


# ---------------------------------------------------------------------------
# Dynamic settings tests
# ---------------------------------------------------------------------------


class TestDynamicSettings:
    """Tests that settings changes take effect immediately."""

    @patch("src.lib.notifier.notification")
    def test_toggling_enabled_at_runtime(self, mock_notification):
        """Changing notification_enabled should take effect on next call."""
        settings = AppSettings(notification_enabled=True)
        n = Notifier(settings)

        n.notify("T1", "M1")
        assert mock_notification.notify.call_count == 1

        settings.notification_enabled = False
        n.notify("T2", "M2")
        # Still 1 — second call suppressed
        assert mock_notification.notify.call_count == 1

        settings.notification_enabled = True
        n.notify("T3", "M3")
        assert mock_notification.notify.call_count == 2

    @patch("src.lib.notifier.notification")
    def test_settings_reference_not_copy(self, mock_notification):
        """Notifier should hold a reference to settings, not a snapshot."""
        settings = AppSettings(notification_enabled=False)
        n = Notifier(settings)
        n.notify("T", "M")
        mock_notification.notify.assert_not_called()

        # Mutate the same settings object
        settings.notification_enabled = True
        n.notify("T", "M")
        mock_notification.notify.assert_called_once()


# ---------------------------------------------------------------------------
# notify_loop_complete() tests
# ---------------------------------------------------------------------------


class TestNotifyLoopComplete:
    """Tests for the loop-complete convenience method."""

    @patch("src.lib.notifier.notification")
    def test_loop_complete_single_iteration(self, mock_notification, notifier):
        """Should use singular 'iteration' for count of 1."""
        notifier.notify_loop_complete("MyProject", 1)
        call_kwargs = mock_notification.notify.call_args[1]
        assert call_kwargs["title"] == "Loop Complete: MyProject"
        assert "1 iteration " in call_kwargs["message"]
        assert "iterations" not in call_kwargs["message"]

    @patch("src.lib.notifier.notification")
    def test_loop_complete_multiple_iterations(self, mock_notification, notifier):
        """Should use plural 'iterations' for count > 1."""
        notifier.notify_loop_complete("MyProject", 5)
        call_kwargs = mock_notification.notify.call_args[1]
        assert "5 iterations" in call_kwargs["message"]

    @patch("src.lib.notifier.notification")
    def test_loop_complete_zero_iterations(self, mock_notification, notifier):
        """Should handle zero iterations gracefully."""
        notifier.notify_loop_complete("MyProject", 0)
        call_kwargs = mock_notification.notify.call_args[1]
        assert "0 iterations" in call_kwargs["message"]

    @patch("src.lib.notifier.notification")
    def test_loop_complete_contains_project_name(self, mock_notification, notifier):
        """Project name should appear in the title."""
        notifier.notify_loop_complete("Zephyr", 3)
        call_kwargs = mock_notification.notify.call_args[1]
        assert "Zephyr" in call_kwargs["title"]

    @patch("src.lib.notifier.notification")
    def test_loop_complete_suppressed_when_disabled(
        self, mock_notification, disabled_notifier
    ):
        """Should respect notification_enabled for loop complete."""
        disabled_notifier.notify_loop_complete("P", 1)
        mock_notification.notify.assert_not_called()


# ---------------------------------------------------------------------------
# notify_loop_failed() tests
# ---------------------------------------------------------------------------


class TestNotifyLoopFailed:
    """Tests for the loop-failed convenience method."""

    @patch("src.lib.notifier.notification")
    def test_loop_failed_includes_error(self, mock_notification, notifier):
        """Error message should appear as notification body."""
        notifier.notify_loop_failed("MyProject", "Container crashed")
        call_kwargs = mock_notification.notify.call_args[1]
        assert call_kwargs["title"] == "Loop Failed: MyProject"
        assert call_kwargs["message"] == "Container crashed"

    @patch("src.lib.notifier.notification")
    def test_loop_failed_empty_error(self, mock_notification, notifier):
        """Should handle empty error string."""
        notifier.notify_loop_failed("MyProject", "")
        call_kwargs = mock_notification.notify.call_args[1]
        assert call_kwargs["message"] == ""

    @patch("src.lib.notifier.notification")
    def test_loop_failed_long_error(self, mock_notification, notifier):
        """Should pass long error strings without truncation."""
        long_error = "x" * 500
        notifier.notify_loop_failed("P", long_error)
        call_kwargs = mock_notification.notify.call_args[1]
        assert call_kwargs["message"] == long_error

    @patch("src.lib.notifier.notification")
    def test_loop_failed_contains_project_name(self, mock_notification, notifier):
        """Project name should appear in the title."""
        notifier.notify_loop_failed("Zephyr", "err")
        call_kwargs = mock_notification.notify.call_args[1]
        assert "Zephyr" in call_kwargs["title"]

    @patch("src.lib.notifier.notification")
    def test_loop_failed_suppressed_when_disabled(
        self, mock_notification, disabled_notifier
    ):
        """Should respect notification_enabled for loop failed."""
        disabled_notifier.notify_loop_failed("P", "err")
        mock_notification.notify.assert_not_called()


# ---------------------------------------------------------------------------
# Constructor tests
# ---------------------------------------------------------------------------


class TestNotifierConstructor:
    """Tests for Notifier initialization."""

    def test_constructor_stores_settings_ref(self, enabled_settings):
        """Constructor should store the settings reference."""
        n = Notifier(enabled_settings)
        assert n._settings is enabled_settings

    def test_constructor_accepts_disabled_settings(self, disabled_settings):
        """Constructor should work with disabled settings."""
        n = Notifier(disabled_settings)
        assert n._settings.notification_enabled is False
