"""Tests for src/lib/logging_config.py — comprehensive logging configuration."""

import io
import logging
import os
from logging.handlers import RotatingFileHandler
from pathlib import Path
from unittest import mock

import pytest

from src.lib.logging_config import (
    _BACKUP_COUNT,
    _DEFAULT_FORMAT,
    _MAX_BYTES,
    _ColouredFormatter,
    _LEVEL_COLOURS,
    _RESET,
    _supports_colour,
    setup_logging,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _get_zephyr_logger() -> logging.Logger:
    return logging.getLogger("zephyr")


def _handler_types(logger: logging.Logger) -> list[type]:
    return [type(h) for h in logger.handlers]


# ---------------------------------------------------------------------------
# setup_logging — handler creation
# ---------------------------------------------------------------------------


class TestSetupLoggingHandlers:
    """Verify that setup_logging attaches the expected handlers."""

    def test_creates_console_handler(self, tmp_path: Path):
        setup_logging(log_dir=tmp_path)
        logger = _get_zephyr_logger()
        assert logging.StreamHandler in _handler_types(logger)

    def test_creates_file_handler(self, tmp_path: Path):
        setup_logging(log_dir=tmp_path)
        logger = _get_zephyr_logger()
        assert RotatingFileHandler in _handler_types(logger)

    def test_two_handlers_total(self, tmp_path: Path):
        setup_logging(log_dir=tmp_path)
        logger = _get_zephyr_logger()
        assert len(logger.handlers) == 2

    def test_no_duplicate_handlers_on_repeated_call(self, tmp_path: Path):
        setup_logging(log_dir=tmp_path)
        setup_logging(log_dir=tmp_path)
        logger = _get_zephyr_logger()
        assert len(logger.handlers) == 2

    def test_logger_level_set_to_requested(self, tmp_path: Path):
        setup_logging(log_level="DEBUG", log_dir=tmp_path)
        assert _get_zephyr_logger().level == logging.DEBUG

    def test_default_level_is_info(self, tmp_path: Path):
        setup_logging(log_dir=tmp_path)
        assert _get_zephyr_logger().level == logging.INFO

    def test_invalid_level_falls_back_to_info(self, tmp_path: Path):
        setup_logging(log_level="BOGUS", log_dir=tmp_path)
        assert _get_zephyr_logger().level == logging.INFO

    def test_case_insensitive_level(self, tmp_path: Path):
        setup_logging(log_level="warning", log_dir=tmp_path)
        assert _get_zephyr_logger().level == logging.WARNING


# ---------------------------------------------------------------------------
# File handler specifics
# ---------------------------------------------------------------------------


class TestFileHandler:
    """Verify file handler writes to the correct path with rotation config."""

    def _get_file_handler(self, logger: logging.Logger) -> RotatingFileHandler:
        for h in logger.handlers:
            if isinstance(h, RotatingFileHandler):
                return h
        raise AssertionError("No RotatingFileHandler found")

    def test_log_file_created_in_log_dir(self, tmp_path: Path):
        setup_logging(log_dir=tmp_path)
        log_files = list(tmp_path.glob("zephyr-*.log"))
        assert len(log_files) == 1

    def test_log_file_name_contains_date(self, tmp_path: Path):
        setup_logging(log_dir=tmp_path)
        log_files = list(tmp_path.glob("zephyr-*.log"))
        name = log_files[0].name
        # Should look like zephyr-YYYY-MM-DD.log
        assert name.startswith("zephyr-")
        assert name.endswith(".log")
        date_part = name[len("zephyr-") : -len(".log")]
        parts = date_part.split("-")
        assert len(parts) == 3
        assert all(p.isdigit() for p in parts)

    def test_rotation_max_bytes(self, tmp_path: Path):
        setup_logging(log_dir=tmp_path)
        fh = self._get_file_handler(_get_zephyr_logger())
        assert fh.maxBytes == _MAX_BYTES

    def test_rotation_backup_count(self, tmp_path: Path):
        setup_logging(log_dir=tmp_path)
        fh = self._get_file_handler(_get_zephyr_logger())
        assert fh.backupCount == _BACKUP_COUNT

    def test_max_bytes_is_10mb(self):
        assert _MAX_BYTES == 10 * 1024 * 1024

    def test_backup_count_is_5(self):
        assert _BACKUP_COUNT == 5

    def test_file_handler_encoding_is_utf8(self, tmp_path: Path):
        setup_logging(log_dir=tmp_path)
        fh = self._get_file_handler(_get_zephyr_logger())
        assert fh.encoding == "utf-8"

    def test_file_handler_writes_log_message(self, tmp_path: Path):
        setup_logging(log_level="INFO", log_dir=tmp_path)
        test_logger = logging.getLogger("zephyr.test.file_write")
        test_logger.info("hello from test")
        # Flush handlers
        for h in _get_zephyr_logger().handlers:
            h.flush()
        log_files = list(tmp_path.glob("zephyr-*.log"))
        content = log_files[0].read_text()
        assert "hello from test" in content

    def test_file_handler_level_matches_requested(self, tmp_path: Path):
        setup_logging(log_level="WARNING", log_dir=tmp_path)
        fh = self._get_file_handler(_get_zephyr_logger())
        assert fh.level == logging.WARNING

    def test_creates_log_dir_if_missing(self, tmp_path: Path):
        log_dir = tmp_path / "nested" / "logs"
        assert not log_dir.exists()
        setup_logging(log_dir=log_dir)
        assert log_dir.is_dir()

    def test_default_log_dir_is_dot_zephyr_logs(self, tmp_path: Path):
        """When log_dir=None, defaults to ~/.zephyr/logs/."""
        with mock.patch("src.lib.logging_config.Path.home", return_value=tmp_path):
            setup_logging(log_dir=None)
        expected_dir = tmp_path / ".zephyr" / "logs"
        assert expected_dir.is_dir()
        assert list(expected_dir.glob("zephyr-*.log"))


# ---------------------------------------------------------------------------
# Console handler specifics
# ---------------------------------------------------------------------------


class TestConsoleHandler:
    """Verify console handler uses coloured formatter when appropriate."""

    def _get_console_handler(self, logger: logging.Logger) -> logging.StreamHandler:
        for h in logger.handlers:
            if isinstance(h, logging.StreamHandler) and not isinstance(
                h, RotatingFileHandler
            ):
                return h
        raise AssertionError("No StreamHandler (non-file) found")

    def test_coloured_formatter_when_tty(self, tmp_path: Path):
        fake_tty = io.StringIO()
        fake_tty.isatty = lambda: True  # type: ignore[attr-defined]
        with (
            mock.patch("sys.stderr", fake_tty),
            mock.patch.dict(os.environ, {}, clear=False),
        ):
            # Remove NO_COLOR if present
            os.environ.pop("NO_COLOR", None)
            setup_logging(log_dir=tmp_path)
        ch = self._get_console_handler(_get_zephyr_logger())
        assert isinstance(ch.formatter, _ColouredFormatter)

    def test_plain_formatter_when_not_tty(self, tmp_path: Path):
        with mock.patch("sys.stderr", io.StringIO()):
            setup_logging(log_dir=tmp_path)
        ch = self._get_console_handler(_get_zephyr_logger())
        assert type(ch.formatter) is logging.Formatter

    def test_console_handler_level_matches(self, tmp_path: Path):
        setup_logging(log_level="ERROR", log_dir=tmp_path)
        ch = self._get_console_handler(_get_zephyr_logger())
        assert ch.level == logging.ERROR


# ---------------------------------------------------------------------------
# _supports_colour
# ---------------------------------------------------------------------------


class TestSupportsColour:
    """Verify terminal colour detection logic."""

    def test_returns_true_for_tty(self):
        stream = io.StringIO()
        stream.isatty = lambda: True  # type: ignore[attr-defined]
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("NO_COLOR", None)
            assert _supports_colour(stream) is True

    def test_returns_false_for_non_tty(self):
        assert _supports_colour(io.StringIO()) is False

    def test_returns_false_when_no_isatty(self):
        assert _supports_colour(object()) is False

    def test_returns_false_when_no_color_env(self):
        stream = io.StringIO()
        stream.isatty = lambda: True  # type: ignore[attr-defined]
        with mock.patch.dict(os.environ, {"NO_COLOR": "1"}):
            assert _supports_colour(stream) is False

    def test_returns_false_when_no_color_empty(self):
        """NO_COLOR spec says any value (even empty) disables colour."""
        stream = io.StringIO()
        stream.isatty = lambda: True  # type: ignore[attr-defined]
        with mock.patch.dict(os.environ, {"NO_COLOR": ""}):
            assert _supports_colour(stream) is False


# ---------------------------------------------------------------------------
# _ColouredFormatter
# ---------------------------------------------------------------------------


class TestColouredFormatter:
    """Verify ANSI codes are injected into formatted output."""

    def test_info_gets_green(self):
        fmt = _ColouredFormatter(_DEFAULT_FORMAT)
        record = logging.LogRecord(
            name="zephyr.test",
            level=logging.INFO,
            pathname="",
            lineno=0,
            msg="test",
            args=(),
            exc_info=None,
        )
        output = fmt.format(record)
        assert _LEVEL_COLOURS["INFO"] in output
        assert _RESET in output

    def test_error_gets_red(self):
        fmt = _ColouredFormatter(_DEFAULT_FORMAT)
        record = logging.LogRecord(
            name="zephyr.test",
            level=logging.ERROR,
            pathname="",
            lineno=0,
            msg="err",
            args=(),
            exc_info=None,
        )
        output = fmt.format(record)
        assert _LEVEL_COLOURS["ERROR"] in output

    def test_warning_gets_yellow(self):
        fmt = _ColouredFormatter(_DEFAULT_FORMAT)
        record = logging.LogRecord(
            name="zephyr.test",
            level=logging.WARNING,
            pathname="",
            lineno=0,
            msg="warn",
            args=(),
            exc_info=None,
        )
        output = fmt.format(record)
        assert _LEVEL_COLOURS["WARNING"] in output

    def test_debug_gets_cyan(self):
        fmt = _ColouredFormatter(_DEFAULT_FORMAT)
        record = logging.LogRecord(
            name="zephyr.test",
            level=logging.DEBUG,
            pathname="",
            lineno=0,
            msg="dbg",
            args=(),
            exc_info=None,
        )
        output = fmt.format(record)
        assert _LEVEL_COLOURS["DEBUG"] in output

    def test_critical_gets_bold_red(self):
        fmt = _ColouredFormatter(_DEFAULT_FORMAT)
        record = logging.LogRecord(
            name="zephyr.test",
            level=logging.CRITICAL,
            pathname="",
            lineno=0,
            msg="crit",
            args=(),
            exc_info=None,
        )
        output = fmt.format(record)
        assert _LEVEL_COLOURS["CRITICAL"] in output


# ---------------------------------------------------------------------------
# Subsystem logger hierarchy
# ---------------------------------------------------------------------------


class TestLoggerHierarchy:
    """Verify that subsystem loggers inherit from the root zephyr logger."""

    @pytest.mark.parametrize(
        "subsystem",
        [
            "zephyr.docker",
            "zephyr.loop",
            "zephyr.ui",
            "zephyr.auth",
            "zephyr.main",
            "zephyr.controller",
            "zephyr.git",
            "zephyr.scheduler",
        ],
    )
    def test_subsystem_inherits_handlers(self, tmp_path: Path, subsystem: str):
        setup_logging(log_dir=tmp_path)
        sub = logging.getLogger(subsystem)
        # Effective level should match the root zephyr logger
        assert sub.getEffectiveLevel() == logging.INFO

    def test_subsystem_messages_reach_file(self, tmp_path: Path):
        setup_logging(log_level="DEBUG", log_dir=tmp_path)
        docker_logger = logging.getLogger("zephyr.docker")
        docker_logger.debug("container started")
        # Flush
        for h in _get_zephyr_logger().handlers:
            h.flush()
        content = (list(tmp_path.glob("zephyr-*.log"))[0]).read_text()
        assert "container started" in content
        assert "zephyr.docker" in content

    def test_subsystem_messages_below_level_not_written(self, tmp_path: Path):
        setup_logging(log_level="WARNING", log_dir=tmp_path)
        loop_logger = logging.getLogger("zephyr.loop")
        loop_logger.info("should not appear")
        for h in _get_zephyr_logger().handlers:
            h.flush()
        content = (list(tmp_path.glob("zephyr-*.log"))[0]).read_text()
        assert "should not appear" not in content


# ---------------------------------------------------------------------------
# Format string
# ---------------------------------------------------------------------------


class TestFormatString:
    """Verify the default format string structure."""

    def test_format_contains_asctime(self):
        assert "%(asctime)s" in _DEFAULT_FORMAT

    def test_format_contains_name(self):
        assert "%(name)s" in _DEFAULT_FORMAT

    def test_format_contains_levelname(self):
        assert "%(levelname)s" in _DEFAULT_FORMAT

    def test_format_contains_message(self):
        assert "%(message)s" in _DEFAULT_FORMAT
