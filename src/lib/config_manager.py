"""Configuration manager for Zephyr Desktop.

Manages the ~/.zephyr/ configuration directory and provides atomic
JSON file persistence. The config dir is injectable for testability.
"""

import json
import logging
import os
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)

DEFAULT_CONFIG_DIR = Path.home() / ".zephyr"


class ConfigManager:
    """Manages the Zephyr configuration directory and JSON file I/O.

    Args:
        config_dir: Path to configuration directory. Defaults to ~/.zephyr/.
    """

    def __init__(self, config_dir: Path | None = None):
        self._config_dir = config_dir or DEFAULT_CONFIG_DIR

    def get_config_dir(self) -> Path:
        """Return the configuration directory path."""
        return self._config_dir

    def ensure_config_dir(self) -> Path:
        """Create the configuration directory if it doesn't exist.

        Returns:
            Path to the configuration directory.
        """
        self._config_dir.mkdir(parents=True, exist_ok=True)
        return self._config_dir

    def load_json(self, filename: str) -> dict:
        """Load a JSON file from the configuration directory.

        Args:
            filename: Name of the JSON file (e.g. 'projects.json').

        Returns:
            Parsed dict, or empty dict if file is missing or invalid.
        """
        filepath = self._config_dir / filename
        if not filepath.exists():
            return {}
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                data = json.load(f)
            if not isinstance(data, dict):
                logger.warning(
                    "Expected dict in %s, got %s; returning empty dict",
                    filepath,
                    type(data).__name__,
                )
                return {}
            return data
        except (json.JSONDecodeError, OSError) as exc:
            logger.warning("Failed to load %s: %s", filepath, exc)
            return {}

    def save_json(self, filename: str, data: dict) -> None:
        """Atomically write a dict as JSON to the configuration directory.

        Uses a temporary file + rename to prevent corruption from partial
        writes (e.g. if the process is killed mid-write).

        Args:
            filename: Name of the JSON file (e.g. 'projects.json').
            data: Dictionary to serialize.
        """
        self.ensure_config_dir()
        filepath = self._config_dir / filename

        # Write to a temp file in the same directory, then atomically rename.
        # dir= ensures the temp file is on the same filesystem as the target.
        fd, tmp_path = tempfile.mkstemp(
            dir=self._config_dir, suffix=".tmp", prefix=f".{filename}."
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp_path, filepath)
        except BaseException:
            # Clean up the temp file on any failure.
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise
