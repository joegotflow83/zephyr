"""Tests for the real-time log bridge (src/lib/log_bridge.py).

Verifies:
- LogBridge emits log_received signal when a callback is called.
- Signal carries the correct (project_id, line) payload.
- Callbacks are safe to call from non-Qt background threads.
- Multiple callbacks for different projects work independently.
- Rapid sequential calls are all delivered.
- Empty and multiline strings are handled correctly.
"""

import threading
import time

import pytest
from PyQt6.QtCore import QObject, Qt

from src.lib.log_bridge import LogBridge

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class SignalSpy(QObject):
    """Collects (project_id, line) pairs emitted by LogBridge."""

    def __init__(self):
        super().__init__()
        self.received: list[tuple[str, str]] = []

    def on_log(self, project_id: str, line: str) -> None:
        self.received.append((project_id, line))


# ---------------------------------------------------------------------------
# Tests — basic signal emission
# ---------------------------------------------------------------------------


class TestLogBridgeBasic:
    """Tests that do not involve background threads."""

    def test_create_callback_returns_callable(self, qtbot):
        bridge = LogBridge()
        cb = bridge.create_callback("proj-1")
        assert callable(cb)

    def test_signal_emitted_on_direct_slot_call(self, qtbot):
        """Calling the internal slot directly emits the signal."""
        bridge = LogBridge()
        spy = SignalSpy()
        bridge.log_received.connect(spy.on_log)

        bridge._emit_log("proj-1", "hello world")

        assert spy.received == [("proj-1", "hello world")]

    def test_signal_carries_correct_payload(self, qtbot):
        bridge = LogBridge()
        spy = SignalSpy()
        bridge.log_received.connect(spy.on_log)

        bridge._emit_log("abc-123", "line content here")

        assert len(spy.received) == 1
        pid, line = spy.received[0]
        assert pid == "abc-123"
        assert line == "line content here"

    def test_multiple_direct_calls(self, qtbot):
        bridge = LogBridge()
        spy = SignalSpy()
        bridge.log_received.connect(spy.on_log)

        bridge._emit_log("p1", "first")
        bridge._emit_log("p2", "second")
        bridge._emit_log("p1", "third")

        assert spy.received == [
            ("p1", "first"),
            ("p2", "second"),
            ("p1", "third"),
        ]

    def test_empty_line(self, qtbot):
        bridge = LogBridge()
        spy = SignalSpy()
        bridge.log_received.connect(spy.on_log)

        bridge._emit_log("p1", "")

        assert spy.received == [("p1", "")]

    def test_multiline_content(self, qtbot):
        bridge = LogBridge()
        spy = SignalSpy()
        bridge.log_received.connect(spy.on_log)

        bridge._emit_log("p1", "line1\nline2\nline3")

        assert spy.received == [("p1", "line1\nline2\nline3")]

    def test_unicode_content(self, qtbot):
        bridge = LogBridge()
        spy = SignalSpy()
        bridge.log_received.connect(spy.on_log)

        bridge._emit_log("p1", "émoji 🚀 日本語")

        assert spy.received == [("p1", "émoji 🚀 日本語")]

    def test_long_line(self, qtbot):
        bridge = LogBridge()
        spy = SignalSpy()
        bridge.log_received.connect(spy.on_log)

        long_line = "x" * 10_000
        bridge._emit_log("p1", long_line)

        assert spy.received == [("p1", long_line)]


# ---------------------------------------------------------------------------
# Tests — callback via invokeMethod (queued connection, from main thread)
# ---------------------------------------------------------------------------


class TestLogBridgeCallback:
    """Tests using create_callback with Qt event loop processing."""

    def test_callback_emits_signal(self, qtbot):
        bridge = LogBridge()
        cb = bridge.create_callback("proj-42")

        with qtbot.waitSignal(bridge.log_received, timeout=1000) as blocker:
            cb("test line")

        assert blocker.args == ["proj-42", "test line"]

    def test_two_callbacks_different_projects(self, qtbot):
        bridge = LogBridge()
        spy = SignalSpy()
        bridge.log_received.connect(spy.on_log)

        cb1 = bridge.create_callback("proj-a")
        cb2 = bridge.create_callback("proj-b")

        with qtbot.waitSignal(bridge.log_received, timeout=1000):
            cb1("from A")
        with qtbot.waitSignal(bridge.log_received, timeout=1000):
            cb2("from B")

        assert ("proj-a", "from A") in spy.received
        assert ("proj-b", "from B") in spy.received

    def test_callback_multiple_lines(self, qtbot):
        bridge = LogBridge()
        spy = SignalSpy()
        bridge.log_received.connect(spy.on_log)
        cb = bridge.create_callback("proj-1")

        lines = ["line 1", "line 2", "line 3"]
        for line in lines:
            with qtbot.waitSignal(bridge.log_received, timeout=1000):
                cb(line)

        for i, line in enumerate(lines):
            assert spy.received[i] == ("proj-1", line)


# ---------------------------------------------------------------------------
# Tests — thread safety (callback from non-Qt background thread)
# ---------------------------------------------------------------------------


class TestLogBridgeThreadSafety:
    """Tests that callbacks are safe to call from background threads."""

    def test_callback_from_background_thread(self, qtbot):
        bridge = LogBridge()

        with qtbot.waitSignal(bridge.log_received, timeout=2000) as blocker:
            cb = bridge.create_callback("bg-proj")
            t = threading.Thread(target=cb, args=("background line",))
            t.start()

        t.join(timeout=2)
        assert blocker.args == ["bg-proj", "background line"]

    def test_multiple_lines_from_background_thread(self, qtbot):
        bridge = LogBridge()
        spy = SignalSpy()
        bridge.log_received.connect(spy.on_log)
        cb = bridge.create_callback("bg-proj")

        num_lines = 20
        barrier = threading.Event()

        def worker():
            for i in range(num_lines):
                cb(f"line {i}")
            barrier.set()

        t = threading.Thread(target=worker)
        t.start()

        # Wait for worker to finish sending
        barrier.wait(timeout=5)
        t.join(timeout=2)

        # Process pending events so queued signals are delivered
        qtbot.waitUntil(lambda: len(spy.received) >= num_lines, timeout=3000)

        assert len(spy.received) == num_lines
        for i in range(num_lines):
            assert spy.received[i] == ("bg-proj", f"line {i}")

    def test_concurrent_threads_different_projects(self, qtbot):
        bridge = LogBridge()
        spy = SignalSpy()
        bridge.log_received.connect(spy.on_log)

        cb_a = bridge.create_callback("proj-a")
        cb_b = bridge.create_callback("proj-b")
        lines_per_thread = 10

        barrier = threading.Barrier(2)

        def worker(cb, project_tag):
            barrier.wait(timeout=5)
            for i in range(lines_per_thread):
                cb(f"{project_tag} line {i}")

        t1 = threading.Thread(target=worker, args=(cb_a, "A"))
        t2 = threading.Thread(target=worker, args=(cb_b, "B"))
        t1.start()
        t2.start()
        t1.join(timeout=5)
        t2.join(timeout=5)

        total_expected = lines_per_thread * 2
        qtbot.waitUntil(lambda: len(spy.received) >= total_expected, timeout=5000)

        assert len(spy.received) == total_expected
        a_lines = [(p, l) for p, l in spy.received if p == "proj-a"]
        b_lines = [(p, l) for p, l in spy.received if p == "proj-b"]
        assert len(a_lines) == lines_per_thread
        assert len(b_lines) == lines_per_thread

    def test_callback_from_daemon_thread(self, qtbot):
        """Simulates the Docker log streaming pattern (daemon thread)."""
        bridge = LogBridge()
        cb = bridge.create_callback("daemon-proj")

        with qtbot.waitSignal(bridge.log_received, timeout=2000) as blocker:
            t = threading.Thread(target=cb, args=("daemon log line",), daemon=True)
            t.start()

        assert blocker.args == ["daemon-proj", "daemon log line"]

    def test_rapid_fire_from_thread(self, qtbot):
        bridge = LogBridge()
        spy = SignalSpy()
        bridge.log_received.connect(spy.on_log)
        cb = bridge.create_callback("rapid")

        count = 50

        def fire():
            for i in range(count):
                cb(f"r{i}")

        t = threading.Thread(target=fire)
        t.start()
        t.join(timeout=5)

        qtbot.waitUntil(lambda: len(spy.received) >= count, timeout=5000)
        assert len(spy.received) == count


# ---------------------------------------------------------------------------
# Tests — edge cases
# ---------------------------------------------------------------------------


class TestLogBridgeEdgeCases:
    def test_no_connected_slots(self, qtbot):
        """Emitting with no connected slots should not raise."""
        bridge = LogBridge()
        cb = bridge.create_callback("orphan")

        # Should not raise even though nothing is connected
        with qtbot.waitSignal(bridge.log_received, timeout=1000):
            cb("orphan line")

    def test_bridge_with_parent(self, qtbot):
        parent = QObject()
        bridge = LogBridge(parent=parent)
        assert bridge.parent() is parent

    def test_callback_preserves_project_id(self, qtbot):
        """Each callback remembers its own project_id."""
        bridge = LogBridge()
        spy = SignalSpy()
        bridge.log_received.connect(spy.on_log)

        cbs = {}
        for pid in ["aaa", "bbb", "ccc"]:
            cbs[pid] = bridge.create_callback(pid)

        for pid, cb in cbs.items():
            with qtbot.waitSignal(bridge.log_received, timeout=1000):
                cb(f"from {pid}")

        for pid in ["aaa", "bbb", "ccc"]:
            matches = [(p, l) for p, l in spy.received if p == pid]
            assert len(matches) == 1
            assert matches[0][1] == f"from {pid}"

    def test_special_characters_in_project_id(self, qtbot):
        bridge = LogBridge()
        spy = SignalSpy()
        bridge.log_received.connect(spy.on_log)

        pid = "proj/with spaces & special=chars"
        cb = bridge.create_callback(pid)

        with qtbot.waitSignal(bridge.log_received, timeout=1000):
            cb("test")

        assert spy.received == [(pid, "test")]
