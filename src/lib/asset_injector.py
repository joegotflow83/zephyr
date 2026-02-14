"""Shared asset injector for Zephyr Desktop.

Prepares a temporary directory containing shared assets (AGENTS.md,
custom prompts, PROMPT_build.md) that get volume-mounted into Docker
containers so that Ralph loops can reference them.
"""

import logging
import shutil
import tempfile
from pathlib import Path

from src.lib.config_manager import ConfigManager
from src.lib.models import ProjectConfig

logger = logging.getLogger(__name__)

# Default location of the app's own AGENTS.md (project root).
_APP_ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_AGENTS_MD_PATH = _APP_ROOT / "AGENTS.md"

# Default PROMPT_build.md content used when neither the project nor the
# config directory provides an override.
DEFAULT_PROMPT_BUILD = (
    "# Build Prompt\n\n"
    "Follow the instructions in AGENTS.md to build and test the project.\n"
)

# Mount target inside the container.
CONTAINER_MOUNT_TARGET = "/home/ralph/app"


class AssetInjector:
    """Prepares shared assets for injection into Docker containers.

    Assets are assembled in a temporary directory that can be
    volume-mounted into the container.  The injector resolves file
    priorities:

    1. Project-specific custom prompts override any defaults.
    2. The app-level ``AGENTS.md`` is used unless the project provides
       its own via ``custom_prompts["AGENTS.md"]``.
    3. ``PROMPT_build.md`` is included unless the project already
       provides it in ``custom_prompts``.

    Args:
        config_manager: The application's ConfigManager instance.
        agents_md_path: Path to the app's own AGENTS.md.  Defaults to
            the repository-root ``AGENTS.md``.
    """

    def __init__(
        self,
        config_manager: ConfigManager,
        agents_md_path: Path | None = None,
    ):
        self._config_manager = config_manager
        self._agents_md_path = agents_md_path or DEFAULT_AGENTS_MD_PATH

    def prepare_injection_dir(self, project: ProjectConfig) -> Path:
        """Create a temporary directory populated with shared assets.

        The directory will contain:

        * ``AGENTS.md`` — from the app root, or the project's
          ``custom_prompts`` override.
        * Each file listed in ``project.custom_prompts``.
        * ``PROMPT_build.md`` — a default is written if the project
          does not supply one.

        Args:
            project: The project whose assets should be assembled.

        Returns:
            Path to the temporary injection directory.  The caller (or
            the cleanup method) is responsible for removing it later.
        """
        injection_dir = Path(
            tempfile.mkdtemp(prefix=f"zephyr-inject-{project.id[:8]}-")
        )
        logger.info(
            "Preparing injection dir %s for project %s",
            injection_dir,
            project.name,
        )

        try:
            self._write_agents_md(injection_dir, project)
            self._write_custom_prompts(injection_dir, project)
            self._ensure_prompt_build(injection_dir, project)
        except Exception:
            # On any error, clean up the partial directory so we don't
            # leak temp dirs.
            shutil.rmtree(injection_dir, ignore_errors=True)
            raise

        return injection_dir

    def get_mount_config(self, injection_dir: Path) -> dict:
        """Return a Docker volume-mount configuration dict.

        The returned dict is suitable for passing directly to the
        ``volumes`` parameter of ``docker.containers.create()``.

        Args:
            injection_dir: Path to the prepared injection directory.

        Returns:
            ``{str(injection_dir): {"bind": "/home/ralph/app", "mode": "ro"}}``
        """
        return {
            str(injection_dir): {"bind": CONTAINER_MOUNT_TARGET, "mode": "ro"},
        }

    def cleanup(self, injection_dir: Path) -> None:
        """Remove a previously created injection directory.

        Silently ignores missing or already-deleted directories.

        Args:
            injection_dir: Path returned by :meth:`prepare_injection_dir`.
        """
        if injection_dir.exists():
            shutil.rmtree(injection_dir, ignore_errors=True)
            logger.info("Cleaned up injection dir %s", injection_dir)

    # -- internal helpers ----------------------------------------------------

    def _write_agents_md(self, injection_dir: Path, project: ProjectConfig) -> None:
        """Write AGENTS.md — project override wins over app default."""
        target = injection_dir / "AGENTS.md"

        if "AGENTS.md" in project.custom_prompts:
            target.write_text(project.custom_prompts["AGENTS.md"], encoding="utf-8")
            logger.debug("Using project-override AGENTS.md for %s", project.name)
            return

        if self._agents_md_path.exists():
            shutil.copy2(self._agents_md_path, target)
            logger.debug("Copied app AGENTS.md for %s", project.name)
        else:
            logger.warning(
                "App AGENTS.md not found at %s; skipping", self._agents_md_path
            )

    def _write_custom_prompts(
        self, injection_dir: Path, project: ProjectConfig
    ) -> None:
        """Write all custom prompt files from the project config.

        AGENTS.md is handled separately by :meth:`_write_agents_md`,
        so it is skipped here to avoid double-writes.
        """
        for filename, content in project.custom_prompts.items():
            if filename == "AGENTS.md":
                continue  # already handled
            target = injection_dir / filename
            # Ensure parent directories exist for nested filenames.
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")
            logger.debug(
                "Wrote custom prompt %s for project %s", filename, project.name
            )

    def _ensure_prompt_build(self, injection_dir: Path, project: ProjectConfig) -> None:
        """Ensure PROMPT_build.md exists — write default if missing."""
        target = injection_dir / "PROMPT_build.md"
        if target.exists():
            # Already written via custom_prompts.
            return
        target.write_text(DEFAULT_PROMPT_BUILD, encoding="utf-8")
        logger.debug("Wrote default PROMPT_build.md for project %s", project.name)
