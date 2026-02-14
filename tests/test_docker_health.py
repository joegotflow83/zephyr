"""Tests for DockerHealthMonitor.

Verifies background polling, connect/disconnect signal transitions,
thread safety, start/stop lifecycle, and edge cases.
"""

import threading
import time
from unittest.mock import MagicMock, patch

import pytest
from PyQt6.QtCore import QCoreApplication

from src.lib.docker_health import DockerHealthMonitor

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _process_events(timeout_ms: int = 100) -> None:
    """Process pending Qt events so queued signals get delivered."""
    app = QCoreApplication.instance()
    if app is not None:
        app.processEvents()
        # Give queued connections time to be delivered
        deadline = time.monotonic() + timeout_ms / 1000
        while time.monotonic() < deadline:
            app.processEvents()
            time.sleep(0.01)


# ---------------------------------------------------------------------------
# Construction
# ---------------------------------------------------------------------------


class TestDockerHealthMonitorConstruction:
    """Tests for DockerHealthMonitor initialization."""

    def test_default_construction(self, qtbot):
        """Monitor can be created with a DockerManager."""
        dm = MagicMock()
        monitor = DockerHealthMonitor(dm)
        assert monitor.is_connected() is False
        assert monitor._poll_interval == 30.0
        assert monitor._running is False

    def test_custom_poll_interval(self, qtbot):
        """Custom poll interval is respected."""
        dm = MagicMock()
        monitor = DockerHealthMonitor(dm, poll_interval=5.0)
        assert monitor._poll_interval == 5.0

    def test_initial_state_is_disconnected(self, qtbot):
        """Before start(), is_connected returns False."""
        dm = MagicMock()
        monitor = DockerHealthMonitor(dm)
        assert monitor.is_connected() is False


# ---------------------------------------------------------------------------
# Start / Stop lifecycle
# ---------------------------------------------------------------------------


class TestStartStop:
    """Tests for start() and stop() lifecycle management."""

    def test_start_creates_thread(self, qtbot):
        """start() creates and starts a daemon thread."""
        dm = MagicMock()
        dm.is_docker_available.return_value = True
        monitor = DockerHealthMonitor(dm, poll_interval=0.05)

        monitor.start()
        try:
            assert monitor._running is True
            assert monitor._thread is not None
            assert monitor._thread.is_alive()
            assert monitor._thread.daemon is True
            assert monitor._thread.name == "zephyr-docker-health"
        finally:
            monitor.stop()

    def test_start_checks_initial_state(self, qtbot):
        """start() does an immediate check of Docker availability."""
        dm = MagicMock()
        dm.is_docker_available.return_value = True
        monitor = DockerHealthMonitor(dm, poll_interval=0.05)

        monitor.start()
        try:
            assert monitor.is_connected() is True
        finally:
            monitor.stop()

    def test_start_initial_disconnected(self, qtbot):
        """start() records initial disconnected state correctly."""
        dm = MagicMock()
        dm.is_docker_available.return_value = False
        monitor = DockerHealthMonitor(dm, poll_interval=0.05)

        monitor.start()
        try:
            assert monitor.is_connected() is False
        finally:
            monitor.stop()

    def test_double_start_is_noop(self, qtbot):
        """Calling start() twice does not create a second thread."""
        dm = MagicMock()
        dm.is_docker_available.return_value = True
        monitor = DockerHealthMonitor(dm, poll_interval=0.05)

        monitor.start()
        first_thread = monitor._thread
        monitor.start()
        try:
            assert monitor._thread is first_thread
        finally:
            monitor.stop()

    def test_stop_terminates_thread(self, qtbot):
        """stop() signals the thread to exit and joins it."""
        dm = MagicMock()
        dm.is_docker_available.return_value = True
        monitor = DockerHealthMonitor(dm, poll_interval=0.05)

        monitor.start()
        thread = monitor._thread
        monitor.stop()

        assert monitor._running is False
        assert monitor._thread is None
        assert not thread.is_alive()

    def test_double_stop_is_noop(self, qtbot):
        """Calling stop() twice does not raise."""
        dm = MagicMock()
        dm.is_docker_available.return_value = True
        monitor = DockerHealthMonitor(dm, poll_interval=0.05)

        monitor.start()
        monitor.stop()
        monitor.stop()  # should not raise

    def test_stop_without_start(self, qtbot):
        """stop() without start() does nothing."""
        dm = MagicMock()
        monitor = DockerHealthMonitor(dm, poll_interval=0.05)
        monitor.stop()  # should not raise


# ---------------------------------------------------------------------------
# Connection state transitions
# ---------------------------------------------------------------------------


class TestConnectionTransitions:
    """Tests for docker_connected / docker_disconnected signal emissions."""

    def test_connected_to_disconnected_emits_signal(self, qtbot):
        """When Docker goes from available to unavailable, emits docker_disconnected."""
        dm = MagicMock()
        call_count = [0]

        def side_effect():
            call_count[0] += 1
            # First call (from start()) returns True, then switches to False
            if call_count[0] <= 1:
                return True
            return False

        dm.is_docker_available.side_effect = side_effect
        monitor = DockerHealthMonitor(dm, poll_interval=0.05)

        disconnected_received = []
        monitor.docker_disconnected.connect(lambda: disconnected_received.append(True))

        monitor.start()
        try:
            # Wait for the polling thread to detect disconnection
            deadline = time.monotonic() + 2.0
            while not disconnected_received and time.monotonic() < deadline:
                _process_events(50)
                time.sleep(0.02)

            assert len(disconnected_received) >= 1
            assert monitor.is_connected() is False
        finally:
            monitor.stop()

    def test_disconnected_to_connected_emits_signal(self, qtbot):
        """When Docker goes from unavailable to available, emits docker_connected."""
        dm = MagicMock()
        call_count = [0]

        def side_effect():
            call_count[0] += 1
            # First call (from start()) returns False, then switches to True
            if call_count[0] <= 1:
                return False
            return True

        dm.is_docker_available.side_effect = side_effect
        monitor = DockerHealthMonitor(dm, poll_interval=0.05)

        connected_received = []
        monitor.docker_connected.connect(lambda: connected_received.append(True))

        monitor.start()
        try:
            deadline = time.monotonic() + 2.0
            while not connected_received and time.monotonic() < deadline:
                _process_events(50)
                time.sleep(0.02)

            assert len(connected_received) >= 1
            assert monitor.is_connected() is True
        finally:
            monitor.stop()

    def test_stable_connected_no_signal(self, qtbot):
        """When Docker stays available, no transition signals are emitted."""
        dm = MagicMock()
        dm.is_docker_available.return_value = True
        monitor = DockerHealthMonitor(dm, poll_interval=0.05)

        connected_signals = []
        disconnected_signals = []
        monitor.docker_connected.connect(lambda: connected_signals.append(True))
        monitor.docker_disconnected.connect(lambda: disconnected_signals.append(True))

        monitor.start()
        try:
            # Let several polls happen
            time.sleep(0.3)
            _process_events(100)

            assert len(connected_signals) == 0
            assert len(disconnected_signals) == 0
        finally:
            monitor.stop()

    def test_stable_disconnected_no_signal(self, qtbot):
        """When Docker stays unavailable, no transition signals are emitted."""
        dm = MagicMock()
        dm.is_docker_available.return_value = False
        monitor = DockerHealthMonitor(dm, poll_interval=0.05)

        connected_signals = []
        disconnected_signals = []
        monitor.docker_connected.connect(lambda: connected_signals.append(True))
        monitor.docker_disconnected.connect(lambda: disconnected_signals.append(True))

        monitor.start()
        try:
            time.sleep(0.3)
            _process_events(100)

            assert len(connected_signals) == 0
            assert len(disconnected_signals) == 0
        finally:
            monitor.stop()

    def test_flapping_connection(self, qtbot):
        """Multiple connect/disconnect transitions each emit signals."""
        dm = MagicMock()
        call_count = [0]

        def side_effect():
            call_count[0] += 1
            # start(): True, poll 1: False, poll 2: True, poll 3: False
            if call_count[0] <= 1:
                return True
            return (call_count[0] % 2) == 0  # alternates

        dm.is_docker_available.side_effect = side_effect
        monitor = DockerHealthMonitor(dm, poll_interval=0.05)

        connected_signals = []
        disconnected_signals = []
        monitor.docker_connected.connect(lambda: connected_signals.append(True))
        monitor.docker_disconnected.connect(lambda: disconnected_signals.append(True))

        monitor.start()
        try:
            deadline = time.monotonic() + 2.0
            while (
                len(connected_signals) < 1 or len(disconnected_signals) < 1
            ) and time.monotonic() < deadline:
                _process_events(50)
                time.sleep(0.02)

            assert len(disconnected_signals) >= 1
            assert len(connected_signals) >= 1
        finally:
            monitor.stop()


# ---------------------------------------------------------------------------
# Error handling in poll
# ---------------------------------------------------------------------------


class TestPollingErrors:
    """Tests for resilience when is_docker_available raises exceptions."""

    def test_exception_treated_as_disconnected(self, qtbot):
        """If is_docker_available raises, treat Docker as unavailable."""
        dm = MagicMock()
        call_count = [0]

        def side_effect():
            call_count[0] += 1
            if call_count[0] <= 1:
                return True  # start() check: connected
            raise RuntimeError("Socket error")

        dm.is_docker_available.side_effect = side_effect
        monitor = DockerHealthMonitor(dm, poll_interval=0.05)

        disconnected_received = []
        monitor.docker_disconnected.connect(lambda: disconnected_received.append(True))

        monitor.start()
        try:
            deadline = time.monotonic() + 2.0
            while not disconnected_received and time.monotonic() < deadline:
                _process_events(50)
                time.sleep(0.02)

            assert len(disconnected_received) >= 1
            assert monitor.is_connected() is False
        finally:
            monitor.stop()

    def test_exception_does_not_crash_thread(self, qtbot):
        """Exceptions from is_docker_available don't stop the polling thread."""
        dm = MagicMock()
        call_count = [0]

        def side_effect():
            call_count[0] += 1
            if call_count[0] <= 1:
                return False  # initial: disconnected
            if call_count[0] <= 3:
                raise RuntimeError("Temporary failure")
            return True  # recovers

        dm.is_docker_available.side_effect = side_effect
        monitor = DockerHealthMonitor(dm, poll_interval=0.05)

        connected_received = []
        monitor.docker_connected.connect(lambda: connected_received.append(True))

        monitor.start()
        try:
            deadline = time.monotonic() + 2.0
            while not connected_received and time.monotonic() < deadline:
                _process_events(50)
                time.sleep(0.02)

            # Thread survived exceptions and detected recovery
            assert len(connected_received) >= 1
            assert monitor.is_connected() is True
        finally:
            monitor.stop()


# ---------------------------------------------------------------------------
# is_connected state tracking
# ---------------------------------------------------------------------------


class TestIsConnected:
    """Tests for the is_connected() state query."""

    def test_reflects_initial_check_true(self, qtbot):
        dm = MagicMock()
        dm.is_docker_available.return_value = True
        monitor = DockerHealthMonitor(dm, poll_interval=0.05)
        monitor.start()
        try:
            assert monitor.is_connected() is True
        finally:
            monitor.stop()

    def test_reflects_initial_check_false(self, qtbot):
        dm = MagicMock()
        dm.is_docker_available.return_value = False
        monitor = DockerHealthMonitor(dm, poll_interval=0.05)
        monitor.start()
        try:
            assert monitor.is_connected() is False
        finally:
            monitor.stop()

    def test_updates_on_state_change(self, qtbot):
        """is_connected() updates as the poll detects changes."""
        dm = MagicMock()
        call_count = [0]

        def side_effect():
            call_count[0] += 1
            if call_count[0] <= 1:
                return True
            return False

        dm.is_docker_available.side_effect = side_effect
        monitor = DockerHealthMonitor(dm, poll_interval=0.05)
        monitor.start()
        try:
            # Wait for state to update
            deadline = time.monotonic() + 2.0
            while monitor.is_connected() and time.monotonic() < deadline:
                time.sleep(0.02)

            assert monitor.is_connected() is False
        finally:
            monitor.stop()


# ---------------------------------------------------------------------------
# Thread safety
# ---------------------------------------------------------------------------


class TestThreadSafety:
    """Tests for thread-safe signal delivery."""

    def test_signals_delivered_on_main_thread(self, qtbot):
        """Verify signals arrive on the main thread, not the polling thread."""
        dm = MagicMock()
        call_count = [0]

        def side_effect():
            call_count[0] += 1
            if call_count[0] <= 1:
                return False
            return True

        dm.is_docker_available.side_effect = side_effect
        monitor = DockerHealthMonitor(dm, poll_interval=0.05)

        signal_thread_ids = []
        main_thread_id = threading.current_thread().ident

        def on_connected():
            signal_thread_ids.append(threading.current_thread().ident)

        monitor.docker_connected.connect(on_connected)
        monitor.start()
        try:
            deadline = time.monotonic() + 2.0
            while not signal_thread_ids and time.monotonic() < deadline:
                _process_events(50)
                time.sleep(0.02)

            assert len(signal_thread_ids) >= 1
            assert signal_thread_ids[0] == main_thread_id
        finally:
            monitor.stop()

    def test_polling_thread_is_daemon(self, qtbot):
        """Polling thread is a daemon so it doesn't block app shutdown."""
        dm = MagicMock()
        dm.is_docker_available.return_value = True
        monitor = DockerHealthMonitor(dm, poll_interval=0.05)
        monitor.start()
        try:
            assert monitor._thread.daemon is True
        finally:
            monitor.stop()


# ---------------------------------------------------------------------------
# Stop event responsiveness
# ---------------------------------------------------------------------------


class TestStopResponsiveness:
    """Tests that stop() interrupts the poll sleep promptly."""

    def test_stop_does_not_wait_full_interval(self, qtbot):
        """stop() should return quickly, not wait for the full poll interval."""
        dm = MagicMock()
        dm.is_docker_available.return_value = True
        # Long poll interval to prove stop doesn't wait
        monitor = DockerHealthMonitor(dm, poll_interval=30.0)

        monitor.start()
        start_time = time.monotonic()
        monitor.stop()
        elapsed = time.monotonic() - start_time

        # Should stop within a couple seconds, not 30
        assert elapsed < 5.0
