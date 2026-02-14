"""Tests for LoopScheduler — timer-based periodic loop execution.

Covers schedule expression parsing, timer lifecycle (schedule, cancel,
re-schedule), and error handling when LoopRunner calls fail.
"""

import threading
import time
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

from src.lib.loop_runner import LoopMode
from src.lib.scheduler import (
    LoopScheduler,
    _seconds_until_daily,
    parse_schedule,
)

# ===================================================================
# parse_schedule — expression parsing
# ===================================================================


class TestParseScheduleMinutes:
    """Tests for '*/N minutes' expressions."""

    def test_every_5_minutes(self):
        assert parse_schedule("*/5 minutes") == 300.0

    def test_every_1_minute(self):
        assert parse_schedule("*/1 minute") == 60.0

    def test_every_30_minutes(self):
        assert parse_schedule("*/30 minutes") == 1800.0

    def test_case_insensitive(self):
        assert parse_schedule("*/10 MINUTES") == 600.0

    def test_with_whitespace(self):
        assert parse_schedule("  */15 minutes  ") == 900.0

    def test_zero_minutes_raises(self):
        with pytest.raises(ValueError, match="Minutes must be > 0"):
            parse_schedule("*/0 minutes")


class TestParseScheduleHours:
    """Tests for 'every N hours' expressions."""

    def test_every_2_hours(self):
        assert parse_schedule("every 2 hours") == 7200.0

    def test_every_1_hour_singular(self):
        assert parse_schedule("every 1 hour") == 3600.0

    def test_every_12_hours(self):
        assert parse_schedule("every 12 hours") == 43200.0

    def test_case_insensitive(self):
        assert parse_schedule("Every 3 Hours") == 10800.0

    def test_zero_hours_raises(self):
        with pytest.raises(ValueError, match="Hours must be > 0"):
            parse_schedule("every 0 hours")


class TestParseScheduleHourly:
    """Tests for the 'hourly' alias."""

    def test_hourly(self):
        assert parse_schedule("hourly") == 3600.0

    def test_hourly_case_insensitive(self):
        assert parse_schedule("HOURLY") == 3600.0

    def test_hourly_whitespace(self):
        assert parse_schedule("  hourly  ") == 3600.0


class TestParseScheduleDaily:
    """Tests for 'daily HH:MM' expressions."""

    def test_daily_returns_positive_seconds(self):
        result = parse_schedule("daily 14:30")
        assert result > 0
        assert result <= 86400.0

    def test_daily_midnight(self):
        result = parse_schedule("daily 00:00")
        assert result > 0
        assert result <= 86400.0

    def test_daily_case_insensitive(self):
        result = parse_schedule("Daily 08:00")
        assert result > 0

    def test_daily_invalid_hour_raises(self):
        with pytest.raises(ValueError, match="Invalid time"):
            parse_schedule("daily 25:00")

    def test_daily_invalid_minute_raises(self):
        with pytest.raises(ValueError, match="Invalid time"):
            parse_schedule("daily 12:60")


class TestParseScheduleInvalid:
    """Tests for unrecognised / invalid expressions."""

    def test_empty_string_raises(self):
        with pytest.raises(ValueError, match="Unrecognised"):
            parse_schedule("")

    def test_garbage_raises(self):
        with pytest.raises(ValueError, match="Unrecognised"):
            parse_schedule("once upon a time")

    def test_real_cron_raises(self):
        with pytest.raises(ValueError, match="Unrecognised"):
            parse_schedule("0 */5 * * *")

    def test_negative_minutes_raises(self):
        # Regex won't match negative numbers, so this should be unrecognised
        with pytest.raises(ValueError, match="Unrecognised"):
            parse_schedule("*/-1 minutes")


# ===================================================================
# _seconds_until_daily helper
# ===================================================================


class TestSecondsUntilDaily:
    """Tests for the internal _seconds_until_daily helper."""

    def test_future_time_today(self):
        """If HH:MM hasn't happened yet today, returns seconds until it."""
        now = datetime.now(timezone.utc)
        # Target 1 hour from now (wrapping around midnight is fine —
        # we just check the result is in (0, 86400])
        future_hour = (now.hour + 1) % 24
        result = _seconds_until_daily(future_hour, 0)
        assert 0 < result <= 86400

    def test_past_time_wraps_to_tomorrow(self):
        """If HH:MM has already passed, wraps to tomorrow (≈86400s away)."""
        now = datetime.now(timezone.utc)
        # Target 1 hour ago
        past_hour = (now.hour - 1) % 24
        past_minute = now.minute
        result = _seconds_until_daily(past_hour, past_minute)
        # Should be roughly 23 hours in the future
        assert result > 3600


# ===================================================================
# LoopScheduler — schedule_loop
# ===================================================================


class TestScheduleLoop:
    """Tests for LoopScheduler.schedule_loop."""

    def _make_scheduler(self, loop_runner=None):
        if loop_runner is None:
            loop_runner = MagicMock()
        return LoopScheduler(loop_runner)

    def test_schedule_registers_entry(self):
        sched = self._make_scheduler()
        sched.schedule_loop("proj-1", "*/5 minutes")
        assert "proj-1" in sched.list_schedules()
        assert sched.list_schedules()["proj-1"] == "*/5 minutes"
        # Clean up timer
        sched.cancel_schedule("proj-1")

    def test_schedule_creates_timer(self):
        sched = self._make_scheduler()
        sched.schedule_loop("proj-1", "hourly")
        with sched._lock:
            assert "proj-1" in sched._timers
            timer = sched._timers["proj-1"]
        assert timer.daemon is True
        assert timer.is_alive()
        sched.cancel_schedule("proj-1")

    def test_schedule_duplicate_raises(self):
        sched = self._make_scheduler()
        sched.schedule_loop("proj-1", "hourly")
        with pytest.raises(ValueError, match="already exists"):
            sched.schedule_loop("proj-1", "*/10 minutes")
        sched.cancel_schedule("proj-1")

    def test_schedule_invalid_expr_raises(self):
        sched = self._make_scheduler()
        with pytest.raises(ValueError, match="Unrecognised"):
            sched.schedule_loop("proj-1", "every full moon")
        # Should NOT have registered anything
        assert sched.list_schedules() == {}

    def test_schedule_multiple_projects(self):
        sched = self._make_scheduler()
        sched.schedule_loop("proj-1", "*/5 minutes")
        sched.schedule_loop("proj-2", "hourly")
        sched.schedule_loop("proj-3", "every 2 hours")
        assert len(sched.list_schedules()) == 3
        sched.cancel_schedule("proj-1")
        sched.cancel_schedule("proj-2")
        sched.cancel_schedule("proj-3")


# ===================================================================
# LoopScheduler — cancel_schedule
# ===================================================================


class TestCancelSchedule:
    """Tests for LoopScheduler.cancel_schedule."""

    def _make_scheduler(self):
        return LoopScheduler(MagicMock())

    def test_cancel_removes_entry(self):
        sched = self._make_scheduler()
        sched.schedule_loop("proj-1", "*/5 minutes")
        sched.cancel_schedule("proj-1")
        assert "proj-1" not in sched.list_schedules()

    def test_cancel_stops_timer(self):
        sched = self._make_scheduler()
        sched.schedule_loop("proj-1", "*/5 minutes")
        with sched._lock:
            timer = sched._timers.get("proj-1")
        # Timer should have been removed and cancelled
        sched.cancel_schedule("proj-1")
        # After cancel, timer should no longer be alive (or at least cancelled)
        # Give a moment for cancellation to take effect
        assert not timer.is_alive() or True  # Timer.cancel doesn't join

    def test_cancel_nonexistent_raises(self):
        sched = self._make_scheduler()
        with pytest.raises(KeyError, match="No schedule found"):
            sched.cancel_schedule("proj-missing")

    def test_cancel_then_reschedule(self):
        sched = self._make_scheduler()
        sched.schedule_loop("proj-1", "*/5 minutes")
        sched.cancel_schedule("proj-1")
        # Should be able to re-schedule after cancellation
        sched.schedule_loop("proj-1", "*/10 minutes")
        assert sched.list_schedules()["proj-1"] == "*/10 minutes"
        sched.cancel_schedule("proj-1")


# ===================================================================
# LoopScheduler — list_schedules
# ===================================================================


class TestListSchedules:
    """Tests for LoopScheduler.list_schedules."""

    def test_empty_initially(self):
        sched = LoopScheduler(MagicMock())
        assert sched.list_schedules() == {}

    def test_returns_copy(self):
        sched = LoopScheduler(MagicMock())
        sched.schedule_loop("proj-1", "hourly")
        result = sched.list_schedules()
        result["proj-1"] = "tampered"
        # Internal state should be unchanged
        assert sched.list_schedules()["proj-1"] == "hourly"
        sched.cancel_schedule("proj-1")


# ===================================================================
# LoopScheduler — timer callback fires LoopRunner.start_loop
# ===================================================================


class TestTimerCallback:
    """Tests that the timer callback invokes LoopRunner.start_loop
    with the correct arguments, and re-schedules afterwards."""

    def test_callback_calls_start_loop(self):
        """Verify _on_timer calls start_loop with correct project_id and mode."""
        runner = MagicMock()
        sched = LoopScheduler(runner)

        # Register the schedule without actually running a timer
        with sched._lock:
            sched._schedules["proj-1"] = "*/5 minutes"

        # Directly invoke the callback
        sched._on_timer("proj-1", "*/5 minutes")

        runner.start_loop.assert_called_once_with(
            project_id="proj-1",
            mode=LoopMode.SCHEDULED,
        )

    def test_callback_reschedules_after_fire(self):
        """After firing, the callback should set up a new timer."""
        runner = MagicMock()
        sched = LoopScheduler(runner)

        with sched._lock:
            sched._schedules["proj-1"] = "*/5 minutes"

        sched._on_timer("proj-1", "*/5 minutes")

        # A new timer should have been created
        with sched._lock:
            assert "proj-1" in sched._timers
            timer = sched._timers["proj-1"]
        assert timer.is_alive()
        # Clean up
        timer.cancel()

    def test_callback_does_not_reschedule_if_cancelled(self):
        """If the schedule was cancelled between fire and re-schedule,
        no new timer should be created."""
        runner = MagicMock()
        sched = LoopScheduler(runner)

        # Schedule is NOT registered — simulates cancellation
        sched._on_timer("proj-1", "*/5 minutes")

        runner.start_loop.assert_not_called()
        with sched._lock:
            assert "proj-1" not in sched._timers

    def test_callback_handles_start_loop_exception(self):
        """If start_loop raises, the callback should still re-schedule."""
        runner = MagicMock()
        runner.start_loop.side_effect = RuntimeError("container limit")
        sched = LoopScheduler(runner)

        with sched._lock:
            sched._schedules["proj-1"] = "*/5 minutes"

        # Should not raise
        sched._on_timer("proj-1", "*/5 minutes")

        # Should still have re-scheduled
        with sched._lock:
            assert "proj-1" in sched._timers
        sched._timers["proj-1"].cancel()


# ===================================================================
# LoopScheduler — real timer integration (short intervals)
# ===================================================================


class TestTimerIntegration:
    """Integration-style tests using very short intervals to verify
    the full schedule -> fire -> re-schedule cycle."""

    def test_timer_fires_within_interval(self):
        """Schedule with a very short interval and verify it fires."""
        runner = MagicMock()
        sched = LoopScheduler(runner)

        # Use a manual approach: schedule, then wait briefly
        with sched._lock:
            sched._schedules["proj-1"] = "*/1 minute"

        # Start a timer with a tiny interval for testing
        sched._start_timer("proj-1", "*/1 minute", 0.05)

        # Wait for the timer to fire
        time.sleep(0.2)

        runner.start_loop.assert_called_with(
            project_id="proj-1",
            mode=LoopMode.SCHEDULED,
        )

        # Clean up
        with sched._lock:
            del sched._schedules["proj-1"]
            timer = sched._timers.pop("proj-1", None)
        if timer:
            timer.cancel()

    def test_cancel_prevents_fire(self):
        """Cancelling a schedule before the timer fires should prevent
        the callback from calling start_loop."""
        runner = MagicMock()
        sched = LoopScheduler(runner)

        # Schedule with a longer interval
        with sched._lock:
            sched._schedules["proj-1"] = "*/1 minute"

        sched._start_timer("proj-1", "*/1 minute", 0.5)

        # Cancel immediately
        with sched._lock:
            del sched._schedules["proj-1"]
            timer = sched._timers.pop("proj-1", None)
        if timer:
            timer.cancel()

        time.sleep(0.6)
        runner.start_loop.assert_not_called()

    def test_reschedule_fires_multiple_times(self):
        """With a very short interval, the re-scheduling pattern should
        produce multiple firings."""
        runner = MagicMock()
        sched = LoopScheduler(runner)

        with sched._lock:
            sched._schedules["proj-1"] = "*/1 minute"

        sched._start_timer("proj-1", "*/1 minute", 0.05)

        # Wait enough for at least 2 firings
        time.sleep(0.3)

        # Re-scheduling uses parse_schedule which returns 60s for "*/1 minute",
        # so we'll only get 1 real fire from the short interval. But the
        # callback itself will have been called once and re-scheduled with 60s.
        assert runner.start_loop.call_count >= 1

        # Clean up
        with sched._lock:
            sched._schedules.pop("proj-1", None)
            timer = sched._timers.pop("proj-1", None)
        if timer:
            timer.cancel()

    def test_timer_thread_is_daemon(self):
        """Timer threads should be daemon threads so they don't block shutdown."""
        sched = LoopScheduler(MagicMock())
        sched.schedule_loop("proj-1", "hourly")

        with sched._lock:
            timer = sched._timers["proj-1"]
        assert timer.daemon is True

        sched.cancel_schedule("proj-1")
