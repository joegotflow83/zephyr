"""Disk space checker and large repo warnings.

Provides utilities to check available disk space and repository sizes,
warning users before starting loops that might fail due to insufficient
disk space. Integrated into AppController.handle_start_loop to prevent
starting containers when disk space is critically low.
"""

import logging
import shutil
from pathlib import Path

logger = logging.getLogger("zephyr.disk")


class DiskChecker:
    """Checks disk space and repository sizes to prevent out-of-space failures.

    Methods:
        get_available_space: Returns bytes available at a given path.
        check_repo_size: Returns total size of a repository in bytes.
        warn_if_low: Returns a warning message if disk space is below threshold.
    """

    def get_available_space(self, path: Path) -> int:
        """Return available disk space in bytes for the filesystem containing *path*.

        Args:
            path: A path on the filesystem to check. The path must exist.

        Returns:
            Available space in bytes.

        Raises:
            FileNotFoundError: If *path* does not exist.
        """
        resolved = Path(path).resolve()
        if not resolved.exists():
            raise FileNotFoundError(f"Path does not exist: {path}")
        usage = shutil.disk_usage(resolved)
        return usage.free

    def check_repo_size(self, repo_path: Path) -> int:
        """Return the total size of all files in *repo_path* in bytes.

        Walks the directory tree recursively, summing the sizes of all
        regular files (symlinks are not followed).

        Args:
            repo_path: Root directory of the repository.

        Returns:
            Total size in bytes.

        Raises:
            FileNotFoundError: If *repo_path* does not exist.
            NotADirectoryError: If *repo_path* is not a directory.
        """
        resolved = Path(repo_path).resolve()
        if not resolved.exists():
            raise FileNotFoundError(f"Path does not exist: {repo_path}")
        if not resolved.is_dir():
            raise NotADirectoryError(f"Path is not a directory: {repo_path}")

        total = 0
        for entry in resolved.rglob("*"):
            try:
                if entry.is_file() and not entry.is_symlink():
                    total += entry.stat().st_size
            except OSError:
                # File may have been removed or be inaccessible
                logger.debug("Could not stat file: %s", entry)
        return total

    def warn_if_low(self, path: Path | None = None, threshold_gb: float = 5.0) -> str | None:
        """Return a warning message if available disk space is below *threshold_gb*.

        Args:
            path: Path to check. Defaults to the user's home directory.
            threshold_gb: Minimum acceptable free space in gigabytes.

        Returns:
            A human-readable warning string if space is low, otherwise ``None``.
        """
        if path is None:
            path = Path.home()

        try:
            available = self.get_available_space(path)
        except FileNotFoundError:
            return f"Cannot check disk space: path does not exist ({path})"

        threshold_bytes = int(threshold_gb * 1024 * 1024 * 1024)
        if available < threshold_bytes:
            available_gb = available / (1024 * 1024 * 1024)
            return (
                f"Low disk space warning: only {available_gb:.1f} GB available "
                f"(threshold: {threshold_gb:.1f} GB). "
                f"Consider freeing up space before starting a loop."
            )
        return None
