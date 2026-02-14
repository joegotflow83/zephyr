"""Self-update mechanism for Zephyr Desktop.

Allows the application to update itself by running a Ralph loop
on its own repository, and to check for upstream updates via git fetch.
"""

import logging
from pathlib import Path
from typing import TYPE_CHECKING

from src.lib.models import ProjectConfig

if TYPE_CHECKING:
    from src.lib.git_manager import GitManager
    from src.lib.loop_runner import LoopRunner

logger = logging.getLogger("zephyr.updater")

# Reserved project ID for self-update loops
SELF_UPDATE_PROJECT_ID = "zephyr-self-update"


class SelfUpdater:
    """Manages self-update operations for the Zephyr application.

    Uses GitManager to check for remote changes and LoopRunner to
    start a Ralph loop targeting the application's own repository
    for automated self-improvement.

    Args:
        git_manager: GitManager for repository operations.
        loop_runner: LoopRunner for starting self-update loops.
    """

    def __init__(
        self,
        git_manager: "GitManager",
        loop_runner: "LoopRunner",
    ) -> None:
        self._git = git_manager
        self._loop_runner = loop_runner

    def check_for_updates(self, app_repo_path: Path) -> bool:
        """Check whether the remote has commits ahead of local HEAD.

        Runs ``git fetch`` on the application repository and compares
        the local HEAD with the remote tracking branch.

        Args:
            app_repo_path: Path to the Zephyr app's own git repository.

        Returns:
            True if the remote has newer commits than local HEAD,
            False otherwise (including on any error).
        """
        if not self._git.validate_repo(app_repo_path):
            logger.warning("App repo path is not a valid git repo: %s", app_repo_path)
            return False

        try:
            import git as gitmodule

            repo = gitmodule.Repo(str(app_repo_path))

            # Fetch from origin
            if "origin" not in [r.name for r in repo.remotes]:
                logger.info("No 'origin' remote found — cannot check for updates")
                return False

            repo.remotes.origin.fetch()

            # Compare local HEAD with remote tracking branch
            local_head = repo.head.commit
            tracking = repo.active_branch.tracking_branch()
            if tracking is None:
                logger.info("No tracking branch configured — cannot compare")
                return False

            remote_commit = tracking.commit
            # Check if remote is ahead by seeing if local HEAD is an ancestor
            is_ancestor = repo.is_ancestor(local_head, remote_commit)
            has_updates = is_ancestor and local_head != remote_commit

            if has_updates:
                logger.info(
                    "Updates available: local=%s remote=%s",
                    str(local_head)[:12],
                    str(remote_commit)[:12],
                )
            else:
                logger.info("No updates available")

            return has_updates

        except Exception as exc:
            logger.error("Failed to check for updates: %s", exc)
            return False

    def trigger_self_update(self, app_repo_path: Path) -> None:
        """Start a Ralph loop targeting the Zephyr app's own repository.

        Creates a special self-update project configuration and starts
        a single-iteration loop via LoopRunner.

        Args:
            app_repo_path: Path to the Zephyr app's own git repository.

        Raises:
            ValueError: If the path is not a valid git repository.
            RuntimeError: If a self-update loop is already running,
                or if the max concurrent loop limit is reached.
        """
        if not self._git.validate_repo(app_repo_path):
            raise ValueError(f"Not a valid git repository: {app_repo_path}")

        from src.lib.loop_runner import LoopMode

        # Build a special project config for self-update
        project = ProjectConfig(
            name="Zephyr Self-Update",
            repo_url=str(app_repo_path),
            id=SELF_UPDATE_PROJECT_ID,
            jtbd="Update and improve the Zephyr Desktop application itself",
        )

        # Temporarily register the self-update project so LoopRunner
        # can look it up via ProjectStore
        project_store = self._loop_runner._projects
        existing = project_store.get_project(SELF_UPDATE_PROJECT_ID)
        if existing is None:
            project_store.add_project(project)
        else:
            project_store.update_project(project)

        logger.info("Starting self-update loop for %s", app_repo_path)

        self._loop_runner.start_loop(
            project_id=SELF_UPDATE_PROJECT_ID,
            mode=LoopMode.SINGLE,
        )
