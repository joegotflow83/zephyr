"""Git repository manager for Zephyr Desktop.

Provides clone, validation, info retrieval, and recent commit listing
using gitpython. Used by the loop runner to validate repos before
starting containers.
"""

import logging
from pathlib import Path
from typing import Callable

import git
from git.exc import InvalidGitRepositoryError, NoSuchPathError

logger = logging.getLogger("zephyr.git")


class GitManager:
    """Manages Git repository operations for Zephyr projects.

    Wraps gitpython to provide clone, validation, info, and commit
    history functionality needed by the loop execution engine.
    """

    def clone_repo(
        self,
        url: str,
        target_dir: Path,
        progress_callback: Callable | None = None,
    ) -> Path:
        """Clone a remote repository to a local directory.

        Args:
            url: Remote repository URL (HTTPS or SSH).
            target_dir: Local path to clone into. Must not already exist
                as a non-empty directory.
            progress_callback: Optional callable receiving progress strings
                from the clone operation.

        Returns:
            Path to the cloned repository root.

        Raises:
            ValueError: If *url* is empty.
            FileExistsError: If *target_dir* already exists and is non-empty.
            git.exc.GitCommandError: On clone failure (network, auth, etc.).
        """
        if not url or not url.strip():
            raise ValueError("Repository URL must not be empty")

        target = Path(target_dir)
        if target.exists() and any(target.iterdir()):
            raise FileExistsError(
                f"Target directory already exists and is non-empty: {target}"
            )

        logger.info("Cloning %s -> %s", url, target)

        progress = _ProgressHandler(progress_callback) if progress_callback else None

        repo = git.Repo.clone_from(
            url,
            str(target),
            progress=progress,
        )

        logger.info("Clone complete: %s", repo.working_dir)
        return Path(repo.working_dir)

    def validate_repo(self, path: Path) -> bool:
        """Check whether *path* is a valid Git repository.

        Args:
            path: Directory to check.

        Returns:
            True if *path* is a valid Git repo, False otherwise.
        """
        try:
            repo = git.Repo(str(path))
            # Access git_dir to confirm it's truly valid
            _ = repo.git_dir
            return True
        except (InvalidGitRepositoryError, NoSuchPathError):
            return False
        except Exception:
            return False

    def get_repo_info(self, path: Path) -> dict:
        """Return metadata about the repository at *path*.

        Args:
            path: Root of a Git repository.

        Returns:
            Dict with keys: ``branch`` (current branch name or detached
            HEAD hash), ``last_commit`` (short hash of HEAD), ``remote_url``
            (URL of 'origin' remote, or empty string).

        Raises:
            InvalidGitRepositoryError: If *path* is not a Git repo.
        """
        repo = git.Repo(str(path))

        # Current branch
        try:
            branch = repo.active_branch.name
        except TypeError:
            # Detached HEAD — fall back to commit hash
            try:
                branch = str(repo.head.commit)[:12]
            except ValueError:
                branch = ""

        # Last commit hash
        try:
            last_commit = str(repo.head.commit)[:12]
        except ValueError:
            # Empty repo with no commits
            last_commit = ""

        # Origin remote URL
        remote_url = ""
        try:
            if "origin" in [r.name for r in repo.remotes]:
                remote_url = repo.remotes.origin.url
        except Exception:
            pass

        return {
            "branch": branch,
            "last_commit": last_commit,
            "remote_url": remote_url,
        }

    def get_recent_commits(self, path: Path, count: int = 10) -> list[dict]:
        """Return the *count* most recent commits from HEAD.

        Args:
            path: Root of a Git repository.
            count: Maximum number of commits to return.

        Returns:
            List of dicts, each with keys: ``hash`` (full SHA), ``message``
            (first line of commit message), ``author`` (name), ``date``
            (ISO 8601 string).

        Raises:
            InvalidGitRepositoryError: If *path* is not a Git repo.
        """
        repo = git.Repo(str(path))

        commits: list[dict] = []
        try:
            for commit in repo.iter_commits(max_count=count):
                commits.append(
                    {
                        "hash": str(commit.hexsha),
                        "message": commit.message.strip().split("\n")[0],
                        "author": str(commit.author),
                        "date": commit.committed_datetime.isoformat(),
                    }
                )
        except ValueError:
            # Empty repo — no commits to iterate
            pass

        return commits


class _ProgressHandler(git.RemoteProgress):
    """Translates gitpython clone progress into callback invocations."""

    def __init__(self, callback: Callable) -> None:
        super().__init__()
        self._callback = callback

    def update(
        self, op_code: int, cur_count, max_count=None, message: str = ""
    ) -> None:
        """Called by gitpython during remote operations."""
        if message:
            self._callback(message)
        elif max_count:
            self._callback(f"{cur_count}/{max_count}")
