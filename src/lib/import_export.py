"""Import/export functionality for Zephyr Desktop.

Provides zip-based backup and restore of configuration data
(projects.json, settings.json, and custom prompt files) to
enable cross-machine portability.
"""

import json
import logging
import zipfile
from pathlib import Path

from src.lib.config_manager import ConfigManager

logger = logging.getLogger(__name__)

# Files that are always included in an export if they exist.
_CONFIG_FILES = ("projects.json", "settings.json")

# Directory inside the config dir that holds custom prompt files.
_PROMPTS_DIR = "prompts"


def export_config(config_manager: ConfigManager, output_path: Path) -> Path:
    """Export the Zephyr configuration to a zip archive.

    Bundles projects.json, settings.json, and any custom prompt files
    from the config directory into a single .zip file.

    Args:
        config_manager: ConfigManager providing the config directory.
        output_path: Destination path for the zip file. If it doesn't
            end with '.zip', the suffix is appended.

    Returns:
        Path to the created zip file.

    Raises:
        FileNotFoundError: If the config directory does not exist.
    """
    config_dir = config_manager.get_config_dir()
    if not config_dir.is_dir():
        raise FileNotFoundError(f"Config directory does not exist: {config_dir}")

    output_path = Path(output_path)
    if output_path.suffix != ".zip":
        output_path = output_path.with_suffix(".zip")

    # Ensure parent directory exists.
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as zf:
        # Add standard config files.
        for filename in _CONFIG_FILES:
            filepath = config_dir / filename
            if filepath.is_file():
                zf.write(filepath, filename)
                logger.info("Exported %s", filename)

        # Add custom prompt files from the prompts subdirectory.
        prompts_dir = config_dir / _PROMPTS_DIR
        if prompts_dir.is_dir():
            for prompt_file in sorted(prompts_dir.iterdir()):
                if prompt_file.is_file():
                    arcname = f"{_PROMPTS_DIR}/{prompt_file.name}"
                    zf.write(prompt_file, arcname)
                    logger.info("Exported prompt: %s", prompt_file.name)

        # Also export any custom prompt files referenced inline in
        # projects.json (stored directly in config dir as .md files).
        for path in sorted(config_dir.iterdir()):
            if path.is_file() and path.suffix == ".md":
                zf.write(path, path.name)
                logger.info("Exported %s", path.name)

    logger.info("Export complete: %s", output_path)
    return output_path


def import_config(config_manager: ConfigManager, zip_path: Path) -> dict:
    """Import Zephyr configuration from a zip archive.

    Extracts the archive into the config directory. Raises an error
    if any file in the archive already exists in the config directory,
    so the caller can decide on a merge strategy.

    Args:
        config_manager: ConfigManager providing the config directory.
        zip_path: Path to the zip file to import.

    Returns:
        Summary dict with keys:
            - "files": list of filenames that were imported
            - "projects_count": number of projects found (0 if no projects.json)
            - "has_settings": whether settings.json was included

    Raises:
        FileNotFoundError: If zip_path does not exist.
        zipfile.BadZipFile: If the file is not a valid zip archive.
        FileExistsError: If any file in the archive already exists
            in the config directory (conflict).
    """
    zip_path = Path(zip_path)
    if not zip_path.is_file():
        raise FileNotFoundError(f"Import file not found: {zip_path}")

    # Validate the zip before extracting anything.
    if not zipfile.is_zipfile(zip_path):
        raise zipfile.BadZipFile(f"Not a valid zip file: {zip_path}")

    config_dir = config_manager.ensure_config_dir()

    with zipfile.ZipFile(zip_path, "r") as zf:
        members = zf.namelist()

        # Safety: reject paths that escape the config dir.
        for name in members:
            resolved = (config_dir / name).resolve()
            if not str(resolved).startswith(str(config_dir.resolve())):
                raise ValueError(f"Zip contains unsafe path: {name}")

        # Check for conflicts — any existing file blocks the import.
        conflicts = []
        for name in members:
            target = config_dir / name
            if target.is_file():
                conflicts.append(name)

        if conflicts:
            raise FileExistsError(
                f"Import conflicts with existing files: {', '.join(conflicts)}"
            )

        # Extract all files.
        for name in members:
            zf.extract(name, config_dir)
            logger.info("Imported %s", name)

    # Build the summary.
    projects_count = 0
    has_settings = False

    if "projects.json" in members:
        try:
            data = config_manager.load_json("projects.json")
            projects_count = len(data.get("projects", {}))
        except Exception:
            projects_count = 0

    has_settings = "settings.json" in members

    summary = {
        "files": members,
        "projects_count": projects_count,
        "has_settings": has_settings,
    }

    logger.info(
        "Import complete: %d files, %d projects, settings=%s",
        len(members),
        projects_count,
        has_settings,
    )
    return summary
