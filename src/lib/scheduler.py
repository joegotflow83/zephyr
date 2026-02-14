"""Scheduled loop support for Zephyr Desktop.

Provides LoopScheduler, which manages timer-based periodic execution
of Ralph loops using simplified cron-like expressions.  Runs entirely
in-process via threading.Timer (no external cron daemon required).

Supported schedule expressions:
    "*/N minutes"  — every N minutes
    "every N hours" — every N hours
    "hourly"       — alias for "every 1 hours"
    "daily HH:MM"  — once per day at the given UTC time
"""

import logging
import re
import threading
from datetime import datetime, timezone
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from src.lib.loop_runner import LoopRunner

from src.lib.loop_runner import LoopMode

logger = logging.getLogger("zephyr.scheduler")


# ---------------------------------------------------------------------------
# Schedule expression parser
# ---------------------------------------------------------------------------

# */5 minutes, */30 minutes, etc.
_RE_EVERY_N_MINUTES = re.compile(r"^\*/(\d+)\s+minutes?$", re.IGNORECASE)

# every 2 hours, every 1 hours, etc.
_RE_EVERY_N_HOURS = re.compile(r"^every\s+(\d+)\s+hours?$", re.IGNORECASE)

# daily 14:30, daily 08:00, etc.
_RE_DAILY = re.compile(r"^daily\s+(\d{1,2}):(\d{2})$", re.IGNORECASE)

# hourly (alias)
_RE_HOURLY = re.compile(r"^hourly$", re.IGNORECASE)


def parse_schedule(expr: str) -> float:
    """Parse a simplified cron expression and return the interval in seconds.

    For ``"daily HH:MM"`` expressions the returned value is the number of
    seconds from *now* until the next occurrence of that wall-clock time
    (in UTC).  For all other expressions the value is a fixed repeat
    interval.

    Raises:
        ValueError: If the expression cannot be parsed.
    """
    expr = expr.strip()

    m = _RE_EVERY_N_MINUTES.match(expr)
    if m:
        minutes = int(m.group(1))
        if minutes <= 0:
            raise ValueError(f"Minutes must be > 0, got {minutes}")
        return minutes * 60.0

    m = _RE_HOURLY.match(expr)
    if m:
        return 3600.0

    m = _RE_EVERY_N_HOURS.match(expr)
    if m:
        hours = int(m.group(1))
        if hours <= 0:
            raise ValueError(f"Hours must be > 0, got {hours}")
        return hours * 3600.0

    m = _RE_DAILY.match(expr)
    if m:
        hour = int(m.group(1))
        minute = int(m.group(2))
        if not (0 <= hour <= 23 and 0 <= minute <= 59):
            raise ValueError(
                f"Invalid time in daily expression: {hour:02d}:{minute:02d}"
            )
        return _seconds_until_daily(hour, minute)

    raise ValueError(f"Unrecognised schedule expression: {expr!r}")


def _seconds_until_daily(hour: int, minute: int) -> float:
    """Return seconds from now until the next occurrence of HH:MM UTC."""
    now = datetime.now(timezone.utc)
    target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    delta = (target - now).total_seconds()
    if delta <= 0:
        # Already past today's occurrence — schedule for tomorrow
        delta += 86400.0
    return delta


# ---------------------------------------------------------------------------
# LoopScheduler
# ---------------------------------------------------------------------------


class LoopScheduler:
    """Timer-based scheduler for periodic loop execution.

    Uses ``threading.Timer`` with a re-scheduling pattern so that each
    firing sets up the next one, avoiding drift from long-running loop
    starts.

    Args:
        loop_runner: The LoopRunner used to start loops.
    """

    def __init__(self, loop_runner: "LoopRunner") -> None:
        self._loop_runner = loop_runner
        self._schedules: dict[str, str] = {}  # project_id -> cron_expr
        self._timers: dict[str, threading.Timer] = {}
        self._lock = threading.Lock()

    # -- Public API ----------------------------------------------------------

    def schedule_loop(self, project_id: str, cron_expr: str) -> None:
        """Schedule periodic loop execution for a project.

        Parses *cron_expr* to determine the interval, then starts a
        ``threading.Timer`` that fires ``loop_runner.start_loop`` at
        the appropriate time.  Subsequent firings are re-scheduled
        automatically.

        Raises:
            ValueError: If *cron_expr* cannot be parsed or a schedule
                already exists for this project.
        """
        interval = parse_schedule(cron_expr)  # validates expression

        with self._lock:
            if project_id in self._schedules:
                raise ValueError(
                    f"Schedule already exists for project '{project_id}'. "
                    "Cancel it first."
                )
            self._schedules[project_id] = cron_expr

        self._start_timer(project_id, cron_expr, interval)
        logger.info(
            "Scheduled loop for project %s: %s (first fire in %.0fs)",
            project_id,
            cron_expr,
            interval,
        )

    def cancel_schedule(self, project_id: str) -> None:
        """Cancel a previously scheduled loop.

        Raises:
            KeyError: If no schedule exists for the project.
        """
        with self._lock:
            if project_id not in self._schedules:
                raise KeyError(f"No schedule found for project '{project_id}'")
            del self._schedules[project_id]
            timer = self._timers.pop(project_id, None)

        if timer is not None:
            timer.cancel()
            logger.info("Cancelled schedule for project %s", project_id)

    def list_schedules(self) -> dict[str, str]:
        """Return a copy of ``{project_id: cron_expr}`` for all active schedules."""
        with self._lock:
            return dict(self._schedules)

    # -- Internal helpers ----------------------------------------------------

    def _start_timer(self, project_id: str, cron_expr: str, interval: float) -> None:
        """Create and start a Timer that will fire ``_on_timer``."""
        timer = threading.Timer(interval, self._on_timer, args=(project_id, cron_expr))
        timer.daemon = True
        timer.name = f"zephyr-sched-{project_id[:12]}"

        with self._lock:
            # Replace any stale timer reference
            old = self._timers.pop(project_id, None)
            if old is not None:
                old.cancel()
            self._timers[project_id] = timer

        timer.start()

    def _on_timer(self, project_id: str, cron_expr: str) -> None:
        """Callback executed when a scheduled timer fires.

        Starts the loop via LoopRunner and, if the schedule is still
        active, re-schedules the next occurrence.
        """
        with self._lock:
            if project_id not in self._schedules:
                # Schedule was cancelled between fire and callback
                return

        # Attempt to start the loop
        try:
            self._loop_runner.start_loop(
                project_id=project_id,
                mode=LoopMode.SCHEDULED,
            )
            logger.info("Scheduled fire: started loop for project %s", project_id)
        except Exception as exc:
            logger.error(
                "Scheduled fire failed for project %s: %s",
                project_id,
                exc,
            )

        # Re-schedule if still active
        with self._lock:
            if project_id not in self._schedules:
                return

        try:
            next_interval = parse_schedule(cron_expr)
        except ValueError:
            logger.error(
                "Failed to re-parse schedule '%s' for project %s",
                cron_expr,
                project_id,
            )
            return

        self._start_timer(project_id, cron_expr, next_interval)
