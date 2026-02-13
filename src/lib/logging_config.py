"""Comprehensive logging configuration for Zephyr Desktop.

Provides structured, rotated file logging alongside console output with
optional colour support.  All Zephyr subsystem loggers (``zephyr.docker``,
``zephyr.loop``, ``zephyr.ui``, ``zephyr.auth``, etc.) inherit from the
root ``zephyr`` logger configured here.
"""

import logging
import os
import sys
from datetime import datetime
from logging.handlers import RotatingFileHandler
from pathlib import Path

# ANSI colour codes keyed by log-level name.
_LEVEL_COLOURS = {
    "DEBUG": "\033[36m",     # cyan
    "INFO": "\033[32m",      # green
    "WARNING": "\033[33m",   # yellow
    "ERROR": "\033[31m",     # red
    "CRITICAL": "\033[1;31m",  # bold red
}
_RESET = "\033[0m"

_DEFAULT_FORMAT = "%(asctime)s [%(name)s] %(levelname)s: %(message)s"

# Rotation limits
_MAX_BYTES = 10 * 1024 * 1024  # 10 MB
_BACKUP_COUNT = 5


class _ColouredFormatter(logging.Formatter):
    """Formatter that wraps the level name in ANSI colour codes."""

    def format(self, record: logging.LogRecord) -> str:
        colour = _LEVEL_COLOURS.get(record.levelname, "")
        if colour:
            record.levelname = f"{colour}{record.levelname}{_RESET}"
        return super().format(record)


def _supports_colour(stream) -> bool:
    """Return *True* if *stream* is attached to a colour-capable terminal."""
    if not hasattr(stream, "isatty"):
        return False
    if not stream.isatty():
        return False
    # Respect NO_COLOR convention (https://no-color.org/)
    if os.environ.get("NO_COLOR") is not None:
        return False
    return True


def setup_logging(
    log_level: str = "INFO",
    log_dir: Path | None = None,
) -> None:
    """Configure the ``zephyr`` logger hierarchy.

    Parameters
    ----------
    log_level:
        Logging verbosity (``DEBUG``, ``INFO``, ``WARNING``, ``ERROR``).
    log_dir:
        Directory for rotated log files.  Defaults to
        ``~/.zephyr/logs/``.  The directory is created if it does not
        exist.  Pass ``None`` to use the default.
    """
    level = getattr(logging, log_level.upper(), logging.INFO)

    root_logger = logging.getLogger("zephyr")
    root_logger.setLevel(level)

    # Avoid duplicate handlers when called more than once (e.g. in tests).
    root_logger.handlers.clear()

    # -- Console handler ----------------------------------------------------
    console_handler = logging.StreamHandler(sys.stderr)
    console_handler.setLevel(level)

    if _supports_colour(sys.stderr):
        console_handler.setFormatter(_ColouredFormatter(_DEFAULT_FORMAT))
    else:
        console_handler.setFormatter(logging.Formatter(_DEFAULT_FORMAT))

    root_logger.addHandler(console_handler)

    # -- File handler (rotated) ---------------------------------------------
    if log_dir is None:
        log_dir = Path.home() / ".zephyr" / "logs"

    log_dir.mkdir(parents=True, exist_ok=True)

    today = datetime.now().strftime("%Y-%m-%d")
    log_file = log_dir / f"zephyr-{today}.log"

    file_handler = RotatingFileHandler(
        log_file,
        maxBytes=_MAX_BYTES,
        backupCount=_BACKUP_COUNT,
        encoding="utf-8",
    )
    file_handler.setLevel(level)
    file_handler.setFormatter(logging.Formatter(_DEFAULT_FORMAT))

    root_logger.addHandler(file_handler)
