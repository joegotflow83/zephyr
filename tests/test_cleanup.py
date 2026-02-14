"""Tests for CleanupManager — graceful shutdown and container cleanup."""

import signal
import threading
from unittest.mock import MagicMock, call, patch

import pytest

from src.lib.cleanup import CleanupManager

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def cleanup():
    """Return a fresh CleanupManager instance."""
    return CleanupManager()


@pytest.fixture
def mock_docker():
    """Return a mock DockerManager with stop/remove methods."""
    dm = MagicMock()
    dm.stop_container = MagicMock()
    dm.remove_container = MagicMock()
    return dm


# ---------------------------------------------------------------------------
# Container tracking
# ---------------------------------------------------------------------------


class TestRegisterContainer:
    """Tests for register_container."""

    def test_register_single(self, cleanup):
        cleanup.register_container("abc123")
        assert "abc123" in cleanup.tracked_containers

    def test_register_multiple(self, cleanup):
        cleanup.register_container("c1")
        cleanup.register_container("c2")
        cleanup.register_container("c3")
        assert set(cleanup.tracked_containers) == {"c1", "c2", "c3"}

    def test_register_duplicate_is_idempotent(self, cleanup):
        cleanup.register_container("c1")
        cleanup.register_container("c1")
        assert cleanup.tracked_containers == ["c1"]

    def test_has_active_containers_after_register(self, cleanup):
        assert not cleanup.has_active_containers
        cleanup.register_container("c1")
        assert cleanup.has_active_containers


class TestUnregisterContainer:
    """Tests for unregister_container."""

    def test_unregister_tracked(self, cleanup):
        cleanup.register_container("c1")
        cleanup.unregister_container("c1")
        assert "c1" not in cleanup.tracked_containers

    def test_unregister_unknown_is_noop(self, cleanup):
        cleanup.unregister_container("nonexistent")
        assert cleanup.tracked_containers == []

    def test_has_active_false_after_unregister_all(self, cleanup):
        cleanup.register_container("c1")
        cleanup.unregister_container("c1")
        assert not cleanup.has_active_containers


class TestTrackedContainers:
    """Tests for the tracked_containers property."""

    def test_returns_copy(self, cleanup):
        cleanup.register_container("c1")
        snapshot = cleanup.tracked_containers
        snapshot.append("c2")  # mutate the copy
        assert "c2" not in cleanup.tracked_containers

    def test_empty_initially(self, cleanup):
        assert cleanup.tracked_containers == []


# ---------------------------------------------------------------------------
# Thread safety
# ---------------------------------------------------------------------------


class TestThreadSafety:
    """Verify container tracking is safe across threads."""

    def test_concurrent_register(self, cleanup):
        """Register containers from many threads concurrently."""
        ids = [f"c{i}" for i in range(100)]
        threads = []
        for cid in ids:
            t = threading.Thread(target=cleanup.register_container, args=(cid,))
            threads.append(t)
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert set(cleanup.tracked_containers) == set(ids)

    def test_concurrent_unregister(self, cleanup):
        """Unregister containers from many threads concurrently."""
        ids = [f"c{i}" for i in range(50)]
        for cid in ids:
            cleanup.register_container(cid)

        threads = []
        for cid in ids:
            t = threading.Thread(target=cleanup.unregister_container, args=(cid,))
            threads.append(t)
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert cleanup.tracked_containers == []


# ---------------------------------------------------------------------------
# cleanup_all
# ---------------------------------------------------------------------------


class TestCleanupAll:
    """Tests for cleanup_all."""

    def test_no_containers(self, cleanup, mock_docker):
        result = cleanup.cleanup_all(mock_docker)
        assert result == []
        mock_docker.stop_container.assert_not_called()
        mock_docker.remove_container.assert_not_called()

    def test_single_container(self, cleanup, mock_docker):
        cleanup.register_container("c1")
        result = cleanup.cleanup_all(mock_docker)
        assert result == ["c1"]
        mock_docker.stop_container.assert_called_once_with("c1", timeout=30)
        mock_docker.remove_container.assert_called_once_with("c1", force=True)

    def test_multiple_containers(self, cleanup, mock_docker):
        cleanup.register_container("c1")
        cleanup.register_container("c2")
        cleanup.register_container("c3")
        result = cleanup.cleanup_all(mock_docker)
        assert set(result) == {"c1", "c2", "c3"}
        assert mock_docker.stop_container.call_count == 3
        assert mock_docker.remove_container.call_count == 3

    def test_custom_timeout(self, cleanup, mock_docker):
        cleanup.register_container("c1")
        cleanup.cleanup_all(mock_docker, timeout=60)
        mock_docker.stop_container.assert_called_once_with("c1", timeout=60)

    def test_containers_cleared_after_cleanup(self, cleanup, mock_docker):
        cleanup.register_container("c1")
        cleanup.register_container("c2")
        cleanup.cleanup_all(mock_docker)
        assert not cleanup.has_active_containers
        assert cleanup.tracked_containers == []

    def test_stop_failure_still_removes(self, cleanup, mock_docker):
        """If stop fails, remove is still attempted."""
        mock_docker.stop_container.side_effect = Exception("stop failed")
        cleanup.register_container("c1")
        result = cleanup.cleanup_all(mock_docker)
        assert result == ["c1"]
        mock_docker.remove_container.assert_called_once_with("c1", force=True)

    def test_remove_failure_still_tracked_as_cleaned(self, cleanup, mock_docker):
        """If remove fails, the container is still returned as cleaned."""
        mock_docker.remove_container.side_effect = Exception("remove failed")
        cleanup.register_container("c1")
        result = cleanup.cleanup_all(mock_docker)
        assert result == ["c1"]
        # Container should be removed from tracking even if docker remove failed
        assert not cleanup.has_active_containers

    def test_both_stop_and_remove_fail(self, cleanup, mock_docker):
        """Both operations fail but cleanup still completes without raising."""
        mock_docker.stop_container.side_effect = Exception("stop failed")
        mock_docker.remove_container.side_effect = Exception("remove failed")
        cleanup.register_container("c1")
        result = cleanup.cleanup_all(mock_docker)
        assert result == ["c1"]
        assert not cleanup.has_active_containers

    def test_partial_failure(self, cleanup, mock_docker):
        """One container fails, others succeed."""

        def stop_side_effect(cid, timeout=30):
            if cid == "c2":
                raise Exception("stop c2 failed")

        mock_docker.stop_container.side_effect = stop_side_effect

        cleanup.register_container("c1")
        cleanup.register_container("c2")
        cleanup.register_container("c3")
        result = cleanup.cleanup_all(mock_docker)
        assert set(result) == {"c1", "c2", "c3"}
        assert mock_docker.remove_container.call_count == 3

    def test_cleanup_all_idempotent(self, cleanup, mock_docker):
        """Calling cleanup_all twice returns empty on second call."""
        cleanup.register_container("c1")
        first = cleanup.cleanup_all(mock_docker)
        second = cleanup.cleanup_all(mock_docker)
        assert first == ["c1"]
        assert second == []


# ---------------------------------------------------------------------------
# Signal handler installation
# ---------------------------------------------------------------------------


class TestSignalHandlers:
    """Tests for install_signal_handlers."""

    def test_handlers_are_installed(self, cleanup):
        """SIGINT and SIGTERM handlers are replaced."""
        original_int = signal.getsignal(signal.SIGINT)
        original_term = signal.getsignal(signal.SIGTERM)
        callback = MagicMock()

        try:
            cleanup.install_signal_handlers(callback)
            new_int = signal.getsignal(signal.SIGINT)
            new_term = signal.getsignal(signal.SIGTERM)
            assert new_int is not original_int
            assert new_term is not original_term
        finally:
            # Restore original handlers
            signal.signal(signal.SIGINT, original_int)
            signal.signal(signal.SIGTERM, original_term)

    def test_originals_are_saved(self, cleanup):
        """Original handlers are saved for later restoration."""
        original_int = signal.getsignal(signal.SIGINT)
        original_term = signal.getsignal(signal.SIGTERM)
        callback = MagicMock()

        try:
            cleanup.install_signal_handlers(callback)
            assert cleanup._original_sigint is original_int
            assert cleanup._original_sigterm is original_term
        finally:
            signal.signal(signal.SIGINT, original_int)
            signal.signal(signal.SIGTERM, original_term)

    def test_callback_called_on_signal(self, cleanup):
        """The cleanup callback is invoked when a signal is received."""
        original_int = signal.getsignal(signal.SIGINT)
        original_term = signal.getsignal(signal.SIGTERM)
        callback = MagicMock()

        # Set originals to SIG_DFL so they don't raise
        signal.signal(signal.SIGINT, signal.SIG_DFL)
        signal.signal(signal.SIGTERM, signal.SIG_DFL)

        try:
            cleanup.install_signal_handlers(callback)
            handler = signal.getsignal(signal.SIGTERM)
            # Invoke the handler directly (simulates receiving SIGTERM)
            handler(signal.SIGTERM, None)
            callback.assert_called_once()
        finally:
            signal.signal(signal.SIGINT, original_int)
            signal.signal(signal.SIGTERM, original_term)

    def test_handler_restores_originals_after_first_signal(self, cleanup):
        """After first signal, original handlers are restored so
        a second signal terminates immediately."""
        original_int = signal.getsignal(signal.SIGINT)
        original_term = signal.getsignal(signal.SIGTERM)
        sentinel_handler = lambda s, f: None  # noqa: E731

        signal.signal(signal.SIGINT, sentinel_handler)
        signal.signal(signal.SIGTERM, sentinel_handler)

        try:
            cleanup.install_signal_handlers(MagicMock())
            handler = signal.getsignal(signal.SIGTERM)
            handler(signal.SIGTERM, None)
            # After callback, originals (sentinel_handler) should be restored
            assert signal.getsignal(signal.SIGINT) is sentinel_handler
            assert signal.getsignal(signal.SIGTERM) is sentinel_handler
        finally:
            signal.signal(signal.SIGINT, original_int)
            signal.signal(signal.SIGTERM, original_term)

    def test_callback_exception_does_not_crash(self, cleanup):
        """If the cleanup callback raises, the handler does not propagate."""
        original_int = signal.getsignal(signal.SIGINT)
        original_term = signal.getsignal(signal.SIGTERM)

        signal.signal(signal.SIGINT, signal.SIG_DFL)
        signal.signal(signal.SIGTERM, signal.SIG_DFL)

        callback = MagicMock(side_effect=RuntimeError("boom"))

        try:
            cleanup.install_signal_handlers(callback)
            handler = signal.getsignal(signal.SIGTERM)
            # Should not raise
            handler(signal.SIGTERM, None)
            callback.assert_called_once()
        finally:
            signal.signal(signal.SIGINT, original_int)
            signal.signal(signal.SIGTERM, original_term)


# ---------------------------------------------------------------------------
# Integration-style: cleanup_all used as signal callback
# ---------------------------------------------------------------------------


class TestSignalWithCleanup:
    """Verify signal handlers work with cleanup_all as the callback."""

    def test_signal_triggers_cleanup(self, cleanup, mock_docker):
        """SIGTERM triggers cleanup_all which stops/removes containers."""
        original_int = signal.getsignal(signal.SIGINT)
        original_term = signal.getsignal(signal.SIGTERM)

        signal.signal(signal.SIGINT, signal.SIG_DFL)
        signal.signal(signal.SIGTERM, signal.SIG_DFL)

        try:
            cleanup.register_container("c1")
            cleanup.register_container("c2")

            cleanup.install_signal_handlers(lambda: cleanup.cleanup_all(mock_docker))

            handler = signal.getsignal(signal.SIGTERM)
            handler(signal.SIGTERM, None)

            assert mock_docker.stop_container.call_count == 2
            assert mock_docker.remove_container.call_count == 2
            assert not cleanup.has_active_containers
        finally:
            signal.signal(signal.SIGINT, original_int)
            signal.signal(signal.SIGTERM, original_term)
