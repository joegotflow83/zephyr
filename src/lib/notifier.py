"""Desktop notification service for Zephyr Desktop.

Sends native OS notifications for loop lifecycle events (completion, failure)
using plyer. Respects the notification_enabled setting from AppSettings.
Catches all platform errors silently to avoid crashing the app on systems
where notifications are unavailable.
"""

import logging
from typing import TYPE_CHECKING

from plyer import notification

if TYPE_CHECKING:
    from src.lib.models import AppSettings

logger = logging.getLogger("zephyr.notifier")


class Notifier:
    """Desktop notification service.

    Wraps plyer.notification.notify with enable/disable support
    and convenience methods for common loop events.

    Args:
        settings: AppSettings reference; checked on every notify call
            so toggling notification_enabled takes effect immediately.
    """

    def __init__(self, settings: "AppSettings") -> None:
        self._settings = settings

    def notify(
        self,
        title: str,
        message: str,
        icon_path: str | None = None,
    ) -> None:
        """Send a desktop notification.

        Does nothing when notifications are disabled in settings.
        Catches and logs all exceptions so callers are never interrupted.

        Args:
            title: Notification title text.
            message: Notification body text.
            icon_path: Optional path to a notification icon file.
        """
        if not self._settings.notification_enabled:
            logger.debug("Notification suppressed (disabled): %s", title)
            return

        try:
            kwargs: dict = {
                "title": title,
                "message": message,
                "app_name": "Zephyr Desktop",
                "timeout": 10,
            }
            if icon_path is not None:
                kwargs["app_icon"] = icon_path

            notification.notify(**kwargs)
            logger.info("Notification sent: %s", title)
        except Exception:
            logger.warning("Failed to send notification: %s", title, exc_info=True)

    def notify_loop_complete(self, project_name: str, iterations: int) -> None:
        """Notify that a loop finished successfully.

        Args:
            project_name: Human-readable project name.
            iterations: Number of iterations completed.
        """
        self.notify(
            title=f"Loop Complete: {project_name}",
            message=f"Finished {iterations} iteration{'s' if iterations != 1 else ''} successfully.",
        )

    def notify_loop_failed(self, project_name: str, error: str) -> None:
        """Notify that a loop failed.

        Args:
            project_name: Human-readable project name.
            error: Short description of the failure.
        """
        self.notify(
            title=f"Loop Failed: {project_name}",
            message=error,
        )
